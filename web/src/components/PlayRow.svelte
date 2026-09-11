<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale } from '../lib/types';
  import type { Play } from '../lib/records';
  import { db } from '../lib/db';
  import { formatElapsed } from '../lib/session.svelte';
  import { bgg, bggLogPlayUrl } from '../lib/bgg.svelte';
  import { bggComment } from '../lib/bggComment';
  import { session } from '../lib/sync/session.svelte';
  import { storedOnServer } from '../lib/sync/stored.svelte';

  /**
   * One recorded game, with the three things you can do to it.
   *
   * **Edit** corrects what was written down: the date, the result, how many
   * played, how long it took, and the free text beside it. The hero and the
   * scenario are deliberately not editable — changing those does not correct a
   * game, it describes a different one, and the honest way to do that is to
   * delete this row and record that game.
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
  let editing = $state(false);
  /*
   * Shown only after the BGG page has actually been opened from this row.
   *
   * The browser cannot ask BoardGameGeek whether the play was logged — see the
   * note in lib/bgg.svelte.ts — so the honest sequence is: open the form, and
   * then let the reader say it is done. Marking it before they have been is a
   * flag that says something nobody checked.
   */
  let offeringMark = $state(false);
  let copied = $state(false);
  let busy = $state(false);

  /*
   * The draft, held apart from the record.
   *
   * Typed into rather than bound to the play itself, so abandoning an edit
   * leaves nothing behind and a half-typed number never reaches the database.
   * Filled when the panel opens, which is also what makes Cancel work.
   */
  let draftDate = $state('');
  let draftWon = $state(false);
  let draftPlayers = $state(1);
  let draftMinutes = $state(0);
  let draftPoints = $state(0);
  let draftLocation = $state('');
  let draftNotes = $state('');

  /** The local calendar day of a timestamp, as `<input type="date">` wants it. */
  function dateValue(millis: number): string {
    const d = new Date(millis);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function openEditor(): void {
    draftDate = dateValue(play.playedAt);
    draftWon = play.won;
    draftPlayers = play.players;
    draftMinutes = Math.round(play.elapsedMillis / 60_000);
    draftPoints = play.victoryPoints;
    draftLocation = play.location;
    draftNotes = play.notes;
    editing = true;
  }

  /**
   * The corrected timestamp.
   *
   * Only the day is editable, so the time of day is carried over from the
   * original rather than reset to midnight: a game recorded at nine in the
   * evening should keep its place among that evening's games when somebody
   * fixes the date it was filed under.
   */
  function correctedPlayedAt(): number {
    const parts = draftDate.split('-').map((n) => Number(n));
    const [year, month, day] = parts;
    if (
      parts.length !== 3 ||
      year === undefined ||
      month === undefined ||
      day === undefined ||
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      !Number.isFinite(day)
    ) {
      return play.playedAt;
    }
    const was = new Date(play.playedAt);
    return new Date(
      year,
      month - 1,
      day,
      was.getHours(),
      was.getMinutes(),
      was.getSeconds(),
      was.getMilliseconds(),
    ).getTime();
  }

  async function save(): Promise<void> {
    busy = true;
    try {
      await db.plays.update(play.id, {
        playedAt: correctedPlayedAt(),
        won: draftWon,
        // A game has at least one player, whatever the box was left showing.
        players: Math.max(1, Math.round(draftPlayers) || 1),
        elapsedMillis: Math.max(0, Math.round(draftMinutes) || 0) * 60_000,
        victoryPoints: Math.max(0, Math.round(draftPoints) || 0),
        location: draftLocation.trim(),
        notes: draftNotes,
      });
      editing = false;
    } finally {
      busy = false;
    }
  }

  const when = $derived(
    new Date(play.playedAt).toLocaleDateString(uiLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }),
  );

  const onBgg = $derived(play.reportedToBgg === true);

  /*
   * Where this game is kept, said out loud.
   *
   * Signing out takes the account's games and leaves the ones this browser
   * made before signing in. Those look identical in the list, so the one that
   * would disappear has to be the one that says so.
   */
  const signedIn = $derived(session.status === 'signed-in' && storedOnServer.loaded);
  const onServer = $derived(storedOnServer.plays.has(play.id));

  /**
   * Opens BGG's own Log Play form and offers to mark the row afterwards.
   *
   * A new tab rather than a navigation, because this page is where the reader
   * is working and the form is a detour.
   */
  function logOnBgg(): void {
    window.open(bggLogPlayUrl(), '_blank', 'noreferrer,noopener');
    offeringMark = true;
  }

  async function copyDetails(): Promise<void> {
    try {
      await navigator.clipboard.writeText(bggComment(play, t.difficulty));
      copied = true;
    } catch {
      // Clipboard permission refused, or an insecure context. Nothing to say
      // that would help: the details are on the row already.
      copied = false;
    }
  }

  async function markReported(value: boolean): Promise<void> {
    busy = true;
    try {
      await db.plays.update(play.id, { reportedToBgg: value });
      offeringMark = false;
    } finally {
      busy = false;
    }
  }

  /**
   * Deletes the game, as a tombstone.
   *
   * The row stays and stops counting. Two reasons it is not a real delete: the
   * other devices have to be told, and a deletion that leaves no trace can only
   * be told to a device the server already knew about — a game recorded and
   * deleted between two syncs would simply vanish. And it means this is
   * recoverable, here, which a history page had better be.
   *
   * The sync protocol carries the deletion as a record-level flag with a null
   * body, so `deletedAt` is this device's own memory rather than what travels.
   */
  async function remove(): Promise<void> {
    busy = true;
    try {
      const now = Date.now();
      await db.plays.update(play.id, { deletedAt: now, updatedAt: now });
    } finally {
      busy = false;
      confirming = false;
    }
  }
