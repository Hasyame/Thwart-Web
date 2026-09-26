<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { IndexRow, Locale } from '../lib/types';
  import type { EncounterSetup } from '../lib/encounter';
  import { formatElapsed, session } from '../lib/session.svelte';
  import { ScreenWakeLock } from '../lib/wakeLock.svelte';
  import Tracker from './Tracker.svelte';
  import LongBreak from './LongBreak.svelte';
  import GameRules from './GameRules.svelte';
  import CampaignMission from './CampaignMission.svelte';
  import CampaignTableExtras from './CampaignTableExtras.svelte';

  interface Props {
    guided?: boolean;
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
    /** Numbers the campaign carries itself, when it has any. */
    trackerSetup?: EncounterSetup | null;
    villainOrder?: readonly string[];
    mission?: {code: string; overseer: string; threat: number} | null;
    cardName?: (code: string) => string;
    onPause: () => void;
    onResume: () => void;
    onCorrect: (millis: number) => void;
    onVictory: () => void;
    onDefeat: () => void;
    onBreakSaved: () => void;
  }

  const {
    guided = false,
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
    trackerSetup = null,
    villainOrder = [],
    mission = null,
    cardName = code => code,
    onPause,
    onResume,
    onCorrect,
    onVictory,
    onDefeat,
    onBreakSaved,
  }: Props = $props();

  let editingClock = $state(false);
  let clockMinutes = $state(0);
  let clockHours = $state(0);
  let clockSeconds = $state(0);
  const clockValid = $derived(Number.isInteger(clockMinutes) && clockMinutes >= 0 && (!guided || (clockMinutes <= 59 && Number.isInteger(clockHours) && clockHours >= 0 && clockHours <= 9999 && Number.isInteger(clockSeconds) && clockSeconds >= 0 && clockSeconds <= 59)));

  function openClockEdit(): void {
    clockHours = Math.floor(elapsedMillis / 3_600_000);
    clockMinutes = guided ? Math.floor(elapsedMillis / 60_000) % 60 : Math.round(elapsedMillis / 60_000);
    clockSeconds = Math.floor(elapsedMillis / 1000) % 60;
    editingClock = true;
  }

  function applyClockEdit(): void {
    if (!clockValid) return;
    onCorrect(clockMinutes * 60_000 + (guided ? clockHours * 3_600_000 + clockSeconds * 1000 : 0));
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

<GameRules {t} {cardLocale} />

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
    {#if guided}<div class="clock-parts"><label class="field-group">{t.campaignClockHours}<input class="field" type="number" min="0" max="9999" step="1" inputmode="numeric" bind:value={clockHours} /></label><label class="field-group">{t.campaignClockMinutes}<input class="field" type="number" min="0" max="59" step="1" inputmode="numeric" bind:value={clockMinutes} /></label><label class="field-group">{t.campaignClockSeconds}<input class="field" type="number" min="0" max="59" step="1" inputmode="numeric" bind:value={clockSeconds} /></label></div>{:else}
    <label class="field-group">
      <span class="field-label">{t.correctTheClock}</span>
      <input class="field"
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
    {/if}
    <div class="clock-actions">
      <button class="btn btn--primary" type="button" disabled={!clockValid} onclick={applyClockEdit}>{t.saveResult}</button>
      <button class="btn" type="button" onclick={() => (editingClock = false)}>{t.cancel}</button>
    </div>
  {/if}

  <div class="clock-actions">
    {#if running}
      <button class="btn" type="button" onclick={onPause}>{t.pauseClock}</button>
    {:else}
      <button class="btn" type="button" onclick={onResume}>{t.resumeClock}</button>
    {/if}
  </div>

  <!-- Written down rather than navigated away from, exactly as a standalone
       game does it: the scenario has not moved on, it is being recorded. -->
  <LongBreak {t} {storageOk} {campaignRunId} onSaved={onBreakSaved} />
</div>

<Tracker comic={guided} {t} {cardLocale} {index} {expert} {villainOrder} setup={trackerSetup} />
<CampaignTableExtras {t} {cardName} />
{#if mission !== null}
  <CampaignMission {t} initialThreat={mission.threat} missionCode={mission.code} overseerCode={mission.overseer} {cardName} />
{/if}

<label class="awake surface">
  <span>{t.keepScreenOn}</span>
  <input type="checkbox" checked={wake.on} onchange={(e) => void wake.set(e.currentTarget.checked)} />
</label>

<!-- The end of the scenario, as the guide's last panel, after ArkhamCards'
     "scenario completed": one comic frame, the two ways it can end inside. -->
<section class="ending">
  <h2 class="ending-title">{t.campaignScenarioOver}</h2>
  <p class="ending-detail">{t.campaignRecordResult}</p>
  <div class="ending-actions">
    <button class="btn btn--primary big" type="button" disabled={session.current.encounter?.setup.regeneration === true && session.current.encounter?.progress.noLongerWorthy !== true} onclick={onVictory}>{t.won}</button>
    <button class="btn big" type="button" onclick={onDefeat}>{t.lost}</button>
  </div>
</section>

<style>
  .clock-parts { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: var(--space-3); }
  .clock-parts input { width: 100%; min-width: 0; }
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

  /* A comic panel: heavy frame, offset shadow, halftone on the surface. */
  .ending {
    display: grid;
    gap: var(--space-2);
    justify-items: center;
    margin: var(--space-6) 0 var(--space-4);
    padding: var(--space-5) var(--space-4);
    border: 3px solid var(--text);
    border-radius: var(--radius-sm);
    background:
      radial-gradient(color-mix(in srgb, var(--accent) 18%, transparent) 1.1px, transparent 1.5px) 0 0 / 7px 7px,
      var(--surface-1);
    box-shadow: 6px 6px 0 var(--text);
    text-align: center;
  }

  .ending-title {
    margin: 0;
    color: var(--accent);
    font-size: var(--text-2xl);
    font-weight: 900;
    font-style: italic;
    text-transform: uppercase;
    letter-spacing: -0.02em;
  }

  .ending-detail {
    margin: 0;
    color: var(--text-muted);
  }

  .ending-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  .ending .big {
    flex: 1 1 10rem;
  }

  .big {
    padding: var(--space-3) var(--space-6);
    font-size: var(--text-lg);
  }
</style>
