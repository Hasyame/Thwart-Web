import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { version } = createRequire(import.meta.url)('./package.json') as {
  version: string;
};

/**
 * Emits the service worker with the built asset names baked in.
 *
 * A hand-written worker cannot know what the shell is called: Vite hashes the
 * script and the stylesheet on every build. Rather than take a dependency to
 * solve that, the plugin reads the emitted bundle and substitutes the list,
 * along with a build id that names the cache and so retires the previous one.
 *
 * Only in production. In development the worker would sit between the browser
 * and the dev server and fight hot reloading for no benefit.
 */
function serviceWorker(): Plugin {
  return {
    name: 'thwart-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
        .map((name) => `/${name}`);

      const shell = [
        '/',
        '/index.html',
        '/manifest.webmanifest',
        '/icon.svg',
        '/icon-512.png',
        '/apple-touch-icon.png',
        ...assets,
      ];

      const source = readFileSync(
        fileURLToPath(new URL('./src/sw.js', import.meta.url)),
        'utf8',
      )
        .replace('__PRECACHE_MANIFEST__', JSON.stringify(shell, null, 2))
        // Derived from the asset hashes, so it changes exactly when the shell
        // does and not on every rebuild of identical code.
        .replace('__BUILD_ID__', assets.join('|').replace(/[^a-zA-Z0-9]/g, '').slice(-16));

      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [svelte(), serviceWorker()],
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
    /*
     * The API, borrowed from the deployed instance.
     *
     * In production nginx proxies /api/ to the Go server on the same origin,
     * so the client asks for a same-origin path and never knows where the
     * server is. Development has no nginx, and pointing the client at an
     * absolute URL instead would mean shipping a different request in dev from
     * the one that runs in production — which is how a CORS or cookie problem
     * gets found by a user rather than by me.
     *
     * Set THWART_API to run against a server on this machine.
     */
    proxy: {
      '/api': {
        target: process.env.THWART_API ?? 'https://thwart.app',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  build: {
    target: 'es2022',
    // The card payloads are fetched at runtime from /data, never bundled, so
    // the JavaScript bundle stays small enough not to need chunk warnings.
    chunkSizeWarningLimit: 700,
  },
});
