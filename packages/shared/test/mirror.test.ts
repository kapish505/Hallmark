import { afterEach, describe, expect, it, vi } from "vitest";
import { MirrorLogSource, ifaces } from "../src/index.js";

const CORE = "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0";
const jobId = "0x" + "ab".repeat(32);
function committedLog(ts: string, index: number, miner: string) {
  const enc = ifaces.core.encodeEventLog("Committed", [jobId, miner, 1]);
  return { address: CORE, contract_id: "0.0.1", data: enc.data, index, topics: enc.topics, block_number: 1, timestamp: ts, transaction_hash: "0x" + index.toString(16).padStart(64, "0"), transaction_index: 0 };
}

afterEach(() => vi.unstubAllGlobals());

describe("MirrorLogSource", () => {
  it("follows links.next, decodes, and never repeats logs at the cursor timestamp", async () => {
    const m1 = "0x" + "11".repeat(20);
    const m2 = "0x" + "22".repeat(20);
    const pages: Record<string, unknown> = {
      first: { logs: [committedLog("100.000000001", 0, m1)], links: { next: "/api/v1/contracts/x/results/logs?page=2" } },
      second: { logs: [committedLog("100.000000001", 1, m2)], links: { next: null } },
      // next poll: node returns the cursor-timestamp logs again (gte) plus a new one
      third: { logs: [committedLog("100.000000001", 0, m1), committedLog("100.000000001", 1, m2), committedLog("101.000000000", 0, m1)], links: { next: null } },
    };
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const key = call === 0 ? "first" : String(url).includes("page=2") ? "second" : "third";
        call++;
        return new Response(JSON.stringify(pages[key]), { status: 200 });
      }),
    );
    const src = new MirrorLogSource("https://mirror.example/api/v1", [{ address: CORE, iface: ifaces.core }]);
    const a = await src.poll();
    expect(a.map((e) => [e.name, e.logIndex])).toEqual([
      ["Committed", 0],
      ["Committed", 1],
    ]);
    expect(src.cursor()).toBe("100.000000001");
    const b = await src.poll();
    expect(b.map((e) => [e.position, e.logIndex])).toEqual([["101.000000000", 0]]);
    expect(String((fetch as unknown as { mock: { calls: string[][] } }).mock.calls[1][0])).toBe("https://mirror.example/api/v1/contracts/x/results/logs?page=2");
  });
});
