import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    assetsDir: 'assets',
    emptyOutDir: true,
    // Server CSP declares font-src 'self' (no data:) — inlined data:font base64
    // in CSS would be blocked by the browser. Force every asset (including
    // small fonts) to emit as a same-origin file instead of being inlined.
    assetsInlineLimit: 0
  },
  server: {
    host: '127.0.0.1'
  },
  preview: {
    host: '127.0.0.1'
  }
});
