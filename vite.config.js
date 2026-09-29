import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: Number(process.env.PORT) || 5188, open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
