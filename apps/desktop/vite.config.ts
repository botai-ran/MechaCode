import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 当需要固定开发服务器地址时，Tauri 会注入这个环境变量。
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"]
    }
  }
}));
