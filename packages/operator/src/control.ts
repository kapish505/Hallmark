import { createServer, type Server } from "node:http";
import { OperatorBehavior, logger } from "@hallmark/shared";

const log = logger("control");

/** Demo-only control endpoint: GET/POST /behavior (bearer token). */
export function startControl(port: number, token: string | undefined, get: () => OperatorBehavior, set: (b: OperatorBehavior) => void): Server {
  const srv = createServer((req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url !== "/behavior") return send(404, { error: "not found" });
    if (req.method === "GET") return send(200, { behavior: get() });
    if (req.method !== "POST") return send(405, { error: "method" });
    if (!token || req.headers.authorization !== `Bearer ${token}`) return send(401, { error: "unauthorized" });
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const b = OperatorBehavior.parse(JSON.parse(body).behavior);
        set(b);
        log.warn(`behavior set to ${b}`);
        send(200, { behavior: b });
      } catch {
        send(400, { error: "behavior must be one of " + OperatorBehavior.options.join(", ") });
      }
    });
  });
  srv.listen(port, () => log.info(`control on :${port}`));
  return srv;
}
