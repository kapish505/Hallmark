import { logger, readJob, Status, toWire, TxSender, type Contracts, type OperatorBehavior, type WireUnits } from "@hallmark/shared";

const log = logger("demo");

export interface Scenario {
  id: string;
  title: string;
  /** what happens, in one sentence */
  expect: string;
  /** audit rate to set first (bps) */
  audit: number;
  /** behavior per role for every operator (0 = every role, 1 executor, 2 verifier, 3 committee) */
  all?: Partial<Record<number, OperatorBehavior>>;
  /** behaviors for the first N operators only (collusion) */
  first?: { n: number; behavior: OperatorBehavior };
  /** after the job reaches the challenge window, file a challenge from the demo owner key */
  challenge?: boolean;
}

/** One preset per outcome the protocol can produce (the attack lab buttons). */
export const SCENARIOS: Scenario[] = [
  { id: "honest", title: "Honest job", expect: "Settles. Re-run on a random 30% of jobs; otherwise it settles after the challenge window.", audit: 3000 },
  { id: "audited", title: "Audited job", expect: "Every job is re-run by a blind verifier; the two agree and both are paid.", audit: 10_000 },
  { id: "garbage", title: "Executor returns garbage", expect: "The verifier disagrees, the committee sides with it, the executor is slashed and you are refunded.", audit: 10_000, all: { 1: "garbage" } },
  { id: "lazy", title: "Executor uses a smaller model", expect: "Caught only where the small model's output differs; on easy inputs it may agree and settle.", audit: 10_000, all: { 1: "lazy-small-model" } },
  { id: "truncate", title: "Executor truncates the output", expect: "The shortened output mismatches; the executor is slashed and you are refunded.", audit: 10_000, all: { 1: "truncate" } },
  { id: "replay", title: "Executor replays another answer", expect: "An answer from a different input mismatches; the executor is slashed and you are refunded.", audit: 10_000, all: { 1: "replay-other-input" } },
  { id: "silent", title: "Executor never commits", expect: "The commit window expires; part of the executor's bond is taken and you are refunded.", audit: 3000, all: { 1: "silent" } },
  { id: "no-reveal", title: "Executor hides its answer", expect: "It commits but never reveals; it is penalized and you are refunded.", audit: 3000, all: { 1: "no-reveal" } },
  { id: "verifier-noshow", title: "Verifier does not show up", expect: "Penalized, a second verifier is drawn, it also stays away; the job settles marked audit skipped.", audit: 10_000, all: { 2: "silent" } },
  { id: "inconclusive", title: "Committee does not show up", expect: "Executor and verifier disagree, no committee majority forms; you are refunded and nobody is slashed for being wrong.", audit: 10_000, all: { 1: "garbage", 3: "silent" } },
  { id: "collusion", title: "Two operators collude", expect: "Two operators return the same fake text. If both land on one job the audit passes; otherwise the challenger forces an audit and the committee slashes.", audit: 3000, first: { n: 2, behavior: "collude" } },
  { id: "false-challenge", title: "Wrongful challenge", expect: "An honest unaudited result is challenged; the verifier agrees and the challenger loses its bond.", audit: 3000, challenge: true },
];

/**
 * Demo controls (token-protected, DEMO_MODE only). The audit rate and the challenge use a separate
 * demo owner key, which belongs only on a testnet demo machine.
 */
export class DemoController {
  private pendingChallenge = false;

  constructor(
    private readonly d: {
      contracts: Contracts | null;
      owner: TxSender | null;
      units: WireUnits;
      operatorControl: Record<string, string>;
      token: string;
      refreshPrices: () => Promise<unknown>;
    },
  ) {}

  get canSetAudit() {
    return this.d.owner !== null;
  }

  private async setBehaviors(body: Record<string, unknown>, urls = Object.values(this.d.operatorControl)) {
    await Promise.all(
      urls.map((u) =>
        fetch(`${u}/behavior`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.d.token}` }, body: JSON.stringify(body) }).then((r) => {
          if (!r.ok) throw new Error(`operator control ${u}: HTTP ${r.status}`);
        }),
      ),
    );
  }

  async setAudit(bps: number) {
    if (!this.d.owner || !this.d.contracts) throw new Error("DEMO_OWNER_PRIVATE_KEY is not set; change the audit rate with setParams from the owner instead");
    const core = this.d.contracts.core.connect(this.d.owner.wallet) as Contracts["core"];
    const p = (await core.getParams()).toObject();
    if (Number(p.auditBps) !== bps) {
      await this.d.owner.send(core, "setParams", [{ ...p, auditBps: bps }], { label: "setParams(auditBps)", gasLimit: 300_000 });
      log.warn(`audit rate set to ${bps / 100}% for the demo`);
    }
    await this.d.refreshPrices();
  }

  async apply(id: string) {
    const s = SCENARIOS.find((x) => x.id === id);
    if (!s) throw new Error("unknown scenario");
    await this.setBehaviors({ reset: true });
    for (const [role, b] of Object.entries(s.all ?? {})) await this.setBehaviors({ role: Number(role), behavior: b });
    if (s.first) await this.setBehaviors({ role: 0, behavior: s.first.behavior }, Object.values(this.d.operatorControl).slice(0, s.first.n));
    let audit = "unchanged (no demo owner key)";
    if (this.canSetAudit) {
      await this.setAudit(s.audit);
      audit = `${s.audit / 100}%`;
    }
    this.pendingChallenge = !!s.challenge;
    return { scenario: s, audit };
  }

  /** called by the keeper for each job that enters the challenge window */
  async maybeChallenge(jobId: string) {
    if (!this.pendingChallenge) return;
    this.pendingChallenge = false;
    await this.challenge(jobId);
  }

  async challenge(jobId: string) {
    if (!this.d.owner || !this.d.contracts) throw new Error("DEMO_OWNER_PRIVATE_KEY is not set");
    const core = this.d.contracts.core.connect(this.d.owner.wallet) as Contracts["core"];
    const j = await readJob(core, jobId);
    if (j.status !== Status.Challenge) throw new Error("job is not in its challenge window");
    const r = await this.d.owner.send(core, "challenge", [jobId], { value: toWire(j.challengeBond, this.d.units), gasLimit: 3_000_000, label: "demo challenge" });
    log.warn("demo challenge filed", { jobId, tx: r.hash });
    return r.hash;
  }
}