</script>

<li class="play">
  <div class="what">
    <span class="scenario">{play.scenarioName || play.scenarioCode}</span>
    <span class="muted sub">
      {when}
      {#if play.heroName !== ''}· {play.heroName}{/if}
      · {play.won ? t.playWon : t.playLost}
      {#if play.elapsedMillis > 0}· {formatElapsed(play.elapsedMillis)}{/if}
      {#if onBgg}· {t.bggLogged}{/if}
    </span>
    {#if signedIn}
      <span class="chip" class:is-local={!onServer}>
        {onServer ? t.savedOnServer : t.savedLocalOnly}
      </span>
    {/if}
  </div>

  {#if editing}
    <!--
      Corrections, not a second way to record a game.

      Everything here is something somebody can get wrong while writing a game
      down in a hurry, and nothing here changes what game it was.
    -->
    <form
      class="editor"
      onsubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label>
        <span class="muted lbl">{t.playWhen}</span>
        <input class="field" type="date" bind:value={draftDate} />
      </label>
      <label>
        <span class="muted lbl">{t.playResult}</span>
        <select
          class="field"
          value={draftWon ? 'won' : 'lost'}
          onchange={(event) => (draftWon = event.currentTarget.value === 'won')}
        >
          <option value="won">{t.playWon}</option>
          <option value="lost">{t.playLost}</option>
        </select>
      </label>
      <label>
        <span class="muted lbl">{t.players}</span>
        <input class="field" type="number" min="1" max="4" bind:value={draftPlayers} />
      </label>
      <label>
        <span class="muted lbl">{t.correctTheClock}</span>
        <input class="field" type="number" min="0" bind:value={draftMinutes} />
      </label>
      <label>
        <span class="muted lbl">{t.victoryPoints}</span>
        <input class="field" type="number" min="0" bind:value={draftPoints} />
      </label>
      <label>
        <span class="muted lbl">{t.location}</span>
        <input class="field" type="text" bind:value={draftLocation} />
      </label>
      <label class="wide">
        <span class="muted lbl">{t.notes}</span>
        <textarea class="field" rows="2" bind:value={draftNotes}></textarea>
      </label>
      <div class="actions wide">
        <button class="btn" type="submit" disabled={busy}>{t.playEditSave}</button>
        <button
          class="btn btn--quiet"
          type="button"
          disabled={busy}
          onclick={() => (editing = false)}
        >
          {t.cancel}
        </button>
      </div>
    </form>
  {:else if confirming}
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
      <button class="btn btn--quiet" type="button" disabled={busy} onclick={openEditor}>
        {t.playEdit}
      </button>
      <!--
        BoardGameGeek, offered only once this browser knows who you are there.

        Without a name it is a button that leads to somebody else's log-in page,
        which is not a feature.
      -->
      {#if bgg.username !== '' && !onBgg}
        <button class="btn btn--quiet" type="button" disabled={busy} onclick={logOnBgg}>
          {t.bggLogPlay}
        </button>
      {:else if bgg.username !== '' && onBgg}
        <button
          class="btn btn--quiet"
          type="button"
          disabled={busy}
          onclick={() => void markReported(false)}
        >
          {t.bggUnmark}
        </button>
      {/if}
      <button
        class="btn btn--quiet danger"
        type="button"
        disabled={busy}
        onclick={() => (confirming = true)}
      >
        {t.playDelete}
      </button>
    </div>

    {#if offeringMark && !onBgg}
      <div class="bgg-follow">
        <span class="muted note">{t.bggFollowUp}</span>
        <button class="btn btn--quiet" type="button" disabled={busy} onclick={() => void copyDetails()}>
          {copied ? t.bggCopied : t.bggCopy}
        </button>
        <button
          class="btn btn--quiet"
          type="button"
          disabled={busy}
          onclick={() => void markReported(true)}
        >
          {t.bggMark}
        </button>
        <button class="btn btn--quiet" type="button" onclick={() => (offeringMark = false)}>
          {t.cancel}
        </button>
      </div>
    {/if}
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


  .chip {
    align-self: flex-start;
    margin-top: var(--space-1);
    font-size: var(--text-2xs);
    padding: 2px var(--space-2);
    border-radius: var(--radius-pill);
    background: var(--accent-soft);
    color: var(--accent);
  }

  /* Marked differently rather than only worded differently, because this is the
     one that goes away when the account does. */
  .chip.is-local {
    background: var(--surface-2);
    color: var(--text-muted);
  }

  .bgg-follow {
    flex: 1 1 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .bgg-follow .note {
    font-size: var(--text-sm);
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

  .editor {
    flex: 1 1 100%;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: var(--space-2);
    align-items: end;
  }

  .editor label {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .editor .wide {
    grid-column: 1 / -1;
  }

  .lbl {
    font-size: var(--text-xs);
  }
</style>
