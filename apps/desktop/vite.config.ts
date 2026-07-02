import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

/* Tauri 会在这里注入 Node 全局变量，即使该文件由 Vite 加载。 */
// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/** 桌面端 Vite 配置，兼顾浏览器开发服务器与 Tauri 调试需求。 */
export default defineConfig(async () => ({
  plugins: [vue()],

  /* 这些设置主要服务 Tauri 调试，并保留 Rust 侧错误输出。 */
  clearScreen: false,
  /* Tauri 期望开发服务器端口固定。 */
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      /* 忽略 Rust 源码，避免原生侧重建时触发 Vite 频繁刷新。 */
      ignored: ["**/src-tauri/**"],
    },
  },
}));
