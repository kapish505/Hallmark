import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { hexlify, keccak256, randomBytes, verifyMessage } from "ethers";
import {
  badgeFor,
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
  DirectJobRegistration,
  registerMessage,
  outCommitOf,
  outputUploadMessage,
  parseValidator,
  readMessage,
  runValidator,
  saltCommitOf,
  ValidatorError,
  validate,
  VERSION,
  X402_NETWORK,
  type Contracts,
  type Manifest,
  type NormSpec,
  type Task,
} from "@hallmark/shared";
import { checkInput, limitsOf, type Manifest as ModelManifest } from "@hallmark/model-spec";
import type { BlobStore } from "./blobs.js";
import type { Db, JobRow } from "./db.js";
import type { Indexer } from "./indexer.js";
import type { CanaryRunner } from "./canary.js";
import { SCENARIOS, type DemoController } from "./demo.js";

const log = logger("gateway");

export interface TaskConfig {
  task: Task;
  /** the model's manifest (input rules, validators, description); numbers below are read from the chain */
  manifest: ModelManifest;
  modelKey: string;
  modelId: string;
  priceTinybar: bigint;
  bondTinybar: bigint;
  cls: number;
  tauBps: number;
  normSpec: NormSpec;
  auditBps: number;
  expectedErrorBps: number;
  errorSampleSize: number;
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
  /** manifests of every model this gateway serves (routes are registered for each at start) */
  manifests: ModelManifest[];
  canary?: CanaryRunner;
  demo?: DemoController;
  /**
   * Direct-transfer payment option for EVM wallets (MetaMask cannot sign Hedera-native x402
   * transfers): look up a transfer on the Mirror Node, and hand a verified payment to the pipeline.
   */
  direct?: {
    lookup: (txHash: string) => Promise<{ ok: boolean; to: string; amountTinybar: bigint; consensusSeconds: number; transactionId: string; payer: string }>;
    /** a transfer we cannot accept (underpaid or too old): refund it in full */
    onUnacceptable: (jobId: string, payer: string, settleTx: string) => void;
    onPaid: (jobId: string, payer: string, settleTx: string) => void;
  };
  cfg: {
    publicUrl: string;
    payTo: string;
    payToEvm: string;
    chainId: number;
    hashscanUrl: string;
    facilitatorUrl: string;
    rateLimitPerMin: number;
    contract: string;
    demoMode: boolean;
    demoControlToken?: string;
    operatorControl: Record<string, string>;
    /** extra readers of private evidence (add-on A1), lower-case addresses */
    watchers: string[];
  };
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

const ZERO_COMMIT = "0x" + "00".repeat(32);

export function createApp(d: AppDeps) {
  const { db, cfg } = d;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  // section 11: paid responses and results must never be cached by a proxy
  app.use([...d.manifests.map((m) => m.endpoint), "/v1/direct", "/v1/core/jobs", "/v1/jobs"], (_req, res, next) => {
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
      payToEvm: cfg.payToEvm,
      tasks: d.tasks().map((t) => ({
        task: t.task,
        endpoint: `${cfg.publicUrl}${t.manifest.endpoint}`,
        modelId: t.modelId,
        modelKey: t.modelKey,
        priceTinybar: t.priceTinybar.toString(),
        bondTinybar: t.bondTinybar.toString(),
        class: t.cls === 1 ? "TOLERANCE" : "EXACT",
        tauBps: t.tauBps,
        auditBps: t.auditBps,
        available: t.available,
        accuracy: { expectedErrorBps: t.expectedErrorBps, sampleSize: t.errorSampleSize, metric: t.manifest.accuracy.metric, measured: t.errorSampleSize > 0 },
        validators: t.manifest.validators,
        limits: limitsOf(t.manifest),
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
  const maxBody = Math.max(1, ...d.manifests.map((m) => m.input.maxBytes));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBody, files: 1, fields: 4 } });

  for (const mf of d.manifests) {
    const task = mf.task;
    const path = mf.endpoint;
    const maxBytes = mf.input.maxBytes;
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
            meta = checkInput(mf, bytes);
          } catch (e) {
            return void res.status(415).json({ error: e instanceof MediaError ? e.message : "unreadable input" });
          }
          let validator;
          try {
            validator = parseValidator(typeof req.body?.validator === "string" ? req.body.validator : undefined);
          } catch (e) {
            return void res.status(400).json({ error: e instanceof ValidatorError ? e.message : "bad validator" });
          }
          if (!mf.validators.some((v) => v.split(":")[0] === validator.name)) return void res.status(400).json({ error: `validator ${validator.name} is not offered for ${task}` });
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
          // add-on A1: a fresh job salt; only its hash goes on chain
          const jobSalt = hexlify(randomBytes(32));
          const row = db.insertPending({
            jobId,
            paymentKey,
            task,
            modelId: t.modelId,
            inputHash,
            bytes: bytes.length,
            meta,
            price: t.priceTinybar,
            jobSalt,
            saltCommit: saltCommitOf(jobSalt),
            accessToken: hexlify(randomBytes(24)),
            validator: validator.name === "min_words" ? `min_words:${validator.arg}` : validator.name,
          });
          res.status(202).json(accepted(row));
        } catch (e) {
          log.error("task handler failed", { task, error: String(e) });
          res.status(500).json({ error: "internal error; you were not charged" });
        }
      },
    );
  }

  // ---------------------------------------------------------------- evidence store for direct (non-gateway) jobs
  /**
   * POST /v1/core/jobs: a service that calls Hallmark.createJob ITSELF first puts the input and the job salt
   * here, signed by its buyer key. No payment passes through the gateway: the service pays the contract.
   * The store checks the input against the model's media rules (so operators are not handed unusable
   * input), records the buyer, and returns the locator to pass to createJob plus a bearer token for the
   * result. Operators then read salt and input exactly as for gateway jobs (signed, seat-checked).
   */
  app.post("/v1/core/jobs", rateLimit(cfg.rateLimitPerMin), express.json({ limit: `${Math.ceil((maxBody * 4) / 3) + 4096}b` }), async (req, res) => {
    const p = DirectJobRegistration.safeParse(req.body);
    if (!p.success) return void res.status(400).json({ error: "bad registration", issues: p.error.issues.map((i) => i.path.join(".")) });
    const r = p.data;
    const t = d.tasks().find((x) => x.modelId.toLowerCase() === r.modelId.toLowerCase());
    if (!t) return void res.status(404).json({ error: "this evidence store does not serve that model" });
    const bytes = new Uint8Array(Buffer.from(r.input, "base64"));
    const maxBytes = t.manifest.input.maxBytes;
    if (bytes.length === 0 || bytes.length > maxBytes) return void res.status(413).json({ error: `input must be 1..${maxBytes} bytes` });
    let meta: Record<string, unknown>;
    try {
      meta = checkInput(t.manifest, bytes);
    } catch (e) {
      return void res.status(415).json({ error: e instanceof MediaError ? e.message : "unreadable input" });
    }
    const inputHash = inputHashOf(bytes);
    const saltCommit = saltCommitOf(r.jobSalt);
    try {
      const signer = verifyMessage(registerMessage({ jobId: r.jobId, inputHash, saltCommit, modelId: r.modelId, buyer: r.buyer }), r.signature);
      if (signer.toLowerCase() !== r.buyer.toLowerCase()) return void res.status(401).json({ error: "signature is not from the buyer" });
    } catch {
      return void res.status(401).json({ error: "bad signature" });
    }
    const jobId = r.jobId.toLowerCase();
    const onChain = await d.contracts.core.getJob(jobId);
    if (Number(onChain.status) !== 0) return void res.status(409).json({ error: "a job with this id already exists on chain; register before createJob" });
    if (db.job(jobId)) return void res.status(409).json({ error: "job id already registered; pick a fresh random job id" });
    d.blobs.put(bytes);
    const row = db.insertPending({
      jobId,
      paymentKey: `core:${jobId}`,
      task: t.task,
      modelId: t.modelId,
      inputHash,
      bytes: bytes.length,
      meta: { ...meta, direct: true },
      price: t.priceTinybar,
      jobSalt: r.jobSalt,
      saltCommit,
      accessToken: hexlify(randomBytes(24)),
      validator: "none",
    });
    db.update(jobId, { payment_status: "External", buyer_evm: r.buyer.toLowerCase() });
    res.status(201).json({ jobId, inputHash, saltCommit, modelId: t.modelId, locator: cfg.publicUrl, accessToken: row.access_token, priceTinybar: t.priceTinybar.toString() });
  });

  /** only the payer receives the 202, so it carries the bearer capability for this job */
  // ---------------------------------------------------------------- direct transfer (EVM wallets)
  /**
   * POST /v1/direct/{task} with header X-Payment-Tx: <EVM tx hash> of a plain HBAR transfer to payToEvm.
   * The transfer must be SUCCESS on the Mirror Node, pay at least the price, be under 15 minutes old,
   * and not have paid for another job. Agents use x402; this exists for wallets that cannot sign x402.
   */
  for (const mf of d.manifests) {
    const task = mf.task;
    const maxBytes = mf.input.maxBytes;
    app.post(
      `/v1/direct/${task}`,
      rateLimit(cfg.rateLimitPerMin),
      (req, res, next) => upload.single("file")(req, res, (err) => (err ? res.status(400).json({ error: String(err.message ?? err) }) : next())),
      async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        try {
          const t = taskCfg(task);
          if (!d.direct || !t || !t.available) return void res.status(503).json({ error: `${task} is not available right now` });
          const txHash = String(req.header("x-payment-tx") ?? "");
          if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return void res.status(400).json({ error: "X-Payment-Tx must be the transaction hash of your HBAR transfer" });
          if (!req.file) return void res.status(400).json({ error: "multipart field 'file' is required" });
          const bytes = new Uint8Array(req.file.buffer);
          if (bytes.length > maxBytes) return void res.status(413).json({ error: `input larger than ${maxBytes} bytes` });
          let meta: Record<string, unknown>;
          try {
            meta = checkInput(mf, bytes);
          } catch (e) {
            return void res.status(415).json({ error: e instanceof MediaError ? e.message : "unreadable input" });
          }
          let validator;
          try {
            validator = parseValidator(typeof req.body?.validator === "string" ? req.body.validator : undefined);
          } catch (e) {
            return void res.status(400).json({ error: e instanceof ValidatorError ? e.message : "bad validator" });
          }
          const paymentKey = keccak256(new TextEncoder().encode(`direct:${txHash.toLowerCase()}`));
          const existing = db.jobByPaymentKey(paymentKey);
          if (existing) {
            const why = (JSON.parse(existing.meta || "{}") as { unacceptable?: string }).unacceptable;
            if (why) return void res.status(402).json({ error: why, refunded: true, refundTx: existing.refund_tx });
            return void res.status(202).json(accepted(existing)); // same transfer, same job
          }
          // the Mirror Node indexes a transfer a few seconds after consensus
          let tr: Awaited<ReturnType<NonNullable<AppDeps["direct"]>["lookup"]>> | null = null;
          for (let i = 0; i < 12 && !tr; i++) {
            tr = await d.direct.lookup(txHash).catch(() => null);
            if (!tr) await new Promise((r) => setTimeout(r, 2000));
          }
          if (!tr) return void res.status(404).json({ error: "transfer not found on the Mirror Node yet; retry in a few seconds" });
          if (!tr.ok) return void res.status(402).json({ error: "the transfer did not succeed" });
          if (tr.to !== cfg.payToEvm.toLowerCase()) return void res.status(402).json({ error: `the transfer went to ${tr.to}, not to ${cfg.payToEvm}` });
          const inputHash = inputHashOf(bytes);
          const jobId = jobIdFor(inputHash, `direct:${txHash.toLowerCase()}`).toLowerCase();
          // The money reached us but we cannot run the job (the price moved, or the transfer is too old to bind
          // to a request). Never keep it: record it once under this payment key and refund the full amount.
          const why =
            tr.amountTinybar < t.priceTinybar
              ? `paid ${tr.amountTinybar} tinybar but the price is now ${t.priceTinybar}; your transfer is being refunded in full`
              : Date.now() / 1000 - tr.consensusSeconds > 900
                ? "the transfer is older than 15 minutes; it is being refunded in full"
                : null;
          if (why) {
            db.insertPending({
              jobId, paymentKey, task, modelId: t.modelId, inputHash, bytes: bytes.length,
              meta: { payment: "direct-transfer", unacceptable: why },
              price: tr.amountTinybar, jobSalt: hexlify(randomBytes(32)), saltCommit: ZERO_COMMIT, accessToken: hexlify(randomBytes(24)), validator: "none",
            });
            d.direct.onUnacceptable(jobId, tr.payer, tr.transactionId);
            log.warn("direct transfer not accepted; refunding", { jobId, why });
            return void res.status(402).json({ error: why, refunded: true });
          }
          d.blobs.put(bytes);
          const jobSalt = hexlify(randomBytes(32));
          const row = db.insertPending({
            jobId,
            paymentKey,
            task,
            modelId: t.modelId,
            inputHash,
            bytes: bytes.length,
            meta: { ...meta, payment: "direct-transfer" },
            price: t.priceTinybar,
            jobSalt,
            saltCommit: saltCommitOf(jobSalt),
            accessToken: hexlify(randomBytes(24)),
            validator: validator.name === "min_words" ? `min_words:${validator.arg}` : validator.name,
          });
          d.direct.onPaid(jobId, tr.payer, tr.transactionId);
          res.status(202).json(accepted(row));
        } catch (e) {
          log.error("direct payment handler failed", { task, error: String(e) });
          res.status(500).json({ error: "internal error" });
        }
      },
    );
  }

  function accepted(r: JobRow) {
    return {
      jobId: r.job_id,
      accessToken: r.access_token,
      validator: r.validator,
      task: r.task,
      inputHash: r.input_hash,
      statusUrl: `${cfg.publicUrl}/v1/jobs/${r.job_id}`,
      eventsUrl: `${cfg.publicUrl}/v1/jobs/${r.job_id}/events`,
      resultUrl: `${cfg.publicUrl}/v1/jobs/${r.job_id}/result`,
    };
  }

  // ---------------------------------------------------------------- job views
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
      final: status === "Settled" || status === "Refunded" || status === "Voided" || r.payment_status === "Rejected",
      events,
    };
  }

  app.get("/v1/jobs", (req, res) => res.json(db.recentJobs(Math.min(50, Number(req.query.limit ?? 30) || 30)).map(view)));

  /** public event stream for the console (every Hallmark contract event, as the indexer sees it) */
  app.get("/v1/stream", (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(": live\n\n");
    const on = (e: { jobId: string | null; name: string; args: unknown; tx: string }) => res.write(`event: chain\ndata: ${JSON.stringify(e)}\n\n`);
    d.indexer.bus.on("event", on);
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(ping);
      d.indexer.bus.off("event", on);
    });
  });
  app.get("/v1/jobs/:id", (req, res) => {
    const r = db.job(req.params.id);
    if (!r) return void res.status(404).json({ error: "unknown job" });
    res.json(view(r));
  });

  // ---------------------------------------------------------------- private evidence access (add-on A1)
  /** "buyer" (bearer token), "operator" (signed, holds a role on the job), "watcher" (signed, listed) */
  async function who(req: Request, r: JobRow): Promise<{ kind: "buyer" | "operator" | "watcher"; address?: string } | null> {
    const bearer = (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "") || String(req.query.token ?? "");
    if (bearer && bearer === r.access_token) return { kind: "buyer" };
    const address = req.header("x-hallmark-address");
    const ts = Number(req.header("x-hallmark-timestamp"));
    const sig = req.header("x-hallmark-signature");
    if (!address || !sig || !Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 120) return null;
    try {
      if (verifyMessage(readMessage(r.job_id, address, ts), sig).toLowerCase() !== address.toLowerCase()) return null;
    } catch {
      return null;
    }
    if (cfg.watchers.includes(address.toLowerCase())) return { kind: "watcher", address };
    const seat = await d.contracts.core.seat(r.job_id, address);
    return Number(seat.role) !== 0 ? { kind: "operator", address } : null;
  }
  const guard = async (req: Request, res: Response) => {
    const r = db.job(req.params.id);
    if (!r) return void res.status(404).json({ error: "unknown job" });
    const w = await who(req, r).catch(() => null);
    if (!w) return void res.status(403).json({ error: "only the buyer, operators holding a role on this job, or listed watchers may read this" });
    return { r, w };
  };

  app.get("/v1/jobs/:id/salt", async (req, res) => {
    const g = await guard(req, res);
    if (g) res.json({ jobSalt: g.r.job_salt, saltCommit: g.r.salt_commit });
  });
  app.get("/v1/jobs/:id/input", async (req, res) => {
    const g = await guard(req, res);
    if (!g) return;
    const b = d.blobs.get(g.r.input_hash);
    if (!b) return void res.status(404).json({ error: "input not stored" });
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(Buffer.from(b));
  });
  app.get("/v1/jobs/:id/outputs/:operator", async (req, res) => {
    const g = await guard(req, res);
    if (!g) return;
    const o = db.output(g.r.job_id, req.params.operator);
    if (!o) return void res.status(404).json({ error: "no output from this operator" });
    res.json({ text: o.text, outCommit: o.out_commit });
  });

  /** operator-signed upload, accepted only for a revealed seat whose outCommit this text opens */
  app.put("/v1/jobs/:id/outputs", express.json({ limit: "32kb" }), async (req, res) => {
    const p = OutputUpload.safeParse(req.body);
    const r = db.job(req.params.id);
    if (!p.success || !r || p.data.jobId.toLowerCase() !== r.job_id.toLowerCase()) return void res.status(400).json({ error: "bad upload" });
    const u = p.data;
    try {
      const rawHash = keccak256(new TextEncoder().encode(u.raw));
      const signer = verifyMessage(outputUploadMessage({ jobId: u.jobId, operator: u.operator, outCommit: u.outCommit, rawHash }), u.signature);
      if (signer.toLowerCase() !== u.operator.toLowerCase()) return void res.status(401).json({ error: "bad signature" });
      if (outCommitOf({ chainId: cfg.chainId, core: cfg.contract, jobId: r.job_id, jobSalt: r.job_salt, text: u.text }).toLowerCase() !== u.outCommit.toLowerCase()) {
        return void res.status(400).json({ error: "text does not open outCommit" });
      }
      const job = await d.contracts.core.getJob(u.jobId);
      validate(u.text, Number(job.normSpec) as NormSpec);
      const seat = await d.contracts.core.seat(u.jobId, u.operator);
      if (!seat.revealed || String(seat.outCommit).toLowerCase() !== u.outCommit.toLowerCase()) return void res.status(409).json({ error: "no revealed seat with this commitment" });
      db.putOutput({ job_id: u.jobId, operator: u.operator, out_commit: u.outCommit, text: u.text, raw: u.raw, source: "upload" });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e instanceof NormError ? `${e.code}: ${e.message}` : String(e) });
    }
  });

  /**
   * Buyer only. provisional until settled; 409 while disputed; 410 if refunded (section 9.1).
   * Returns jobSalt so the buyer can recompute outCommit and compare it with the chain.
   */
  app.get("/v1/jobs/:id/result", async (req, res) => {
    const r = db.job(req.params.id);
    if (!r) return void res.status(404).json({ error: "unknown job" });
    const w = await who(req, r).catch(() => null);
    if (w?.kind !== "buyer") return void res.status(403).json({ error: "the result is readable only with the buyer's access token" });
    const v = view(r);
    const t = d.tasks().find((x) => x.task === r.task);
    const accuracy = t ? { expectedErrorBps: t.expectedErrorBps, sampleSize: t.errorSampleSize, metric: t.manifest.accuracy.metric, label: t.errorSampleSize > 0 ? `pinned model, measured error ${(t.expectedErrorBps / 100).toFixed(1)}% on ${t.errorSampleSize} samples` : "pinned model, error rate not measured yet" } : null;
    if (v.status === "Refunded" || v.status === "Voided" || r.payment_status === "Rejected") return void res.status(410).json({ error: "refunded", badge: v.badge, refundLink: v.payment.refundLink });
    if (["Text", "CommitteeCommit", "CommitteeReveal"].includes(v.status)) return void res.status(409).json({ error: "disputed: the committee is re-running this job", badge: v.badge });
    const exec = r.executor ? db.output(r.job_id, r.executor) : null;
    const seat = r.executor ? await d.contracts.core.seat(r.job_id, r.executor).catch(() => null) : null;
    if (!exec || !seat?.revealed || String(seat.outCommit).toLowerCase() !== exec.out_commit) return void res.status(202).json({ status: v.status, badge: v.badge, final: false });
    const validator = parseValidator(r.validator);
    res.json({
      jobId: r.job_id,
      task: r.task,
      text: exec.text,
      outCommit: exec.out_commit,
      jobSalt: r.job_salt,
      provisional: v.status !== "Settled",
      final: v.status === "Settled",
      badge: v.badge,
      status: v.status,
      validator: r.validator,
      validated: runValidator(validator, exec.raw || exec.text),
      validatorNote: "advisory: checks the raw output; no money effect",
      accuracy,
      claim: "faithful to the pinned model (checked on a sample); not a guarantee that the text is correct",
    });
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

  // ---------------------------------------------------------------- network
  // Stale-while-revalidate: always answer from the last good snapshot and refresh in the background, one
  // refresh at a time. A slow or failing public RPC (Hashio 502s, timeouts) then shows slightly old numbers
  // instead of hanging the console or returning an error.
  let networkCache: { at: number; body: Record<string, unknown> } | null = null;
  let networkRefresh: Promise<void> | null = null;
  let networkError: string | null = null;
  const refreshNetwork = () =>
    (networkRefresh ??= (async () => {
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
      const body = {
        contract: cfg.contract,
        params: Object.fromEntries(Object.entries(p.toObject()).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])),
        tasks: d.tasks().map((t) => ({ ...t, priceTinybar: t.priceTinybar.toString(), bondTinybar: t.bondTinybar.toString() })),
        operators: ops,
        pools: { auditPool: auditPool.toString(), slashPool: slashPool.toString(), treasury: treasury.toString(), escrow: escrow.toString() },
        slashes: slashes.map((s) => ({ ...JSON.parse(s.args), link: link(s.tx_hash) })),
        demoMode: cfg.demoMode,
      };
      networkCache = { at: Date.now(), body };
      networkError = null;
    })()
      .catch((e) => {
        networkError = String(e);
        log.warn("network snapshot refresh failed; serving the last good one", { error: networkError.slice(0, 200) });
      })
      .finally(() => {
        networkRefresh = null;
      }));
  app.get("/v1/network", async (_req, res) => {
    if (!networkCache || Date.now() - networkCache.at > 5000) {
      const r = refreshNetwork();
      if (!networkCache) await r; // first request ever: nothing to serve yet
    }
    if (!networkCache) return void res.status(503).json({ error: "network snapshot unavailable (the Hedera RPC is not answering); retry shortly" });
    const ageMs = Date.now() - networkCache.at;
    res.json({ ...networkCache.body, asOf: networkCache.at, stale: ageMs > 30_000, ...(networkError && ageMs > 30_000 ? { staleReason: "Hedera RPC unavailable" } : {}) });
  });

  // ---------------------------------------------------------------- demo (attack lab)
  const demoAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!cfg.demoMode || !cfg.demoControlToken || req.headers.authorization !== `Bearer ${cfg.demoControlToken}`) return void res.status(401).json({ error: "demo control disabled or bad token" });
    next();
  };
  /** {operator, behavior, role?} or {operator: "all", reset: true} */
  app.post("/demo/behavior", express.json(), demoAuth, async (req, res) => {
    const reset = req.body?.reset === true;
    const b = OperatorBehavior.safeParse(req.body?.behavior);
    const target = String(req.body?.operator ?? "").toLowerCase();
    const urls = target === "all" ? Object.values(cfg.operatorControl) : [cfg.operatorControl[target]].filter(Boolean);
    if ((!reset && !b.success) || !urls.length) return void res.status(400).json({ error: "operator (or \"all\") with a control URL and a valid behavior required" });
    const body = JSON.stringify(reset ? { reset: true } : { behavior: b.data, role: Number(req.body?.role ?? 0) });
    const out = await Promise.all(urls.map((u) => fetch(`${u}/behavior`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.demoControlToken}` }, body }).then((r) => r.status)));
    res.status(out.every((s) => s === 200) ? 200 : 502).json({ updated: urls.length, statuses: out });
  });
  app.get("/demo/operators", (_req, res) => res.json(Object.keys(cfg.operatorControl)));
  app.get("/demo/scenarios", (_req, res) => res.json({ scenarios: SCENARIOS, canSetAudit: !!d.demo?.canSetAudit, demoMode: cfg.demoMode }));
  app.post("/demo/scenario", express.json(), demoAuth, async (req, res) => {
    try {
      res.json(await d.demo!.apply(String(req.body?.id ?? "")));
    } catch (e) {
      res.status(400).json({ error: String(e instanceof Error ? e.message : e) });
    }
  });
  app.post("/demo/audit", express.json(), demoAuth, async (req, res) => {
    const bps = Number(req.body?.bps);
    if (!Number.isInteger(bps) || bps < 1 || bps > 10_000) return void res.status(400).json({ error: "bps must be 1-10000" });
    try {
      await d.demo!.setAudit(bps);
      res.json({ auditBps: bps });
    } catch (e) {
      res.status(400).json({ error: String(e instanceof Error ? e.message : e) });
    }
  });
  app.post("/demo/challenge", express.json(), demoAuth, async (req, res) => {
    try {
      res.json({ tx: await d.demo!.challenge(String(req.body?.jobId ?? "")) });
    } catch (e) {
      res.status(400).json({ error: String(e instanceof Error ? e.message : e) });
    }
  });
  app.post("/demo/canary", demoAuth, async (_req, res) => {
    if (!d.canary) return void res.status(501).json({ error: "canaries not configured" });
    void d.canary.runOnce().then((r) => !r.ok && log.warn("canary not run", { reason: r.reason })).catch((e) => log.warn("canary failed", { error: String(e) }));
    res.status(202).json({ started: true });
  });

  // ---------------------------------------------------------------- canaries (aggregate only)
  app.get("/v1/canaries", (_req, res) => res.json(d.canary ? d.canary.stats() : { enabled: false }));


  return app;
}
