import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GATEWAY, getJson, type JobView, type NetworkView } from "../api";

/**
 * Realtime data. A server-sent event stream pushes every contract event; polling runs underneath so
 * the console stays live even where a tunnel blocks event streams.
 */
export function useStream(): boolean {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);
  useEffect(() => {
    // free ngrok tunnels answer browser event streams with a warning page, so poll only there
    if (!GATEWAY || /ngrok-free\.(app|dev)$/.test(new URL(GATEWAY).hostname)) return;
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${GATEWAY}/v1/stream`);
      es.onopen = () => setLive(true);
      es.onerror = () => setLive(false);
      es.addEventListener("chain", (m) => {
        const e = JSON.parse((m as MessageEvent).data) as { jobId: string | null };
        void qc.invalidateQueries({ queryKey: ["jobs"] });
        void qc.invalidateQueries({ queryKey: ["network"] });
        if (e.jobId) void qc.invalidateQueries({ queryKey: ["job", e.jobId.toLowerCase()] });
      });
    } catch {
      setLive(false);
    }
    return () => es?.close();
  }, [qc]);
  return live;
}

export const useJobs = () => useQuery({ queryKey: ["jobs"], queryFn: () => getJson<JobView[]>("/v1/jobs?limit=25"), refetchInterval: 4000 });
export const useNetwork = () => useQuery({ queryKey: ["network"], queryFn: () => getJson<NetworkView>("/v1/network"), refetchInterval: 8000 });
export const useJob = (id: string) =>
  useQuery({ queryKey: ["job", id.toLowerCase()], queryFn: () => getJson<JobView>(`/v1/jobs/${id}`), enabled: /^0x[0-9a-fA-F]{64}$/.test(id), refetchInterval: 3000 });

export interface ResultView {
  text?: string;
  provisional?: boolean;
  final?: boolean;
  error?: string;
  validated?: string;
  validator?: string;
  accuracy?: { label: string };
}
export const useResult = (id: string, token: string) =>
  useQuery({ queryKey: ["result", id.toLowerCase(), token], queryFn: () => getJson<ResultView>(`/v1/jobs/${id}/result?token=${token}`), enabled: !!token && /^0x[0-9a-fA-F]{64}$/.test(id),
    // stop once the answer is final, or the job was refunded (410): neither changes again
    refetchInterval: (q) => {
      const d = q.state.data;
      return d && (d.error === "refunded" || (d.text !== undefined && !d.provisional)) ? false : 3000;
    },
  });

/** seconds left until a unix deadline, ticking every second */
export function useCountdown(deadline: number | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);
  return deadline ? Math.max(0, Math.round(deadline - now)) : null;
}
