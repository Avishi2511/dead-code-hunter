/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { proxy: { "/api": process.env.VITE_DEV_API ?? "http://127.0.0.1:8000" } },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
});
