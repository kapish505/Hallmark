import { createServer, type Server } from "node:http";
import { OperatorBehavior, logger } from "@hallmark/shared";

const log = logger("control");

/** behavior per role (0 = default for every role; 1 executor, 2 verifier, 3 committee) */
export type BehaviorMap = Partial<Record<number, OperatorBehavior>>;
export const behaviorFor = (m: BehaviorMap, role: number): OperatorBehavior => m[role] ?? m[0] ?? "honest";

/**
 * Demo-only control endpoint (bearer token): GET /behavior, POST /behavior {behavior, role?}.
 * POST {reset: true} restores honest for every role.
 */
export function startControl(port: number, token: string | undefined, map: BehaviorMap): Server {
  const srv = createServer((req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url !== "/behavior") return send(404, { error: "not found" });
    if (req.method === "GET") return send(200, { behavior: map });
    if (req.method !== "POST") return send(405, { error: "method" });
    if (!token || req.headers.authorization !== `Bearer ${token}`) return send(401, { error: "unauthorized" });
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const j = JSON.parse(body) as { behavior?: string; role?: number; reset?: boolean };
        if (j.reset) for (const k of Object.keys(map)) delete map[Number(k)];
        else {
          const role = Number(j.role ?? 0);
          if (![0, 1, 2, 3].includes(role)) throw new Error("role");
          map[role] = OperatorBehavior.parse(j.behavior);
          log.warn(`behavior for role ${role} set to ${map[role]}`);
        }
        send(200, { behavior: map });
      } catch {
        send(400, { error: "behavior must be one of " + OperatorBehavior.options.join(", ") + "; role 0-3" });
      }
    });
  });
  srv.listen(port, () => log.info(`control on :${port}`));
  return srv;
}
