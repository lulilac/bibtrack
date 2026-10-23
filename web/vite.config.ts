import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const target = `http://localhost:${process.env.PORT ?? 5577}`;

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: { port: 5578, proxy: { '/api': target, '/pdf': target } },
  build: { outDir: 'dist', emptyOutDir: true },
});
