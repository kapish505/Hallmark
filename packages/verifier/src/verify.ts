import { keccak256, type JsonRpcProvider, type LogDescription } from "ethers";
import {
  connect,
  fetchJson,
  ifaces,
  ModelClass,
  NormError,
  Outcome,
  outputHashOf,
  overlapText,
  readJob,
  Role,
  SlashReason,
  Status,
  statusName,
  validate,
  ZERO_ADDRESS,
  type Addresses,
  type NormSpec,
} from "@hallmark/shared";

export type CheckResult = { name: string; result: "PASS" | "FAIL" | "SKIP"; detail: string };

export interface VerifyDeps {
  provider: JsonRpcProvider;
  addresses: Addresses;
  /** used ONLY to learn tx hashes and to fetch blobs by hash; everything is re-checked */
  gatewayUrl: string;
}

interface Ev {
  name: string;
  args: LogDescription["args"];
  tx: string;
  block: number;
  index: number;
}

/**
 * hallmark-verify (section 9.4): re-derive a job's verdict from public data. Events are re-read
 * from transaction receipts; inputs and outputs are fetched by hash and re-hashed locally; the
 * comparison, the committee majority and the money movements are recomputed.
 */
export async function verifyJob(jobId: string, d: VerifyDeps): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const add = (name: string, ok: boolean | null, detail: string) => out.push({ name, result: ok === null ? "SKIP" : ok ? "PASS" : "FAIL", detail });
  const c = connect(d.addresses, d.provider);
  const core = c.core;
  const j = await readJob(core, jobId);
  add("job exists on chain", j.status !== Status.None, `status ${statusName(j.status)}`);
  if (j.status === Status.None) return out;

  // 1. events, re-read from receipts
  const view = await fetchJson<{ events: Array<{ tx: string }> }>(`${d.gatewayUrl}/v1/jobs/${jobId}`).catch(() => ({ events: [] }));
  const txs = [...new Set(view.events.map((e) => e.tx))];
  const evs: Ev[] = [];
  for (const tx of txs) {
    const r = await d.provider.getTransactionReceipt(tx);
    if (!r) continue;
    for (const l of r.logs) {
      if (l.address.toLowerCase() !== d.addresses.HALLMARK_ADDRESS.toLowerCase()) continue;
      const p = ifaces.core.parseLog({ topics: [...l.topics], data: l.data });
      if (p && (!p.args.jobId || String(p.args.jobId).toLowerCase() === jobId.toLowerCase())) evs.push({ name: p.name, args: p.args, tx, block: r.blockNumber, index: l.index });
    }
  }
  evs.sort((a, b) => a.block - b.block || a.index - b.index);
  add("events re-read from receipts", evs.length > 0, `${evs.length} events from ${txs.length} transactions`);
  const find = (n: string) => evs.filter((e) => e.name === n);

  // 2. input binding
  try {
    const res = await fetch(`${d.gatewayUrl}/inputs/${j.inputHash}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    add("input bytes hash to the on-chain inputHash", res.ok && keccak256(bytes).toLowerCase() === j.inputHash.toLowerCase(), `${bytes.length} bytes`);
  } catch (e) {
    add("input bytes hash to the on-chain inputHash", null, `could not fetch input: ${String(e)}`);
  }

  // 3. commit-then-draw order
  const eCommit = find("Committed").find((e) => Number(e.args.role) === Role.Executor);
  const draw = find("AuditDrawn")[0];
  if (draw && eCommit) add("audit drawn after the executor committed", draw.block > eCommit.block || (draw.block === eCommit.block && draw.index > eCommit.index), `prng source: ${draw.args.prng ? "Hedera PRNG" : "fallback (weaker)"}`);
  else add("audit drawn after the executor committed", null, "no draw yet");

  // 4. reveals and texts
  const texts = new Map<string, string | null>();
  for (const r of find("Revealed")) {
    const who = String(r.args.who);
    const s = await core.seat(jobId, who);
    const h = String(r.args.outputHash);
    const okSeat = s.revealed && String(s.outputHash).toLowerCase() === h.toLowerCase();
    let text: string | null = null;
    try {
      const res = await fetch(`${d.gatewayUrl}/outputs/by-hash/${h}`);
      if (res.ok) text = await res.text();
    } catch {
      /* unavailable */
    }
    let normOk: boolean | null = null;
    let detail = text === null ? "text unavailable in the evidence store" : "";
    if (text !== null) {
      normOk = outputHashOf(text).toLowerCase() === h.toLowerCase();
      try {
        validate(text, j.normSpec as NormSpec);
      } catch (e) {
        normOk = false;
        detail = e instanceof NormError ? e.code : String(e);
      }
    }
    texts.set(h.toLowerCase(), text);
    add(`reveal by ${who.slice(0, 10)} (role ${Number(r.args.role)}) matches its seat`, okSeat, `outputHash ${h.slice(0, 18)}…`);
    add(`text of ${who.slice(0, 10)} hashes to its outputHash and is normalized`, normOk, detail);
  }
  const hashOf = async (a: string) => (a === ZERO_ADDRESS ? null : String((await core.seat(jobId, a)).outputHash).toLowerCase());
  const consistent = (a: string | null, b: string | null) => {
    if (!a || !b) return false;
    if (a === b) return true;
    if (j.cls !== ModelClass.TOLERANCE) return false;
    const ta = texts.get(a);
    const tb = texts.get(b);
    return ta != null && tb != null && overlapText(ta, tb) >= j.tauBps;
  };

  // 5. executor vs verifier
  const cmp = find("Compared")[0];
  const he = await hashOf(j.executor);
  const hv = await hashOf(j.verifier);
  if (cmp && he && hv) {
    const mine = consistent(he, hv);
    add("executor/verifier comparison recomputed", mine === Boolean(cmp.args.agree), `chain: agree=${cmp.args.agree}, overlap ${cmp.args.overlapBps}; recomputed agree=${mine}`);
  } else add("executor/verifier comparison recomputed", null, "no comparison on this job");

  // 6. committee majority
  const res = find("Resolved")[0];
  if (res && Number(res.args.outcome) !== Outcome.Inconclusive && he && hv) {
    const members: string[] = await core.committeeOf(jobId);
    let cE = 0;
    let cV = 0;
    for (const m of members) {
      const s = await core.seat(jobId, m);
      if (!s.revealed) continue;
      const h = String(s.outputHash).toLowerCase();
      if (consistent(h, he)) cE++;
      if (consistent(h, hv)) cV++;
    }
    const thr = Math.floor(j.committeeSize / 2) + 1;
    const exp = cE >= thr && cV < thr ? Outcome.VerifierWrong : cV >= thr && cE < thr ? Outcome.ExecutorWrong : cE >= thr ? Outcome.BothConsistent : Outcome.Inconclusive;
    add("committee outcome recomputed", exp === Number(res.args.outcome), `chain outcome ${res.args.outcome}; recomputed ${exp} (E ${cE}, V ${cV}, threshold ${thr})`);
  } else add("committee outcome recomputed", null, res ? "inconclusive (refund, no slash)" : "no committee on this job");

  // 7. money follows the verdict
  const wrong = find("Slashed").filter((e) => Number(e.args.reason) === SlashReason.Wrong).map((e) => String(e.args.who).toLowerCase());
  const refunded = find("JobRefunded").length > 0;
  if (res && Number(res.args.outcome) === Outcome.ExecutorWrong) add("executor slashed and buyer refunded", wrong.includes(j.executor.toLowerCase()) && refunded, `slashed: ${wrong.join(", ")}`);
  else if (res && Number(res.args.outcome) === Outcome.VerifierWrong) add("verifier slashed and executor paid", wrong.includes(j.verifier.toLowerCase()) && !refunded, `slashed: ${wrong.join(", ")}`);
  else if (j.status === Status.Settled) add("settled job paid the executor", find("Paid").some((e) => String(e.args.to).toLowerCase() === j.executor.toLowerCase() && Number(e.args.kind) === 1), "");
  else if (j.status === Status.Refunded) add("refunded job returned the full price", refunded, "");

  // 8. global conservation
  const [bal, acc] = await Promise.all([d.provider.getBalance(d.addresses.HALLMARK_ADDRESS), core.accounted()]);
  const wireDiv = bal === BigInt(acc) ? 1n : 10_000_000_000n; // Hedera relay reports weibar
  add("contract balance equals its accounted liabilities", bal / wireDiv === BigInt(acc), `balance ${bal / wireDiv}, accounted ${acc}`);
  return out;
}
