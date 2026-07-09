import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    assetsDir: 'assets',
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1'
  },
  preview: {
    host: '127.0.0.1'
  }
});
