import { defineConfig } from 'vite';

// The desktop app (Tauri) expects the dev server on exactly this port.
export default defineConfig({
  clearScreen: false,
  server: { port: 5173, strictPort: true },
});
