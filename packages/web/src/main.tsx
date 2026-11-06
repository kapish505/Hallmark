import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./tokens.css";
import { Landing } from "./landing/Landing";

const path = location.pathname.replace(/\/+$/, "") || "/";
const root = createRoot(document.getElementById("root")!);

if (path.startsWith("/console")) {
  // the console (wallet, x402, charts) loads only on /console, so the marketing pages stay light
  void Promise.all([import("./App"), import("./styles.css")]).then(([{ App }]) =>
    root.render(
      <StrictMode>
        <QueryClientProvider client={new QueryClient()}>
          <App />
        </QueryClientProvider>
      </StrictMode>,
    ),
  );
} else if (path === "/docs") {
  void import("./site/Docs").then(({ Docs }) => {
    document.title = "Docs · Hallmark";
    root.render(
      <StrictMode>
        <Docs />
      </StrictMode>,
    );
  });
} else if (path === "/use-cases") {
  void import("./site/UseCases").then(({ UseCases }) => {
    document.title = "Use cases · Hallmark";
    root.render(
      <StrictMode>
        <UseCases />
      </StrictMode>,
    );
  });
} else {
  root.render(
    <StrictMode>
      <Landing />
    </StrictMode>,
  );
}
