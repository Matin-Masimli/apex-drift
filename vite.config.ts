import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, open: false },
  build: { target: 'es2022', sourcemap: true },
  // Rapier's compat build inlines its WASM as base64, so no special WASM plugin is needed.
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
