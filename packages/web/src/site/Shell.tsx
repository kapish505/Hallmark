import type { ReactNode } from "react";
import "../landing/landing.css";
import "./site.css";

export const CORE = "0x4Ae8e841fD17c70F9E1628e4a0121944288c46CE";
export const VERDICT = "0x16E332bC16DB931e65cF14e28E57E80f18897be2";
export const REGISTRY = "0x5902c6e3020297B6Bf47bFf050357Df9108a234f";
export const JUDGE = "0x7897772347d5C5F5De067FbF0129b387a9E7d069";
export const REPO = "https://github.com/kapish505/Hallmark";
export const hashscan = (a: string) => `https://hashscan.io/testnet/contract/${a}`;

export function Arrow() {
  return (
    <svg className="m-arrow" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

type Page = "home" | "use-cases" | "docs";

export function Shell({ page, children }: { page: Page; children: ReactNode }) {
  const home = page === "home" ? "" : "/";
  const links: Array<[string, string, Page | null]> = [
    [`${home}#problem`, "Problem", null],
    [`${home}#solution`, "How it works", null],
    [`${home}#architecture`, "Architecture", null],
    ["/use-cases", "Use cases", "use-cases"],
    ["/docs", "Docs", "docs"],
  ];
  return (
    <div className="lp">
      <header className="nav">
        <div className="wrap nav-in">
          <a className="brand" href="/" aria-label="Hallmark home">
            <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
              <path d="M9 8v16M23 8v16M9 16h14" stroke="currentColor" strokeWidth="2.4" />
              <rect x="5" y="5" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
            Hallmark
          </a>
          <nav className="nav-links" aria-label="Site">
            {links.map(([href, label, p]) => (
              <a key={href} href={href} aria-current={p === page ? "page" : undefined} className={`${p === page ? "is-on" : ""}${href.startsWith("/") && !href.includes("#") ? " m-keep" : ""}`}>
                {label}
              </a>
            ))}
          </nav>
          <a className="btn btn-primary" href="/console">
            <span className="m-hide">Open the console</span><span className="m-show">Console</span> <Arrow />
          </a>
        </div>
      </header>
      <main>{children}</main>
      <footer className="foot">
        <div className="wrap foot-in">
          <span className="brand small">Hallmark</span>
          <a className="mono dim small" href={hashscan(CORE)} target="_blank" rel="noreferrer">
            Hedera testnet · {CORE.slice(0, 10)}…{CORE.slice(-6)}
          </a>
          <span className="foot-links small">
            <a className="dim" href="/use-cases">Use cases</a>
            <a className="dim" href="/docs">Docs</a>
            <a className="dim" href={REPO} target="_blank" rel="noreferrer">GitHub</a>
            <a className="dim" href="/console">Console</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
