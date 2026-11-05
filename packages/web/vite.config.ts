import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// docs/MEASUREMENTS.md is imported (?raw) by the Core model page, so allow the repo root
export default defineConfig({ plugins: [react()], server: { port: 5173, fs: { allow: ["../.."] } } });
