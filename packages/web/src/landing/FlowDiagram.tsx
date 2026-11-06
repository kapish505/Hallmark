import { useEffect, useMemo, useState } from "react";

export interface FNode {
  id: string;
  x: number;
  y: number;
  label: string;
  sub?: string;
  /** "core" = brass tile, "ghost" = dashed outline */
  kind?: "core" | "node" | "ghost";
  w?: number;
}
export interface FEdge {
  id: string;
  from: string;
  to: string;
  via?: Array<[number, number]>;
  dashed?: boolean;
}
export interface FStep {
  edge: string;
  reverse?: boolean;
  tone?: "brass" | "ok" | "bad";
  /** one plain sentence shown under the diagram while this step runs */
  caption: string;
  /** node to outline when the step lands */
  lands?: { node: string; tone: "ok" | "bad" | "brass" };
}

const TONE = { brass: "var(--brass)", ok: "var(--ok)", bad: "var(--bad)" } as const;

const pointsOf = (e: FEdge, nodes: Map<string, FNode>): Array<[number, number]> => {
  const a = nodes.get(e.from)!;
  const b = nodes.get(e.to)!;
  return [[a.x, a.y], ...(e.via ?? []), [b.x, b.y]];
};
const dOf = (pts: Array<[number, number]>) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");

/**
 * Calm step-by-step flow: one message travels at a time, at a readable pace (stepMs, default 2.4 s),
 * eased with SVG animateMotion, so React does not re-render every frame. The caption sits under the
 * diagram. Pause button; reduced motion shows a still frame with every step listed.
 */
export function FlowDiagram(p: { width: number; height: number; nodes: FNode[]; edges: FEdge[]; steps: FStep[]; stepMs?: number; label: string }) {
  const stepMs = p.stepMs ?? 2400;
  const nodes = useMemo(() => new Map(p.nodes.map((n) => [n.id, n])), [p.nodes]);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => setReduced(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);

  useEffect(() => {
    if (paused || reduced) return;
    // a short rest after the last step, then start over
    const wait = i === p.steps.length - 1 ? stepMs * 1.6 : stepMs;
    const t = setTimeout(() => setI((x) => (x + 1) % p.steps.length), wait);
    return () => clearTimeout(t);
  }, [i, paused, reduced, stepMs, p.steps.length]);

  const s = p.steps[i];
  const edge = p.edges.find((e) => e.id === s.edge)!;
  const pts = pointsOf(edge, nodes);
  const path = dOf(s.reverse ? [...pts].reverse() : pts);
  const color = TONE[s.tone ?? "brass"];
  const travel = Math.min(1500, stepMs * 0.62);
  // nodes already reached in this run stay outlined until the loop restarts
  const landed = new Map<string, string>();
  p.steps.slice(0, i + 1).forEach((x) => x.lands && landed.set(x.lands.node, x.lands.tone));

  return (
    <figure className="fd">
      <div className="fd-stage">
        <svg viewBox={`0 0 ${p.width} ${p.height}`} role="img" aria-label={p.label}>
          {p.edges.map((e) => (
            <path key={e.id} d={dOf(pointsOf(e, nodes))} className={`fd-edge${e.dashed ? " is-dashed" : ""}${!reduced && e.id === s.edge ? " is-on" : ""}`} />
          ))}
          {!reduced && (
            <g key={`${i}-${paused}`} className="fd-msg">
              <circle r="11" fill={color} opacity="0.16">
                <animateMotion dur={`${travel}ms`} fill="freeze" path={path} calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines="0.45 0 0.2 1" />
              </circle>
              <circle r="4" fill={color}>
                <animateMotion dur={`${travel}ms`} fill="freeze" path={path} calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines="0.45 0 0.2 1" />
              </circle>
            </g>
          )}
          {p.nodes.map((n) => {
            const w = n.w ?? Math.max(110, n.label.length * 7.8 + 30, (n.sub?.length ?? 0) * 6.8 + 26);
            const h = n.sub ? 48 : 34;
            const tone = reduced ? undefined : landed.get(n.id);
            return (
              <g key={n.id} transform={`translate(${n.x - w / 2},${n.y - h / 2})`} className={`fd-node fd-${n.kind ?? "node"}${tone ? ` is-${tone}` : ""}`}>
                <rect width={w} height={h} rx="3" />
                <text x={w / 2} y={n.sub ? 20 : h / 2 + 4.5} textAnchor="middle" className="fd-label">
                  {n.label}
                </text>
                {n.sub && (
                  <text x={w / 2} y={36} textAnchor="middle" className="fd-sub">
                    {n.sub}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {!reduced && (
          <button className="fd-pause" aria-label={paused ? "Play" : "Pause"} onClick={() => setPaused((v) => !v)}>
            {paused ? (
              <svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg>
            ) : (
              <svg viewBox="0 0 16 16" width="12" height="12"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor" /></svg>
            )}
          </button>
        )}
      </div>
      {reduced ? (
        <ol className="fd-list">
          {p.steps.map((x, n) => (
            <li key={n}>{x.caption}</li>
          ))}
        </ol>
      ) : (
        <figcaption className="fd-cap" aria-live="polite">
          <span className="fd-n">
            {String(i + 1).padStart(2, "0")} / {String(p.steps.length).padStart(2, "0")}
          </span>
          <span key={i} className="fd-text">
            {s.caption}
          </span>
          <span className="fd-dots" aria-hidden="true">
            {p.steps.map((_, n) => (
              <button key={n} className={n === i ? "is-on" : n < i ? "is-done" : ""} onClick={() => setI(n)} tabIndex={-1} />
            ))}
          </span>
        </figcaption>
      )}
    </figure>
  );
}
