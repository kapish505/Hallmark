import { Contract, keccak256 } from "ethers";
import { x402Client, type PaymentPolicy } from "@x402/core/client";
import type { SchemeNetworkClient } from "@x402/core/types";
import { wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import {
  DEFAULTS,
  HBAR_ASSET,
  Manifest,
  JobAccepted,
  outCommitOf,
  readJob,
  type Task,
  X402_NETWORK,
  abis,
  hashscanTx,
  logger,
  sleep,
  makeProvider,
  rpcUrls,
} from "@hallmark/shared";
import { SpendTracker, type SpendPolicy } from "./policy.js";

const log = logger("agent");

export interface TaskResult {
  jobId: string;
  task: Task;
  text: string | null;
  provisional: boolean;
  final: boolean;
  badge: string;
  status: string;
  payment: { transaction: string | null; link: string | null; amountTinybar: string };
  inputHashOnChain: string | null;
  inputHashMatches: boolean | null;
  /** the delivered text, with the job salt, opens the executor's on-chain outCommit (add-on A1) */
  commitmentMatches: boolean | null;
  /** advisory buyer validator (add-on A3): no money effect */
  validator: string;
  validated: "pass" | "fail" | "n/a";
  /** add-on A2, e.g. "pinned model, measured error 4.1% on 120 samples" */
  accuracy: string | null;
  /** bearer capability for this job's result and evidence (keep it private) */
  accessToken: string;
  txLinks: Array<{ name: string; link: string | null }>;
  refund?: unknown;
}

export interface AgentOptions {
  gatewayUrl: string;
  policy: SpendPolicy;
  /** EVM RPC for the on-chain inputHash check (T1 mitigation) */
  rpcUrl?: string;
  /** comma separated relays tried when rpcUrl fails (Hashio by default) */
  rpcFallbackUrls?: string;
  hashscanUrl?: string;
}

export interface RunOpts {
  filename?: string;
  /** accept-provisional: return once an (unaudited, bond-backed) result exists; require-final: wait for settlement */
  mode?: "accept-provisional" | "require-final";
  timeoutMs?: number;
  /** advisory validator from the gateway's whitelist (none, min_words:<n>, date_iso, amount_present, invoice_total) */
  validator?: string;
}

/**
 * Autonomous buyer: discovers the manifest, pays over x402 with no human approval, checks the
 * 402 terms against the manifest and its spend policy before signing, verifies the on-chain
 * inputHash equals keccak256(input), and waits for a provisional or final result.
 */
export class HallmarkAgent {
  readonly spend: SpendTracker;
  private manifest: Manifest | null = null;
  private readonly fetchPaid: typeof fetch;
  private lastRefusal: string | null = null;
  /** manifest entry of the task currently being bought */
  private buying: Manifest["tasks"][number] | null = null;

  constructor(private readonly o: AgentOptions, scheme: SchemeNetworkClient) {
    this.spend = new SpendTracker(o.policy);
    const policy: PaymentPolicy = (_v, reqs) =>
      reqs.filter((r) => {
        if (!this.manifest) return false;
        const why = this.buying ? this.spend.check(r, this.manifest, this.buying.priceTinybar) : "no task selected";
        if (why) this.lastRefusal = why;
        return why === null;
      });
    const client = x402Client.fromConfig({
      schemes: [{ network: X402_NETWORK, client: scheme }],
      policies: [policy],
      // HBAR is not a USD "default asset" in x402: allow it explicitly with our per-call cap.
      spendControls: {
        maxAmountPerPayment: false,
        allowedAssets: [{ network: X402_NETWORK, asset: HBAR_ASSET, maxAmountPerPayment: o.policy.maxPricePerCallTinybar.toString() }],
      },
    });
    this.fetchPaid = wrapFetchWithPayment(fetch, client) as typeof fetch;
  }

  /** Hedera testnet agent from an ECDSA account. The buyer must not be the gateway's payTo (E6). */
  static async hedera(o: AgentOptions & { accountId: string; privateKey: string }) {
    const signer = createClientHederaSigner(o.accountId, PrivateKey.fromStringECDSA(o.privateKey), { network: X402_NETWORK });
    const agent = new HallmarkAgent(o, new ExactHederaScheme(signer));
    const m = await agent.discover();
    if (m.payTo === o.accountId) throw new Error("buyer account equals the gateway payTo; the facilitator would reject it (E6)");
    return agent;
  }

  async discover(): Promise<Manifest> {
    const res = await fetch(`${this.o.gatewayUrl}/.well-known/hallmark.json`);
    if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
    this.manifest = Manifest.parse(await res.json());
    return this.manifest;
  }

  /** Speech to text (16 kHz mono WAV). */
  transcribe(audio: Uint8Array, opts: RunOpts = {}) {
    return this.run("asr", audio, opts);
  }

  /** Image to text (PNG). */
  ocr(image: Uint8Array, opts: RunOpts = {}) {
    return this.run("ocr", image, opts);
  }

  async run(task: Task, input: Uint8Array, opts: RunOpts = {}): Promise<TaskResult> {
    const m = this.manifest ?? (await this.discover());
    const entry = m.tasks.find((t) => t.task === task);
    if (!entry || !entry.available) throw new Error(`gateway does not offer ${task} right now`);
    const price = BigInt(entry.priceTinybar);
    // refuse before even asking when the advertised price already breaks the policy
    const pre = this.spend.check({ network: m.network, asset: m.asset, amount: entry.priceTinybar, payTo: m.payTo }, m, entry.priceTinybar);
    if (pre) throw new Error(`policy refused: ${pre}`);
    this.buying = entry;
    log.info("buying", { task, price: entry.priceTinybar, class: entry.class, auditBps: entry.auditBps, spentSoFar: this.spend.spent.toString() });

    const form = new FormData();
    form.append("file", new Blob([input]), opts.filename ?? (task === "asr" ? "clip.wav" : "image.png"));
    if (opts.validator) form.append("validator", opts.validator);
    this.lastRefusal = null;
    let res: Response;
    try {
      res = await this.fetchPaid(entry.endpoint, { method: "POST", body: form });
    } catch (e) {
      throw new Error(this.lastRefusal ? `policy refused: ${this.lastRefusal}` : `payment failed: ${String(e)}`);
    }
    const prHeader = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
    const settle = prHeader ? decodePaymentResponseHeader(prHeader) : null;
    if (res.status !== 202) throw new Error(`gateway answered ${res.status}: ${await res.text()}`);
    const acc = JobAccepted.parse(await res.json());
    const hs = this.o.hashscanUrl ?? DEFAULTS.hashscanUrl;
    if (settle?.success) {
      this.spend.record({ task, jobId: acc.jobId, amountTinybar: price, payTo: m.payTo, transaction: settle.transaction, at: new Date().toISOString() });
      log.info("paid", { jobId: acc.jobId, tx: settle.transaction, link: hashscanTx(hs, settle.transaction) });
    }

    const localHash = keccak256(input);
    if (localHash.toLowerCase() !== acc.inputHash.toLowerCase()) throw new Error("gateway reported a different inputHash than our audio");

    const deadline = Date.now() + (opts.timeoutMs ?? 300_000);
    const mode = opts.mode ?? "accept-provisional";
    let chainHash: string | null = null;
    for (;;) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for job ${acc.jobId}`);
      if (!chainHash) chainHash = await this.onChainInputHash(acc.jobId, m);
      const r = await fetch(acc.resultUrl, { headers: { Authorization: `Bearer ${acc.accessToken}` } });
      const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      const done = r.status === 410 || r.status === 404 || (r.status === 200 && (mode === "accept-provisional" || body.final === true));
      if (done) {
        const job = (await fetch(acc.statusUrl).then((x) => x.json())) as { events: Array<{ name: string; link: string | null }>; status: string };
        if (!chainHash) chainHash = await this.onChainInputHash(acc.jobId, m);
        const commitmentMatches = typeof body.text === "string" && typeof body.jobSalt === "string" ? await this.checkCommitment(acc.jobId, m, body.text, body.jobSalt) : null;
        if (commitmentMatches === false) log.error("delivered text does NOT open the executor's on-chain commitment", { jobId: acc.jobId });
        const acc2 = body.accuracy as { label?: string } | undefined;
        return {
          jobId: acc.jobId,
          task,
          text: (body.text as string) ?? null,
          provisional: body.provisional === true,
          final: body.final === true || r.status === 410,
          badge: String(body.badge ?? "refunded"),
          status: job.status,
          payment: { transaction: settle?.transaction ?? null, link: settle ? hashscanTx(hs, settle.transaction) : null, amountTinybar: price.toString() },
          inputHashOnChain: chainHash,
          inputHashMatches: chainHash ? chainHash.toLowerCase() === localHash.toLowerCase() : null,
          commitmentMatches,
          validator: acc.validator,
          validated: (body.validated as "pass" | "fail" | "n/a") ?? "n/a",
          accuracy: acc2?.label ?? null,
          accessToken: acc.accessToken,
          txLinks: job.events.map((e) => ({ name: e.name, link: e.link })),
          refund: r.status === 410 ? body : undefined,
        };
      }
      await sleep(2000);
    }
  }

  /** add-on A1: recompute outCommit from the delivered text and the salt; compare with the chain. */
  private async checkCommitment(jobId: string, m: Manifest, text: string, jobSalt: string): Promise<boolean | null> {
    try {
      const provider = makeProvider(rpcUrls(this.o.rpcUrl ?? DEFAULTS.rpcUrl, this.o.rpcFallbackUrls), m.chainId);
      const core = new Contract(m.contract, abis.Hallmark, provider);
      const j = await readJob(core, jobId);
      if (keccak256(jobSalt).toLowerCase() !== j.saltCommit.toLowerCase()) return false;
      const seat = await core.seat(jobId, j.executor);
      if (!seat.revealed) return null;
      return outCommitOf({ chainId: m.chainId, core: m.contract, jobId, jobSalt, text }).toLowerCase() === String(seat.outCommit).toLowerCase();
    } catch {
      return null;
    }
  }

  /** T1 mitigation: the job the gateway created must commit to OUR audio. */
  private async onChainInputHash(jobId: string, m: Manifest): Promise<string | null> {
    try {
      const provider = makeProvider(rpcUrls(this.o.rpcUrl ?? DEFAULTS.rpcUrl, this.o.rpcFallbackUrls), m.chainId);
      const core = new Contract(m.contract, abis.Hallmark, provider);
      const j = await readJob(core, jobId);
      if (j.status === 0) return null;
      return j.inputHash;
    } catch {
      return null;
    }
  }
}
