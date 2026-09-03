/**
 * Keeping the screen on while a game is being played.
 *
 * A phone propped against the box goes dark every thirty seconds otherwise,
 * and the counter it is showing is the reason it is there.
 *
 * The Wake Lock API is not everywhere and the lock is dropped whenever the tab
 * is hidden, so `reacquire` exists to take it again on return rather than
 * assume it survived. The switch stays on when a request is refused: the intent
 * is what is being kept, and nothing else depends on the lock being held.
 */
export class ScreenWakeLock {
  on = $state(false);
  #sentinel: WakeLockSentinel | null = null;

  async set(value: boolean): Promise<void> {
    this.on = value;
    if (!value) {
      await this.#release();
      return;
    }
    try {
      this.#sentinel = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      this.#sentinel = null;
    }
  }

  /** Taken again after the tab comes back, where the browser dropped it. */
  reacquire(): void {
    if (this.on && document.visibilityState === 'visible' && this.#sentinel === null) {
      void this.set(true);
    }
  }

  async #release(): Promise<void> {
    await this.#sentinel?.release().catch(() => undefined);
    this.#sentinel = null;
  }

  /** Called when the screen holding it goes away. */
  dispose(): void {
    void this.#release();
  }
}
