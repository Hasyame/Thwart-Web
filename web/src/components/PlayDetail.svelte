<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale } from '../lib/types';
  import type { CampaignRun, Play } from '../lib/records';
  import { db, toggleFavouritePlay } from '../lib/db';
  import RatingPanel from './RatingPanel.svelte';
  import { ratingOfPlay, type RatingSubject } from '../lib/ratings';
  import { formatElapsed } from '../lib/session.svelte';
  import { playerBucket } from '../lib/plays';
  import { inCampaign, runOf } from '../lib/playQuery';
  import { campaignFigures } from '../lib/campaignFigures';
  import { parseTrackerNotes } from '../lib/playNotes';
  import { bgg, bggCanSend, bggLogPlayUrl, sendPlayToBgg } from '../lib/bgg.svelte';
  import { bggComment } from '../lib/bggComment';
  import { ApiError } from '../lib/sync/api';

  /**
   * One recorded game, in full, with the two things that can be done to it.
   *
   * Everything the row actually holds and nothing invented. Fields that were
   * never filled in are left out rather than shown empty: a game with no notes
   * has no notes line, not a heading over a blank.
   *
   * **Edit** corrects what was written down. The hero and the scenario are
   * deliberately not editable — changing those does not correct a game, it
   * describes a different one, and the honest way to do that is to delete this
   * and record that.
   *
   * **Delete** is a tombstone. The row stays, stops counting, and travels to
   * the other devices as a deletion. It asks first, in place rather than
   * through a browser dialog nobody reads.
   */

  interface Props {
    t: Strings;
    uiLocale: Locale;
    play: Play;
    /** The run this game belonged to, when it belonged to one. */
    run: CampaignRun | null;
    onClose: () => void;
    onOpenRun: (id: string) => void;
    /** Lays this game out again on the setup screen. */
    onReplay: (play: Play) => void;
    /** Whether this game is starred, from the history's own live set. */
    starred: boolean;
    /**
     * What this game can be rated on, resolved by App — a campaign's scenario
     * needs the run's template, which this detail has no other reason to
     * hold. Empty when nothing can be resolved.
     */
    ratingSubjects: readonly RatingSubject[];
    setNames: ReadonlyMap<string, string>;
    storageOk: boolean;
    /** The scenario's villain, on MarvelCDB, or null when it has none the index knows. */
    art: string | null;
  }

  const {
    t, uiLocale, play, run, onClose, onOpenRun, onReplay, starred, ratingSubjects, setNames, storageOk, art,
  }: Props = $props();

  /** The round count and villain stage the tracker wrote, read back as facts. */
  const tracked = $derived(parseTrackerNotes(play.notes));

  async function toggleStar(): Promise<void> {
    busy = true;
    try {
      await toggleFavouritePlay(play.id);
    } finally {
      busy = false;
    }
  }

  let editing = $state(false);
  let confirming = $state(false);
  let busy = $state(false);

  /*
   * BoardGameGeek, from the history: sent through the relay when this
   * browser holds a connection that can, otherwise the hand-off — BGG's own
   * form in another tab, the details on the clipboard, and the reader saying
   * it is done, since the browser cannot ask BGG whether it was.
   */
  const onBgg = $derived(play.reportedToBgg === true);
  let bggFailure = $state<string | null>(null);
  let offeringMark = $state(false);
  let copied = $state(false);

  async function sendToBgg(): Promise<void> {
    busy = true;
    bggFailure = null;
    try {
      await sendPlayToBgg(play, t.difficulty, uiLocale);
    } catch (cause) {
      bggFailure = t.bggError(cause instanceof ApiError ? cause.code : 'server_error');
    } finally {
      busy = false;
    }
  }

  function logOnBgg(): void {
    window.open(bggLogPlayUrl(), '_blank', 'noreferrer,noopener');
    offeringMark = true;
  }

  async function copyDetails(): Promise<void> {
    try {
      await navigator.clipboard.writeText(bggComment(play, t.difficulty));
      copied = true;
    } catch {
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

  /*
   * The draft, held apart from the record.
   *
   * Typed into rather than bound to the play itself, so abandoning an edit
   * leaves nothing behind and a half-typed number never reaches the database.
   */
  let draftDate = $state('');
  let draftWon = $state(false);
  let draftPlayers = $state(1);
  let draftMinutes = $state(0);
  let draftPoints = $state(0);
  let draftLocation = $state('');
  let draftNotes = $state('');

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
   * Only the day is editable, so the time of day is carried over rather than
   * reset to midnight: a game recorded at nine in the evening keeps its place
   * among that evening's games when somebody fixes the date it was filed under.
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
        // What makes a merge prefer this copy over an older one elsewhere.
        updatedAt: Date.now(),
      });
      editing = false;
    } finally {
      busy = false;
    }
  }

  /**
   * Deletes the game, as a tombstone.
   *
   * Not a real delete: the other devices have to be told, and a deletion that
   * leaves no trace can only be inferred for a row the server already knew — a
   * game recorded and deleted between two syncs would simply vanish. It also
   * means this is recoverable, which a history had better be.
   */
  async function remove(): Promise<void> {
    busy = true;
    try {
      const now = Date.now();
      await db.plays.update(play.id, { deletedAt: now, updatedAt: now });
      // The star goes with the game. A row pointing at a deleted play would
      // sync to the phone as a favourite of nothing.
      await db.favouritePlays.delete(play.id);
      confirming = false;
      onClose();
    } finally {
      busy = false;
    }
  }

  const when = $derived(
    new Date(play.playedAt).toLocaleString(uiLocale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
  );

  const seats = $derived(
    play.roster.length > 0
      ? play.roster
      : [{ code: play.heroCode, name: play.heroName || play.heroCode, aspect: play.aspects }],
  );

  const difficultyLabel = $derived.by(() => {
    const key = play.difficulty.toUpperCase();
    const named = t.difficulty(key);
    return named === key ? play.difficulty : named;
  });

  /*
   * What the campaign was carrying at this point.
   *
   * Derived from the run's event log rather than stored on the play — which is
   * also how the Android app produces its campaign figures. Nothing is invented:
   * a counter the campaign does not define simply does not appear.
   */
  let figures = $state.raw<readonly { label: string; value: string }[]>([]);
  $effect(() => {
    const id = runOf(play);
    if (id === null || run === null) {
      figures = [];
      return;
    }
    let live = true;
    void campaignFigures(run, id, uiLocale)
      .then((found) => {
        if (live) {
          figures = found;
        }
      })
      .catch(() => {
        if (live) {
          figures = [];
        }
      });
    return () => {
      live = false;
    };
  });
</script>

<div class="detail surface">
  <div class="head">
    {#if art !== null}
      <img class="face" src={art} alt="" loading="lazy" />
    {/if}
    <div class="title">
      <h2>{play.scenarioName || play.scenarioCode}</h2>
      <p class="muted note">{when}</p>
    </div>
    <button class="btn btn--quiet" type="button" onclick={onClose}>{t.close}</button>
  </div>

  {#if editing}
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
        <textarea class="field" rows="3" bind:value={draftNotes}></textarea>
      </label>
      <div class="actions wide">
        <button class="btn btn--primary" type="submit" disabled={busy}>{t.playEditSave}</button>
        <button class="btn" type="button" disabled={busy} onclick={() => (editing = false)}>
          {t.cancel}
        </button>
      </div>
    </form>
  {:else}
    <!--
      Only what was recorded. A field nobody filled in is absent rather than
      shown as an empty row, which would read as though the game were missing
      something.
    -->
    <dl class="facts">
      <div>
        <dt>{t.historyResult}</dt>
        <dd class:won={play.won}>{play.won ? t.playWon : t.playLost}</dd>
      </div>
      <div>
        <dt>{t.byHero}</dt>
        <dd>
          <ul class="seats">
            {#each seats as seat (seat.code + seat.name)}
              <li>{seat.name}{seat.aspect === '' ? '' : ` · ${seat.aspect}`}</li>
            {/each}
          </ul>
        </dd>
      </div>
      <div>
        <dt>{t.byDifficulty}</dt>
        <dd>{difficultyLabel}{play.standardSet === '' ? '' : ` · ${play.standardSet}`}</dd>
      </div>
      <div>
        <dt>{t.players}</dt>
        <dd>{t.playerBucket(playerBucket(play.players))}</dd>
      </div>
      {#if play.elapsedMillis > 0}
        <div>
          <dt>{t.timePlayedLabel}</dt>
          <dd>{formatElapsed(play.elapsedMillis)}</dd>
        </div>
      {/if}
      {#if tracked.rounds !== null}
        <div>
          <dt>{t.roundsPlayed}</dt>
          <dd>{tracked.rounds}</dd>
        </div>
      {/if}
      {#if tracked.villainStage !== null}
        <div>
          <dt>{t.villainStageReached}</dt>
          <dd>{tracked.villainStage}</dd>
        </div>
      {/if}
      {#if play.victoryPoints > 0}
        <div>
          <dt>{t.victoryPoints}</dt>
          <dd>{play.victoryPoints}</dd>
        </div>
      {/if}
      {#if play.location !== ''}
        <div>
          <dt>{t.location}</dt>
          <dd>{play.location}</dd>
        </div>
      {/if}
      {#if run !== null}
        <div>
          <dt>{t.navCampaigns}</dt>
          <dd>
            <button class="btn btn--quiet inline" type="button" onclick={() => onOpenRun(run.id)}>
              {run.name || run.templateName}
            </button>
          </dd>
        </div>
      {/if}
      {#each figures as figure (figure.label)}
        <div>
          <dt>{figure.label}</dt>
          <dd>{figure.value}</dd>
        </div>
      {/each}
      {#if tracked.rest !== ''}
        <div class="wide">
          <dt>{t.notes}</dt>
          <dd class="notes">{tracked.rest}</dd>
        </div>
      {/if}
    </dl>

    {#if confirming}
      <div class="confirm">
        <p class="warning" role="alert">{t.historyDeleteConfirm}</p>
        <div class="actions">
          <button class="btn danger" type="button" disabled={busy} onclick={() => void remove()}>
            {t.playDeleteYes}
          </button>
          <button class="btn" type="button" disabled={busy} onclick={() => (confirming = false)}>
            {t.cancel}
          </button>
        </div>
      </div>
    {:else}
      <div class="actions">
        <!--
          First and filled, because it is the reason most people open a game
          they have already played: the same table, again.

          Not on a campaign's scenario. Only a game played from the setup page
          or from a draw is played again from the history; a campaign's
          scenario is played again from its own campaign, which the link above
          leads to. `inCampaign` rather than a null test: the phone omits the
          field on a standalone game, and `undefined !== null` would hide
          this on every game it ever synced.
        -->
        {#if !inCampaign(play)}
          <button class="btn btn--primary" type="button" disabled={busy} onclick={() => onReplay(play)}>
            {t.playAgain}
          </button>
        {/if}
        <!-- Pressed state on the button itself, so a screen reader hears
             "starred" rather than two labels that differ by one word. -->
        <button
          class="btn"
          class:starred
          type="button"
          aria-pressed={starred}
          disabled={busy}
          onclick={() => void toggleStar()}
        >
          <span aria-hidden="true">{starred ? '★' : '☆'}</span>
          {starred ? t.favouritePlayRemove : t.favouritePlayAdd}
        </button>
        <button class="btn" type="button" disabled={busy} onclick={openEditor}>{t.playEdit}</button>
        <!-- BoardGameGeek, offered only once this browser knows who you are
             there: with a connection that can post, sent from here; with a
             name alone, BGG's own form. -->
        {#if bggCanSend() && !onBgg}
          <button class="btn" type="button" disabled={busy} onclick={() => void sendToBgg()}>
            {busy ? t.bggSending : t.bggSend}
          </button>
        {:else if bgg.username !== '' && !onBgg}
          <button class="btn" type="button" disabled={busy} onclick={logOnBgg}>{t.bggLogPlay}</button>
        {:else if bgg.username !== '' && onBgg}
          <button class="btn btn--quiet" type="button" disabled={busy} onclick={() => void markReported(false)}>
            {t.bggUnmark}
          </button>
        {/if}
        <button class="btn btn--quiet danger" type="button" onclick={() => (confirming = true)}>
          {t.playDelete}
        </button>
      </div>

      {#if onBgg}
        <p class="muted note bgg-line">✓ {t.bggSent}</p>
      {/if}
      {#if bggFailure !== null && !onBgg}
        <p class="note bgg-line danger" role="alert">{t.bggSendFailed(bggFailure)}</p>
      {/if}
      {#if offeringMark && !onBgg}
        <div class="bgg-line actions">
          <span class="muted note">{t.bggFollowUp}</span>
          <button class="btn btn--quiet" type="button" disabled={busy} onclick={() => void copyDetails()}>
            {copied ? t.bggCopied : t.bggCopy}
          </button>
          <button class="btn btn--quiet" type="button" disabled={busy} onclick={() => void markReported(true)}>
            {t.bggMark}
          </button>
          <button class="btn btn--quiet" type="button" onclick={() => (offeringMark = false)}>{t.cancel}</button>
        </div>
      {/if}

      <!-- The same rows as after the game, so a rating can be given late or
           changed: the player's current one is shown and replaced in place. -->
      <RatingPanel
        {t}
        {storageOk}
        title={t.ratingTitle}
        subjects={ratingSubjects}
        labelOf={(s) => setNames.get(s.code) ?? s.code}
        subOf={(s) => (s.kind === 'modular' ? undefined : t.scenario)}
        build={(s, score) => ratingOfPlay(s, score, play)}
      />
    {/if}
  {/if}
</div>

<style>
  .detail {
    padding: var(--space-4);
    margin: var(--space-3) 0;
    display: grid;
    gap: var(--space-3);
  }

  .head {
    display: flex;
    align-items: start;
    gap: var(--space-3);
  }

  .title {
    flex: 1;
    min-width: 0;
  }

  /* The villain's portrait: the top of the card, where the art is. */
  .face {
    flex: none;
    width: 3.5rem;
    height: 3.5rem;
    border-radius: var(--radius-sm);
    object-fit: cover;
    object-position: 50% 12%;
    background: var(--surface-2);
  }

  h2 {
    font-size: var(--text-lg);
    font-weight: var(--weight-bold);
    margin: 0;
  }

  .note {
    font-size: var(--text-sm);
    margin: 0;
  }

  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: var(--space-3);
    margin: 0;
  }

  .facts > div {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .facts .wide {
    grid-column: 1 / -1;
  }

  dt {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  dd {
    margin: 0;
  }

  dd.won {
    color: var(--accent);
    font-weight: var(--weight-semibold);
  }

  .notes {
    white-space: pre-wrap;
  }

  .seats {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .editor {
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

  /* The accent when starred: the one button on this row whose state is the
     point of it. */
  .starred {
    color: var(--accent);
    border-color: var(--accent);
  }

  .actions,
  .confirm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .confirm {
    flex-direction: column;
    align-items: start;
  }

  .inline {
    padding: 0;
    min-height: 0;
  }

  .danger {
    color: var(--danger);
  }

  .bgg-line {
    margin: var(--space-2) 0 0;
  }

  .note {
    font-size: var(--text-sm);
  }
</style>
