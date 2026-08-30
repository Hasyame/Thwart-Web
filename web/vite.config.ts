import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createRequire } from 'node:module';

const { version } = createRequire(import.meta.url)('./package.json') as {
  version: string;
};

export default defineConfig({
  plugins: [svelte()],
  define: {
    // Stamped into exported backups so a confusing restore can be traced back
    // to the build that wrote it — the same reason the app's own bundle carries
    // an appVersion.
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    // Explicit so the URL printed on Windows is one that actually resolves;
    // "localhost" can pick IPv6 on some machines and confuse the browser.
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    // The card payloads are fetched at runtime from /data, never bundled, so
    // the JavaScript bundle stays small enough not to need chunk warnings.
    chunkSizeWarningLimit: 700,
  },
});
