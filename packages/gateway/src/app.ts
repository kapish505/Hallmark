import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { keccak256, verifyMessage } from "ethers";
import {
  badgeFor,
  checkCanonicalWav,
  checkPng,
  hashscanTx,
  HBAR_ASSET,
  inputHashOf,
  jobIdFor,
  logger,
  MediaError,
  NAME,
  NormError,
  OperatorBehavior,
  OutputUpload,
  outputHashOf,
  outputUploadMessage,
  TASK_ENDPOINT,
  validate,
  VERSION,
  X402_NETWORK,
  type Contracts,
  type Manifest,
  type NormSpec,
  type Task,
} from "@hallmark/shared";
import type { BlobStore } from "./blobs.js";
import type { Db, JobRow } from "./db.js";
import type { Indexer } from "./indexer.js";

const log = logger("gateway");

export interface TaskConfig {
  task: Task;
  modelKey: string;
  modelId: string;
  priceTinybar: bigint;
  bondTinybar: bigint;
  cls: number;
  tauBps: number;
  normSpec: NormSpec;
  auditBps: number;
  available: boolean;
}

export interface AppDeps {
  db: Db;
  contracts: Contracts;
  indexer: Indexer;
  blobs: BlobStore;
  paymentMiddleware: (req: Request, res: Response, next: NextFunction) => unknown;
  /** the live task list (prices refresh from the contract) */
  tasks: () => TaskConfig[];
  cfg: {
    publicUrl: string;
    payTo: string;
    chainId: number;
    hashscanUrl: string;
    facilitatorUrl: string;
    maxAudioSeconds: number;
    maxAudioBytes: number;
    maxImageBytes: number;
    maxImagePixels: number;
    rateLimitPerMin: number;
    contract: string;
    demoMode: boolean;
    demoControlToken?: string;
    operatorControl: Record<string, string>;
  };
  /** demo-sponsored "Try it" payer (optional, labelled in the UI) */
  tryIt?: (task: Task, bytes: Uint8Array) => Promise<unknown>;
}

function rateLimit(perMin: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + 60_000 });
    else if (++h.n > perMin) return void res.status(429).json({ error: "rate limited" });
    next();
  };
}

