import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  server: {
    // The desktop app (Tauri) expects the dev server on exactly this port.
    port: 5173,
    strictPort: true,
    // Don't watch the desktop app's Rust folder: on Windows the compiler's
    // files are locked while it builds, and watching them crashes Vite (EBUSY).
    watch: { ignored: ['**/src-tauri/**'] },
  },
});
