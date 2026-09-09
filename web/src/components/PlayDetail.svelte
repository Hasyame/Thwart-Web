<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale } from '../lib/types';
  import type { CampaignRun, Play } from '../lib/records';
  import { db } from '../lib/db';
  import { formatElapsed } from '../lib/session.svelte';
  import { playerBucket } from '../lib/plays';
  import { campaignFigures } from '../lib/campaignFigures';

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
  }

  const { t, uiLocale, play, run, onClose, onOpenRun }: Props = $props();

  let editing = $state(false);
  let confirming = $state(false);
  let busy = $state(false);

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
    const id = play.campaignRunId;
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
    <div>
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
      {#if play.notes !== ''}
        <div class="wide">
          <dt>{t.notes}</dt>
          <dd class="notes">{play.notes}</dd>
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
        <button class="btn" type="button" disabled={busy} onclick={openEditor}>{t.playEdit}</button>
        <button class="btn btn--quiet danger" type="button" onclick={() => (confirming = true)}>
          {t.playDelete}
        </button>
      </div>
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
    justify-content: space-between;
    gap: var(--space-3);
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
</style>
