<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { IndexRow, Locale } from '../lib/types';
  import { formatElapsed, session } from '../lib/session.svelte';
  import { ScreenWakeLock } from '../lib/wakeLock.svelte';
  import Tracker from './Tracker.svelte';
  import LongBreak from './LongBreak.svelte';

  interface Props {
    t: Strings;
    cardLocale: Locale;
    index: readonly IndexRow[];
    /** Standard plays the first two villain stages, Expert the last two. */
    expert: boolean;
    scenarioName: string;
    /** The encounter sets this scenario's deck is built from, already named. */
    encounterSets: readonly string[];
    elapsedMillis: number;
    running: boolean;
    storageOk: boolean;
    campaignRunId: string;
    onPause: () => void;
    onResume: () => void;
    onCorrect: (millis: number) => void;
    onVictory: () => void;
    onDefeat: () => void;
    onBreakSaved: () => void;
  }

  const {
    t,
    cardLocale,
    index,
    expert,
    scenarioName,
    encounterSets,
    elapsedMillis,
    running,
    storageOk,
    campaignRunId,
    onPause,
    onResume,
    onCorrect,
    onVictory,
    onDefeat,
    onBreakSaved,
  }: Props = $props();

  let editingClock = $state(false);
  let clockMinutes = $state(0);

  function openClockEdit(): void {
    clockMinutes = Math.round(elapsedMillis / 60_000);
    editingClock = true;
  }

  function applyClockEdit(): void {
    onCorrect(Math.max(0, clockMinutes) * 60_000);
    editingClock = false;
  }

  const wake = new ScreenWakeLock();

  $effect(() => {
    const reacquire = (): void => wake.reacquire();
    document.addEventListener('visibilitychange', reacquire);
    return () => {
      document.removeEventListener('visibilitychange', reacquire);
      wake.dispose();
    };
  });
</script>

<div class="running surface">
  <!-- Name, heroes and encounter deck at the top, as the app has it: the three
       things somebody glances up to check mid-game. -->
  <p class="scenario">{scenarioName}</p>
  <p class="heroes">{session.current.seats.map((seat) => seat.heroName).join(', ')}</p>
  {#if encounterSets.length > 0}
    <p class="muted sets">{encounterSets.join(', ')}</p>
  {/if}

  <button class="clock" type="button" onclick={openClockEdit}>{formatElapsed(elapsedMillis)}</button>
  <p class="muted note tap">{t.tapToCorrect}</p>

  {#if editingClock}
    <label class="field-group">
      <span class="field-label">{t.correctTheClock}</span>
      <input
        type="number"
        min="0"
        inputmode="numeric"
        bind:value={clockMinutes}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            applyClockEdit();
          }
        }}
      />
    </label>
    <div class="clock-actions">
      <button class="primary" type="button" onclick={applyClockEdit}>{t.saveResult}</button>
      <button type="button" onclick={() => (editingClock = false)}>{t.cancel}</button>
    </div>
  {/if}

  <div class="clock-actions">
    {#if running}
      <button type="button" onclick={onPause}>{t.pauseClock}</button>
    {:else}
      <button type="button" onclick={onResume}>{t.resumeClock}</button>
    {/if}
  </div>

  <!-- Written down rather than navigated away from, exactly as a standalone
       game does it: the scenario has not moved on, it is being recorded. -->
  <LongBreak {t} {storageOk} {campaignRunId} onSaved={onBreakSaved} />
</div>

<Tracker {t} {cardLocale} {index} {expert} />

<label class="awake surface">
  <span>{t.keepScreenOn}</span>
  <input type="checkbox" checked={wake.on} onchange={(e) => void wake.set(e.currentTarget.checked)} />
</label>

<div class="ending">
  <button class="primary big" type="button" onclick={onVictory}>{t.won}</button>
  <button class="big" type="button" onclick={onDefeat}>{t.lost}</button>
</div>

<style>
  .running {
    padding: var(--space-4);
    margin: var(--space-3) 0;
  }

  .scenario {
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--accent);
    text-align: center;
    margin: 0;
  }

  .heroes {
    text-align: center;
    font-weight: 600;
    margin: var(--space-1) 0 0;
  }

  .sets {
    text-align: center;
    font-size: var(--text-sm);
    margin: var(--space-1) 0 0;
  }

  /* A button now, because tapping it corrects it, but it must not look like
     one: it is the biggest thing on the screen and the game is what it counts. */
  .clock {
    display: block;
    width: 100%;
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    font-size: var(--text-4xl);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: center;
    margin: var(--space-3) 0 0;
    padding: 0;
  }

  .clock:hover {
    color: var(--accent);
  }

  .tap {
    text-align: center;
    font-size: var(--text-xs);
  }

  .note {
    font-size: var(--text-sm);
    max-width: var(--prose-max);
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-width: 26rem;
  }

  .clock-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .awake {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    margin: var(--space-3) 0;
  }

  .ending {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }

  .ending .big {
    flex: 1 1 10rem;
  }

  input {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface-1);
    color: var(--text);
  }

  button {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  button.primary {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
    font-weight: 700;
  }

  button.big {
    padding: var(--space-3) var(--space-6);
    font-size: var(--text-lg);
  }
</style>
