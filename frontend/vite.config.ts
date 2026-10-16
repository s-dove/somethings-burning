import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the backend runs on :8195 (pnpm --filter backend dev);
// the dev server forwards API calls to it. The original Host goes along as
// X-Forwarded-Host so the DSNs the backend builds point at this server.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5190,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:8195",
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (req.headers.host) proxyReq.setHeader("x-forwarded-host", req.headers.host);
          });
        },
      },
    },
  },
});
