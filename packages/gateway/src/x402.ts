import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { FacilitatorClient, RoutesConfig } from "@x402/core/server";
type RouteConfig = Extract<RoutesConfig, { accepts: unknown }>;
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { paymentMiddleware } from "@x402/express";
import { fetchJson, HBAR_ASSET, logger, X402_NETWORK } from "@hallmark/shared";

const log = logger("x402");

interface Supported {
  kinds: Array<{ x402Version: number; scheme: string; network: string; extra?: Record<string, unknown> }>;
}

/**
 * Pick the first facilitator whose /supported lists v2 `exact` on hedera:testnet (E7):
 * Blocky402 -> Ax402 -> x402.org. Never falls back to a fake/demo mode.
 */
export async function chooseFacilitator(urls: string[]): Promise<{ url: string; feePayer: string | null }> {
  for (const url of urls) {
    try {
      const s = await fetchJson<Supported>(`${url.replace(/\/$/, "")}/supported`, { retries: 1, timeoutMs: 8000 });
      const kind = s.kinds.find((k) => k.x402Version === 2 && k.scheme === "exact" && k.network === X402_NETWORK);
      if (kind) {
        const feePayer = typeof kind.extra?.feePayer === "string" ? kind.extra.feePayer : null;
        log.info("facilitator selected", { url, feePayer });
        return { url, feePayer };
      }
      log.warn("facilitator lacks hedera:testnet exact v2", { url });
    } catch (e) {
      log.warn("facilitator unreachable", { url, error: String(e) });
    }
  }
  throw new Error(`no facilitator supports ${X402_NETWORK}; tried ${urls.join(", ")}`);
}

export interface SettledInfo {
  jobId: string;
  payer: string;
  transaction: string;
}

/**
 * x402 middleware for POST /v1/transcribe and /v1/ocr. Flow (G1, read from @x402/express 2.28.0):
 * verify -> handler runs -> settle only if the handler returned < 400 -> onAfterSettle.
 * The handler's buffered 202 body is in the settle hook's transportContext, so the hook reads
 * the jobId from it and hands off to the pipeline without blocking the response.
 */
export function buildPaymentMiddleware(o: {
  facilitator: FacilitatorClient;
  payTo: string;
  /** one fixed price per task route, read from the contract; never a client-supplied price */
  routes: Array<{ path: string; priceTinybar: bigint; description: string }>;
  onSettled: (s: SettledInfo) => void;
  onSettleFailure?: (reason: string) => void;
}) {
  const server = new x402ResourceServer(o.facilitator).register(X402_NETWORK, new ExactHederaScheme());
  server.onAfterSettle(async (ctx) => {
    if (ctx.phase !== "after-handler" || !ctx.result.success) return;
    const tc = ctx.transportContext as { responseBody?: Buffer } | undefined;
    let jobId: string | undefined;
    try {
      jobId = JSON.parse(tc?.responseBody?.toString("utf8") ?? "{}").jobId;
    } catch {
      jobId = undefined;
    }
    if (!jobId) {
      log.error("settled payment without a jobId in the handler response", { tx: ctx.result.transaction });
      return;
    }
    o.onSettled({ jobId, payer: ctx.result.payer ?? "", transaction: ctx.result.transaction });
  });
  server.onSettleFailure(async (ctx) => {
    log.warn("settlement failed (E3: no job is created)", { error: String(ctx.error) });
    o.onSettleFailure?.(String(ctx.error));
  });

  const routes: Record<string, RouteConfig> = {};
  for (const t of o.routes) {
    routes[`POST ${t.path}`] = {
      accepts: {
        scheme: "exact",
        network: X402_NETWORK,
        payTo: o.payTo,
        price: { asset: HBAR_ASSET, amount: t.priceTinybar.toString() },
        maxTimeoutSeconds: 30,
      },
      description: t.description,
      mimeType: "application/json",
    };
  }
  return paymentMiddleware(routes, server);
}

export function httpFacilitator(url: string): FacilitatorClient {
  return new HTTPFacilitatorClient({ url });
}
