/** Gate G1 helper: which facilitators list v2 `exact` on hedera:testnet, and their feePayer. */
import { DEFAULTS, fetchJson } from "../packages/shared/src/index.js";

for (const url of (process.env.FACILITATOR_URLS ?? DEFAULTS.facilitators.join(",")).split(",")) {
  try {
    const s = await fetchJson<{ kinds: Array<{ x402Version: number; scheme: string; network: string; extra?: Record<string, unknown> }> }>(`${url}/supported`, { retries: 1 });
    const k = s.kinds.find((x) => x.network === "hedera:testnet" && x.scheme === "exact" && x.x402Version === 2);
    console.log(`${k ? "OK  " : "NO  "} ${url}  ${k ? `feePayer=${k.extra?.feePayer}` : "(no hedera:testnet exact v2)"}`);
  } catch (e) {
    console.log(`DOWN ${url}  ${String(e)}`);
  }
}
