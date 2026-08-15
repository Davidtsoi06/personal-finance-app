import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * 开发/生产差异化 CSP：
 * - 开发模式：React 插件会注入内联 preamble 脚本 + HMR WebSocket，需放开 script-src 与 connect-src
 * - 生产构建：保持严格策略（script-src 'self'），与 index.html 静态 meta 一致
 */
const cspPlugin = () => ({
  name: 'inject-csp',
  transformIndexHtml(html: string, ctx: { server?: unknown }) {
    const csp = ctx.server
      ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:5173 http://localhost:5173"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'";
    return html.replace(
      /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/,
      `<meta http-equiv="Content-Security-Policy" content="${csp}" />`
    );
  },
});

export default defineConfig({
  plugins: [react(), cspPlugin()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
    },
  },
  server: {
    port: 5173,
  },
});