export function createApp(d: AppDeps) {
  const { db, cfg } = d;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  // section 11: paid responses and results must never be cached by a proxy
  app.use(["/v1/transcribe", "/v1/ocr", "/v1/jobs"], (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", "PAYMENT-SIGNATURE, X-PAYMENT, Accept");
    next();
  });
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE");
    if (req.method === "OPTIONS") return void res.sendStatus(204);
    next();
  });
  const link = (tx: string | null) => (tx ? hashscanTx(cfg.hashscanUrl, tx) : null);
  const taskCfg = (t: Task) => d.tasks().find((x) => x.task === t);

  // ---------------------------------------------------------------- discovery
  app.get("/.well-known/hallmark.json", (_req, res) => {
    const m: Manifest = {
      name: NAME,
      version: VERSION,
      network: X402_NETWORK,
      payTo: cfg.payTo,
      asset: HBAR_ASSET,
      chainId: cfg.chainId,
      contract: cfg.contract,
      facilitator: cfg.facilitatorUrl,
      tasks: d.tasks().map((t) => ({
        task: t.task,
        endpoint: `${cfg.publicUrl}${TASK_ENDPOINT[t.task]}`,
        modelId: t.modelId,
        modelKey: t.modelKey,
        priceTinybar: t.priceTinybar.toString(),
        bondTinybar: t.bondTinybar.toString(),
        class: t.cls === 1 ? "TOLERANCE" : "EXACT",
        tauBps: t.tauBps,
        auditBps: t.auditBps,
        available: t.available,
        limits:
          t.task === "asr"
            ? { maxBytes: cfg.maxAudioBytes, maxSeconds: cfg.maxAudioSeconds }
            : { maxBytes: cfg.maxImageBytes, maxPixels: cfg.maxImagePixels },
      })),
      endpoints: {
        job: `${cfg.publicUrl}/v1/jobs/{jobId}`,
        result: `${cfg.publicUrl}/v1/jobs/{jobId}/result`,
        events: `${cfg.publicUrl}/v1/jobs/{jobId}/events`,
      },
    };
    res.json(m);
  });
  app.get("/health", (_req, res) => res.json({ ok: true }));

  // ---------------------------------------------------------------- paid endpoints
  const maxBody = Math.max(cfg.maxAudioBytes, cfg.maxImageBytes);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBody, files: 1, fields: 4 } });

  for (const task of ["asr", "ocr"] as Task[]) {
    const path = TASK_ENDPOINT[task];
    const maxBytes = task === "asr" ? cfg.maxAudioBytes : cfg.maxImageBytes;
    // an unoffered task is a 404 BEFORE any payment (the x402 middleware only protects offered routes)
    app.post(path, (_req, res, next) => {
      const t = taskCfg(task);
      if (!t || !t.available) return void res.status(503).json({ error: `${task} is not available right now; you were not charged` });
      next();
    });
    app.post(
      path,
      rateLimit(cfg.rateLimitPerMin),
      (req, res, next) => {
        if (Number(req.headers["content-length"] ?? 0) > maxBytes + 64 * 1024) return void res.status(413).json({ error: `body larger than ${maxBytes} bytes` });
        next();
      },
      d.paymentMiddleware,
      (req, res, next) => upload.single("file")(req, res, (err) => (err ? res.status(400).json({ error: String(err.message ?? err) }) : next())),
      async (req, res) => {
        // runs after /verify and BEFORE /settle: any non-2xx here cancels settlement (edge case 2)
        try {
          const t = taskCfg(task)!;
          if (!req.file) return void res.status(400).json({ error: "multipart field 'file' is required" });
          const bytes = new Uint8Array(req.file.buffer);
          if (bytes.length > maxBytes) return void res.status(413).json({ error: `input larger than ${maxBytes} bytes` });
          let meta: Record<string, unknown>;
          try {
            meta = task === "asr" ? { ...checkCanonicalWav(bytes, cfg.maxAudioSeconds) } : { ...checkPng(bytes, cfg.maxImagePixels) };
          } catch (e) {
            return void res.status(415).json({ error: e instanceof MediaError ? e.message : "unreadable input" });
          }
          const paymentHeader = req.header("payment-signature") ?? req.header("x-payment");
          if (!paymentHeader) return void res.status(402).json({ error: "missing payment header" });
          const inputHash = inputHashOf(bytes);
          const jobId = jobIdFor(inputHash, paymentHeader).toLowerCase();
          const paymentKey = keccak256(new TextEncoder().encode(paymentHeader));
          const existing = db.job(jobId) ?? db.jobByPaymentKey(paymentKey);
          if (existing) return void res.status(202).json(accepted(existing)); // idempotent retry (edge case 1)

          // capacity check BEFORE settlement (edge case 4): 503 = not charged
          const [, , , available] = await d.contracts.core.quote(t.modelId);
          if (!available) return void res.status(503).json({ error: "not enough bonded operators right now; you were not charged" });

          d.blobs.put(bytes);
          const row = db.insertPending({ jobId, paymentKey, task, modelId: t.modelId, inputHash, bytes: bytes.length, meta, price: t.priceTinybar });
          res.status(202).json(accepted(row));
        } catch (e) {
          log.error("task handler failed", { task, error: String(e) });
          res.status(500).json({ error: "internal error; you were not charged" });
        }
      },
    );
  }

  function accepted(r: JobRow) {
    return {
      jobId: r.job_id,
      task: r.task,
      inputHash: r.input_hash,
      statusUrl: `${cfg.publicUrl}/v1/jobs/${r.job_id}`,
      eventsUrl: `${cfg.publicUrl}/v1/jobs/${r.job_id}/events`,
      resultUrl: `${cfg.publicUrl}/v1/jobs/${r.job_id}/result`,
    };
  }

  // ---------------------------------------------------------------- job views
  function executorHash(r: JobRow): string | null {
    const ev = db.events(r.job_id).find((e) => e.name === "Revealed" && JSON.parse(e.args).who?.toLowerCase() === r.executor?.toLowerCase());
    return ev ? String(JSON.parse(ev.args).outputHash) : null;
  }

  function view(r: JobRow) {
    const events = db.events(r.job_id).map((e) => ({ name: e.name, args: JSON.parse(e.args), tx: e.tx_hash, link: link(e.tx_hash), position: e.position }));
    const status = r.chain_status ?? r.payment_status;
    return {
      jobId: r.job_id,
      task: r.task,
      modelId: r.model_id,
      price: r.price,
      inputHash: r.input_hash,
      meta: JSON.parse(r.meta),
      payment: {
        status: r.payment_status,
        payer: r.payer,
        buyer: r.buyer_evm,
        settleTx: r.settle_tx,
        settleLink: link(r.settle_tx),
        createTx: r.create_tx,
        refundTx: r.refund_tx,
        refundLink: link(r.refund_tx),
        error: r.error,
      },
      status,
      executor: r.executor,
      verifier: r.verifier,
      committee: r.members ? JSON.parse(r.members) : [],
      bond: r.bond,
      audited: !!r.audited,
      auditSkipped: !!r.audit_skipped,
      challenged: !!r.challenged,
      outcome: r.outcome,
      deadline: r.deadline,
      badge: badgeFor({ status, audited: !!r.audited, auditSkipped: !!r.audit_skipped, slashedWrong: !!r.slashed_wrong }),
      final: status === "Settled" || status === "Refunded" || r.payment_status === "Rejected",
      events,
    };
  }

  app.get("/v1/jobs", (_req, res) => res.json(db.recentJobs(50).map(view)));
  app.get("/v1/jobs/:id", (req, res) => {
    const r = db.job(req.params.id);
    if (!r) return void res.status(404).json({ error: "unknown job" });
    res.json(view(r));
  });

  /** provisional until settled; 409 while disputed; 410 if refunded (section 9.1) */
  app.get("/v1/jobs/:id/result", (req, res) => {
    const r = db.job(req.params.id);
    if (!r) return void res.status(404).json({ error: "unknown job" });
    const v = view(r);
    if (v.status === "Refunded" || r.payment_status === "Rejected") return void res.status(410).json({ error: "refunded", badge: v.badge, refundLink: v.payment.refundLink });
    if (["Text", "CommitteeCommit", "CommitteeReveal"].includes(v.status)) return void res.status(409).json({ error: "disputed: the committee is re-running this job", badge: v.badge });
    const h = executorHash(r);
    const text = h ? db.outputByHash(h) : null;
    if (!h || text === null) return void res.status(202).json({ status: v.status, badge: v.badge, final: false });
    res.json({ jobId: r.job_id, task: r.task, text, outputHash: h, provisional: v.status !== "Settled", final: v.status === "Settled", badge: v.badge, status: v.status });
  });

  app.get("/v1/jobs/:id/events", (req, res) => {
    const id = req.params.id.toLowerCase();
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    const r = db.job(id);
    if (r) res.write(`event: snapshot\ndata: ${JSON.stringify(view(r))}\n\n`);
    const on = (e: { jobId: string | null; name: string; args: unknown; tx: string }) => {
      if (e.jobId === id) res.write(`event: chain\ndata: ${JSON.stringify(e)}\n\n`);
    };
    d.indexer.bus.on("event", on);
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(ping);
      d.indexer.bus.off("event", on);
    });
  });

  // ---------------------------------------------------------------- evidence store (G4)
  app.get("/inputs/:hash", (req, res) => {
    const b = /^0x[0-9a-fA-F]{64}$/.test(req.params.hash) ? d.blobs.get(req.params.hash) : null;
    if (!b) return void res.status(404).json({ error: "unknown input" });
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(Buffer.from(b));
  });

  /** operator-signed output upload; accepted only for a revealed seat whose hash matches */
  app.put("/outputs/:jobId", express.json({ limit: "16kb" }), async (req, res) => {
    const p = OutputUpload.safeParse(req.body);
    if (!p.success || p.data.jobId.toLowerCase() !== req.params.jobId.toLowerCase()) return void res.status(400).json({ error: "bad upload" });
    const u = p.data;
    try {
      const signer = verifyMessage(outputUploadMessage(u), u.signature);
      if (signer.toLowerCase() !== u.operator.toLowerCase()) return void res.status(401).json({ error: "bad signature" });
      if (outputHashOf(u.text).toLowerCase() !== u.outputHash.toLowerCase()) return void res.status(400).json({ error: "text does not match outputHash" });
      const job = await d.contracts.core.getJob(u.jobId);
      validate(u.text, Number(job.normSpec) as NormSpec);
      const seat = await d.contracts.core.seat(u.jobId, u.operator);
      if (!seat.revealed || String(seat.outputHash).toLowerCase() !== u.outputHash.toLowerCase()) return void res.status(409).json({ error: "no revealed seat with this hash" });
      db.putOutput({ job_id: u.jobId, operator: u.operator, output_hash: u.outputHash, text: u.text, source: "upload" });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e instanceof NormError ? `${e.code}: ${e.message}` : String(e) });
    }
  });

  app.get("/outputs/by-hash/:hash", (req, res) => {
    const t = db.outputByHash(req.params.hash);
    if (t === null) return void res.status(404).json({ error: "unknown output" });
    res.type("text/plain").send(t);
  });

  // ---------------------------------------------------------------- network
  app.get("/v1/network", async (_req, res) => {
    try {
      const core = d.contracts.core;
      const n = Number(await core.operatorCount());
      const ops = [];
      for (let i = 0; i < n; i++) {
        const a: string = await core.operatorList(i);
        const o = await core.operators(a);
        ops.push({ address: a, free: o.free.toString(), locked: o.locked.toString(), control: !!cfg.operatorControl[a.toLowerCase()] });
      }
      const p = await core.getParams();
      const [auditPool, slashPool, treasury, escrow] = await Promise.all([core.auditPool(), core.slashPool(), core.treasury(), core.escrow()]);
      const slashes = db.sql.prepare("SELECT args, tx_hash FROM events WHERE name = 'Slashed' ORDER BY id DESC LIMIT 50").all() as Array<{ args: string; tx_hash: string }>;
      res.json({
        contract: cfg.contract,
        params: Object.fromEntries(Object.entries(p.toObject()).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])),
        tasks: d.tasks().map((t) => ({ ...t, priceTinybar: t.priceTinybar.toString(), bondTinybar: t.bondTinybar.toString() })),
        operators: ops,
        pools: { auditPool: auditPool.toString(), slashPool: slashPool.toString(), treasury: treasury.toString(), escrow: escrow.toString() },
        slashes: slashes.map((s) => ({ ...JSON.parse(s.args), link: link(s.tx_hash) })),
        demoMode: cfg.demoMode,
      });
    } catch (e) {
      res.status(502).json({ error: String(e) });
    }
  });

  // ---------------------------------------------------------------- demo (attack lab)
  const demoAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!cfg.demoMode || !cfg.demoControlToken || req.headers.authorization !== `Bearer ${cfg.demoControlToken}`) return void res.status(401).json({ error: "demo control disabled or bad token" });
    next();
  };
  app.post("/demo/behavior", express.json(), demoAuth, async (req, res) => {
    const b = OperatorBehavior.safeParse(req.body?.behavior);
    const url = cfg.operatorControl[String(req.body?.operator ?? "").toLowerCase()];
    if (!b.success || !url) return void res.status(400).json({ error: "operator with a control URL and a valid behavior required" });
    const r = await fetch(`${url}/behavior`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.demoControlToken}` }, body: JSON.stringify({ behavior: b.data }) });
    res.status(r.status).json(await r.json());
  });
  app.post("/demo/try", demoAuth, upload.single("file"), async (req, res) => {
    if (!d.tryIt) return void res.status(501).json({ error: "no demo buyer configured" });
    const task = req.body?.task === "ocr" ? "ocr" : "asr";
    if (!req.file) return void res.status(400).json({ error: "file required" });
    try {
      res.json(await d.tryIt(task, new Uint8Array(req.file.buffer)));
    } catch (e) {
      res.status(502).json({ error: String(e) });
    }
  });

  return app;
}
