import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 127.0.0.1, not localhost: the server listens on IPv4 loopback, and localhost may resolve to ::1 first
const api = `http://127.0.0.1:${process.env.DC_SERVER_PORT ?? 8787}`;

export default defineConfig({
  // relative asset URLs: the same build runs at / or under a host's prefix such as /design/ (src/base.ts)
  base: './',
  plugins: [react()],
  server: {
    port: Number(process.env.PORT ?? 5173),
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/sandbox': { target: api, changeOrigin: false },
    },
  },
});
