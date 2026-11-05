type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = order[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;

export type Logger = Record<Level, (msg: string, extra?: Record<string, unknown>) => void>;

export function logger(name: string): Logger {
  const at =
    (level: Level) =>
    (msg: string, extra?: Record<string, unknown>) => {
      if (order[level] < min) return;
      const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${name}] ${msg}`;
      const tail = extra ? " " + JSON.stringify(extra, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) : "";
      (level === "error" || level === "warn" ? console.error : console.log)(line + tail);
    };
  return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") };
}
