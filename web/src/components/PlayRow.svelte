<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale } from '../lib/types';
  import type { Play } from '../lib/records';
  import { db } from '../lib/db';
  import { formatElapsed } from '../lib/session.svelte';

  /**
   * One recorded game, with the two things you can do to it.
   *
   * **Set aside** keeps the row and takes it out of the numbers: a demo taught
   * to somebody, a duplicate entered twice, a game abandoned halfway. It is one
   * tap in either direction, so it costs nothing to be wrong about.
   *
   * **Delete** does not come back. It asks first, in place rather than through
   * a browser dialog nobody reads, and the two are kept visibly different
   * because one is a preference and the other is a loss.
   */

  interface Props {
    t: Strings;
    uiLocale: Locale;
    play: Play;
  }

  const { t, uiLocale, play }: Props = $props();

  let confirming = $state(false);
  let busy = $state(false);

  const ignored = $derived(play.ignored === true);

  const when = $derived(
    new Date(play.playedAt).toLocaleDateString(uiLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }),
  );

  async function setAside(value: boolean): Promise<void> {
    busy = true;
    try {
      await db.plays.update(play.id, { ignored: value });
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    busy = true;
    try {
      await db.plays.delete(play.id);
    } finally {
      busy = false;
      confirming = false;
    }
  }
</script>

<li class="play" class:ignored>
  <div class="what">
    <span class="scenario">{play.scenarioName || play.scenarioCode}</span>
    <span class="muted sub">
      {when}
      {#if play.heroName !== ''}· {play.heroName}{/if}
      · {play.won ? t.playWon : t.playLost}
      {#if play.elapsedMillis > 0}· {formatElapsed(play.elapsedMillis)}{/if}
      {#if ignored}· {t.playSetAsideMark}{/if}
    </span>
  </div>

  {#if confirming}
    <!-- In place, because a browser confirm() is a dialog people dismiss
         without reading, and this one does not come back. -->
    <div class="confirm">
      <span class="muted note">{t.playDeleteConfirm}</span>
      <button class="btn btn--quiet danger" type="button" disabled={busy} onclick={remove}>
        {t.playDeleteYes}
      </button>
      <button class="btn btn--quiet" type="button" disabled={busy} onclick={() => (confirming = false)}>
        {t.cancel}
      </button>
    </div>
  {:else}
    <div class="actions">
      <button
        class="btn btn--quiet"
        type="button"
        disabled={busy}
        aria-pressed={ignored}
        onclick={() => void setAside(!ignored)}
      >
        {ignored ? t.playCountAgain : t.playSetAside}
      </button>
      <button
        class="btn btn--quiet danger"
        type="button"
        disabled={busy}
        onclick={() => (confirming = true)}
      >
        {t.playDelete}
      </button>
    </div>
  {/if}
</li>

<style>
  .play {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--hairline);
  }

  .what {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1 1 12rem;
  }

  .scenario {
    font-weight: var(--weight-semibold);
  }

  .sub {
    font-size: var(--text-sm);
  }

  /* Dimmed rather than hidden: it is still a game that happened, and the row
     has to stay legible enough to put back. */
  .ignored .what {
    opacity: 0.62;
  }

  .ignored .scenario {
    text-decoration: line-through;
    text-decoration-thickness: 1px;
  }

  .actions,
  .confirm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .confirm .note {
    font-size: var(--text-sm);
  }

  .danger {
    color: var(--danger);
  }
</style>
