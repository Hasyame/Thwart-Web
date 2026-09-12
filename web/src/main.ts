import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

/**
 * Ask the browser to keep what we store.
 *
 * Everything a person makes here lives in IndexedDB, and browsers evict that
 * from sites they judge unimportant. It matters most on iOS: a home-screen web
 * app is not Safari and gets its own use counter, and Apple's WebKit team have
 * said they do not expect first-party data in one to be deleted, but storage
 * can still be reclaimed after a long enough silence.
 *
 * `persist()` asks for exemption and is granted at the browser's discretion, so
 * it is a request rather than a guarantee. That is the honest reason the backup
 * file on the Collection page is not a nicety: it is the only copy the user
 * controls until there is an account to sync with.
 */
async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist === undefined) {
      return;
    }
    if (await navigator.storage.persisted()) {
      return;
    }
    await navigator.storage.persist();
  } catch {
    // Blocked or unsupported. The site works either way.
  }
}

void requestPersistentStorage();

/**
 * Registers the service worker, in production only.
 *
 * In development it would sit between the browser and the dev server and fight
 * hot reloading for no benefit, so the build emits it and dev does not.
 */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
    return;
  }
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // An unregistered worker costs offline support and nothing else.
    });
  });
}

registerServiceWorker();

const target = document.getElementById('app');
if (target === null) {
  throw new Error('index.html is missing the #app element');
}

// The document carries the home page's words for whoever reads it without
// running this (see index.html). `mount` appends rather than replaces, so
// they are taken out first; the app writes its own.
target.replaceChildren();

export default mount(App, { target });
