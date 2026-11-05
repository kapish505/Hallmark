import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./tokens.css";
import { Landing } from "./landing/Landing";

const isConsole = location.pathname.startsWith("/console");
const root = createRoot(document.getElementById("root")!);

if (isConsole) {
  // the console (wallet, x402, charts) loads only on /console, so the landing page stays light
  void Promise.all([import("./App"), import("./styles.css")]).then(([{ App }]) =>
    root.render(
      <StrictMode>
        <QueryClientProvider client={new QueryClient()}>
          <App />
        </QueryClientProvider>
      </StrictMode>,
    ),
  );
} else {
  root.render(
    <StrictMode>
      <Landing />
    </StrictMode>,
  );
}
