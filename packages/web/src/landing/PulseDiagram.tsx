import { useEffect, useMemo, useRef, useState } from "react";

export interface DNode {
  id: string;
  x: number;
  y: number;
  label: string;
  sub?: string;
  /** "core" draws the ink tile with a brass hairline; "ghost" a dashed outline */
  kind?: "core" | "node" | "ghost";
  w?: number;
}
export interface DEdge {
  id: string;
  from: string;
  to: string;
  /** optional bend points between the two nodes */
  via?: Array<[number, number]>;
  dashed?: boolean;
}
export interface DStep {
  edge: string;
  /** start and length as fractions of the cycle */
  t0: number;
  dur: number;
  tone?: "brass" | "ok" | "bad" | "paper";
  reverse?: boolean;
  /** a short label shown at the head while it travels */
  tag?: string;
}
export interface DFlash {
  node: string;
  t0: number;
  dur: number;
  tone: "brass" | "ok" | "bad";
}

const TONE: Record<string, string> = { brass: "var(--brass)", ok: "var(--ok)", bad: "var(--bad)", paper: "var(--paper)" };

function pathPoints(e: DEdge, nodes: Map<string, DNode>): Array<[number, number]> {
  const a = nodes.get(e.from)!;
  const b = nodes.get(e.to)!;
  return [[a.x, a.y], ...(e.via ?? []), [b.x, b.y]];
}

function lengthOf(pts: Array<[number, number]>) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

function at(pts: Array<[number, number]>, f: number): [number, number] {
  const L = lengthOf(pts);
  let d = Math.max(0, Math.min(1, f)) * L;
  for (let i = 1; i < pts.length; i++) {
    const s = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (d <= s || i === pts.length - 1) {
      const k = s === 0 ? 0 : Math.min(1, d / s);
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
    }
    d -= s;
  }
  return pts[pts.length - 1];
}

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

/**
 * Node-and-line diagram with light pulses on one cycle (2.5-4 s). The light is the only accent;
 * lines are hairlines. It restarts when the pointer or focus enters, has a pause control, and under
 * reduced motion (or when paused) holds the busiest frame.
 */
export function PulseDiagram(p: {
  width: number;
  height: number;
  nodes: DNode[];
  edges: DEdge[];
  program: DStep[];
  flashes?: DFlash[];
  cycle?: number;
  /** a program of several cycles: the step list for each cycle index */
  programs?: DStep[][];
  flashSets?: DFlash[][];
  label: string;
  stillAt?: number;
  className?: string;
}) {
  const cycle = (p.cycle ?? 3.2) * 1000;
  const nodes = useMemo(() => new Map(p.nodes.map((n) => [n.id, n])), [p.nodes]);
  const paths = useMemo(() => new Map(p.edges.map((e) => [e.id, pathPoints(e, nodes)])), [p.edges, nodes]);
  const programs = p.programs ?? [p.program];
  const flashSets = p.flashSets ?? [p.flashes ?? []];
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [frame, setFrame] = useState<{ t: number; k: number }>({ t: p.stillAt ?? 0.55, k: 0 });
  const start = useRef(performance.now());
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => setReduced(mq.matches || innerWidth < 640);
    set();
    mq.addEventListener("change", set);
    addEventListener("resize", set);
    return () => {
      mq.removeEventListener("change", set);
      removeEventListener("resize", set);
    };
  }, []);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const tick = (now: number) => {
      if (!pausedRef.current) {
        const el = now - start.current;
        setFrame({ t: (el % cycle) / cycle, k: Math.floor(el / cycle) });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced, cycle]);

  const restart = () => {
    if (performance.now() - start.current > 800 && !paused) start.current = performance.now() - (frame.k % programs.length) * cycle;
  };
  const still = reduced || paused;
  const t = still && reduced ? (p.stillAt ?? 0.55) : frame.t;
  const prog = programs[frame.k % programs.length];
  const flashes = flashSets[frame.k % flashSets.length] ?? [];
  const lit = new Set<string>();
  for (const s of prog) if (t >= s.t0 && t <= s.t0 + s.dur + 0.12) lit.add(s.edge);

  return (
    <div className={`pd ${p.className ?? ""}`} onPointerEnter={restart} onFocus={restart} tabIndex={-1}>
      <svg viewBox={`0 0 ${p.width} ${p.height}`} role="img" aria-label={p.label}>
        <defs>
          <radialGradient id="pd-glow">
            <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        {p.edges.map((e) => {
          const pts = paths.get(e.id)!;
          return (
            <polyline
              key={e.id}
              points={pts.map((q) => q.join(",")).join(" ")}
              className={`pd-edge${lit.has(e.id) ? " is-lit" : ""}${e.dashed ? " is-dashed" : ""}`}
            />
          );
        })}
        {prog.map((s, i) => {
          const local = (t - s.t0) / s.dur;
          if (local < 0 || local > 1) return null;
          const pts = paths.get(s.edge);
          if (!pts) return null;
          const f = ease(s.reverse ? 1 - local : local);
          const [x, y] = at(pts, f);
          const tail = at(pts, Math.max(0, Math.min(1, s.reverse ? f + 0.18 : f - 0.18)));
          const c = TONE[s.tone ?? "brass"];
          return (
            <g key={i} className="pd-pulse">
              <line x1={tail[0]} y1={tail[1]} x2={x} y2={y} stroke={c} strokeWidth="2" strokeLinecap="round" opacity="0.55" />
              <circle cx={x} cy={y} r="9" fill={c} opacity="0.18" />
              <circle cx={x} cy={y} r="3.2" fill={c} />
              {s.tag && (
                <text x={x + 10} y={y - 10} className="pd-tag" fill={c}>
                  {s.tag}
                </text>
              )}
            </g>
          );
        })}
        {p.nodes.map((n) => {
          const w = n.w ?? Math.max(96, n.label.length * 7.6 + 28, (n.sub?.length ?? 0) * 6.7 + 24);
          const h = n.sub ? 46 : 32;
          const fl = flashes.find((f) => f.node === n.id && t >= f.t0 && t <= f.t0 + f.dur);
          return (
            <g key={n.id} transform={`translate(${n.x - w / 2},${n.y - h / 2})`} className={`pd-node pd-${n.kind ?? "node"}${fl ? ` is-${fl.tone}` : ""}`}>
              <rect width={w} height={h} rx="2" />
              <text x={w / 2} y={n.sub ? 19 : h / 2 + 4.5} textAnchor="middle" className="pd-label">
                {n.label}
              </text>
              {n.sub && (
                <text x={w / 2} y={35} textAnchor="middle" className="pd-sub">
                  {n.sub}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {!reduced && (
        <button className="pd-pause" aria-label={paused ? "Play animation" : "Pause animation"} onClick={() => setPaused((v) => !v)}>
          {paused ? (
            <svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg>
          ) : (
            <svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor" /></svg>
          )}
        </button>
      )}
    </div>
  );
}
