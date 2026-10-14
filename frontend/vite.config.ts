import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the backend runs on :8195 (pnpm --filter backend dev);
// the dev server forwards API calls to it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5190,
    allowedHosts: true,
    proxy: { "/api": "http://localhost:8195" },
  },
});
