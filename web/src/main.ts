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

const target = document.getElementById('app');
if (target === null) {
  throw new Error('index.html is missing the #app element');
}

export default mount(App, { target });
