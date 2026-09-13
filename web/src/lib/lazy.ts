/**
 * Pages loaded when first opened, not with the shell.
 *
 * One bundle carried every screen — the campaign engine, the deck editor, the
 * statistics, the deck shelf — to a visitor who came for the card search, and
 * measured 617 kB (199 kB gzipped) before the first card could be shown. Each
 * page behind a `lazy()` is its own chunk, fetched on the first visit to it
 * and cached by the service worker with the rest of the shell, so offline
 * still holds: the worker precaches every chunk the build emits, not just the
 * entry.
 *
 * The loader's promise is kept, so a page visited twice is imported once and
 * the second visit resolves on the next microtask rather than the network.
 * `warm()` imports everything after the first paint, in idle time, so a
 * navigation made a few seconds into a visit finds its chunk already there
 * and the loading line is seen only on a cold first hit.
 */

export interface Lazy<T> {
  (): Promise<T>;
}

export function lazy<T>(loader: () => Promise<T>): Lazy<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= loader().catch((cause: unknown) => {
      // A failed fetch is not permanent: a flaky connection should not leave
      // a page unreachable for the rest of the visit.
      pending = null;
      throw cause;
    });
    return pending;
  };
}

/** Starts every loader given, in idle time, one after another. */
export function warm(loaders: readonly Lazy<unknown>[]): void {
  const run = (): void => {
    for (const load of loaders) {
      void load().catch(() => undefined);
    }
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 5000 });
  } else {
    setTimeout(run, 2000);
  }
}
