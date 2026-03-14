import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env["VITE_API_URL"] ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
