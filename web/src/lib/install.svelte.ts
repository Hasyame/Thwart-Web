/**
 * Installing the site as an app, where the browser offers it.
 *
 * Chrome, Edge and Samsung Internet on Android (and Chrome on a desktop) fire
 * `beforeinstallprompt` once the manifest and the service worker qualify. The
 * event is kept so the page can offer its own "Install" button instead of
 * hoping the browser's small banner gets noticed. Safari and Firefox never
 * fire it; for them the guide lists the menu steps instead.
 *
 * Listened for from `main.ts`, before the app mounts, because the event can
 * arrive before any component that would want it exists.
 */

/** Not in the TypeScript DOM library: Chromium-only, and still a draft. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const installer = $state<{ offer: BeforeInstallPromptEvent | null; installed: boolean }>({
  offer: null,
  installed: false,
});

export function listenForInstall(): void {
  installer.installed =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches;
  window.addEventListener('beforeinstallprompt', (event) => {
    // Kept for our own button rather than shown now.
    event.preventDefault();
    installer.offer = event as BeforeInstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    installer.offer = null;
    installer.installed = true;
  });
}

/** Shows the browser's own install dialog. A prompt can be used only once. */
export async function install(): Promise<void> {
  const offer = installer.offer;
  if (offer === null) {
    return;
  }
  installer.offer = null;
  await offer.prompt();
  const choice = await offer.userChoice;
  if (choice.outcome === 'accepted') {
    installer.installed = true;
  }
}
