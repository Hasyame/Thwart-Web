<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import { VILLAIN_STEPS, type PausedPhase, type VillainStep } from '../lib/records';
  import {
    buildPausedGame,
    emptyDraft,
    savePausedGame,
    type LongBreakDraft,
  } from '../lib/pausedGame';
  import { endGame, pauseGame, session } from '../lib/session.svelte';

  interface Props {
    t: Strings;
    storageOk: boolean;
    /** Called once the table is clear, so the page can go back to setup. */
    onSaved: () => void;
    /**
     * The campaign run this scenario belongs to, if it is one.
     *
     * A campaign scenario is a game like any other and gets cleared off a table
     * for the same reasons; the run id is what lets it be picked up from the
     * campaign rather than from the play page.
     */
    campaignRunId?: string;
  }

  const { t, storageOk, onSaved, campaignRunId = '' }: Props = $props();

  let open = $state(false);
  let saving = $state(false);
  let draft = $state.raw<LongBreakDraft | null>(null);

  function begin(): void {
    // The clock stops first. Somebody filling this in is not playing, and the
    // minutes it takes to write the table down are not part of the game.
    pauseGame();
    draft = emptyDraft(session.current.seats, session.current.encounter);
    open = true;
  }

  function edit(change: Partial<LongBreakDraft>): void {
    if (draft !== null) {
      draft = { ...draft, ...change };
    }
  }

  function setLife(code: string, value: string): void {
    if (draft !== null) {
      draft = { ...draft, heroLives: { ...draft.heroLives, [code]: value } };
    }
  }

  async function save(): Promise<void> {
    if (draft === null || saving) {
      return;
    }
    saving = true;
    try {
      await savePausedGame(buildPausedGame(session.current, draft, Date.now(), campaignRunId));
      endGame();
      open = false;
      draft = null;
      onSaved();
    } finally {
      saving = false;
    }
  }
</script>

{#if storageOk}
  {#if !open}
    <button type="button" class="start" onclick={begin}>{t.longBreak}</button>
  {:else if draft !== null}
    <div class="panel surface">
      <h2>{t.longBreak}</h2>
      <p class="muted note">{t.longBreakIntro}</p>

      <fieldset>
        <legend class="muted">{t.longBreakPhase}</legend>
        <label class="radio">
          <input
            type="radio"
            checked={draft.phase === 'PLAYER'}
            onchange={() => edit({ phase: 'PLAYER' satisfies PausedPhase })}
          />
          <span>{t.phasePlayer}</span>
        </label>
        <label class="radio">
          <input
            type="radio"
            checked={draft.phase === 'VILLAIN'}
            onchange={() => edit({ phase: 'VILLAIN' satisfies PausedPhase })}
          />
          <span>{t.phaseVillain}</span>
        </label>
      </fieldset>

      {#if draft.phase === 'VILLAIN'}
        <!-- The villain phase has steps of its own and the player phase does
             not, which is why this only appears for one of them. Coming back
             to a table after a week, the question is never "whose turn" but
             "how far through the villain's turn were we". -->
        <label class="field">
          <span class="muted">{t.phaseVillain}</span>
          <select
            value={draft.villainStep}
            onchange={(e) => edit({ villainStep: e.currentTarget.value as VillainStep })}
          >
            {#each VILLAIN_STEPS as step (step)}
              <option value={step}>{t.villainStep(step)}</option>
            {/each}
          </select>
        </label>
      {/if}

      {#if session.current.seats.length > 0}
        <fieldset>
          <legend class="muted">{t.heroLives}</legend>
          {#each session.current.seats as seat (seat.deckId)}
            <label class="field inline">
              <span>{seat.heroName}</span>
              <input
                type="number"
                min="0"
                inputmode="numeric"
                value={draft.heroLives[seat.heroCode] ?? ''}
                oninput={(e) => setLife(seat.heroCode, e.currentTarget.value)}
              />
            </label>
          {/each}
        </fieldset>
      {/if}

      <label class="field">
        <span class="muted">{t.villainLifeLeft}</span>
        <input
          type="number"
          min="0"
          inputmode="numeric"
          value={draft.villainLife}
          oninput={(e) => edit({ villainLife: e.currentTarget.value })}
        />
      </label>

      <label class="field">
        <span class="muted">{t.villainStageLabel}</span>
        <select
          value={String(draft.villainStage)}
          onchange={(e) => edit({ villainStage: Number.parseInt(e.currentTarget.value, 10) || 1 })}
        >
          {#each [1, 2, 3] as stage (stage)}
            <option value={String(stage)}>{stage}</option>
          {/each}
        </select>
      </label>

      <div class="actions">
        <button class="primary" type="button" onclick={save} disabled={saving}>
          {t.savePutAway}
        </button>
        <button type="button" onclick={() => (open = false)} disabled={saving}>{t.cancel}</button>
      </div>
    </div>
  {/if}
{/if}

<style>
  .panel {
    padding: var(--space-4);
    margin: var(--space-4) 0;
  }

  h2 {
    font-size: 1.05rem;
    margin-bottom: var(--space-1);
  }

  fieldset {
    border: 1px solid var(--md-outline-variant);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    margin: var(--space-3) 0;
  }

  legend {
    padding-inline: var(--space-1);
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .radio {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: var(--space-3) 0;
    max-width: 24rem;
  }

  .field.inline {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin: var(--space-2) 0;
  }

  .field.inline input {
    width: 6rem;
  }

  select,
  input[type='number'] {
    background: var(--md-surface);
    color: var(--md-on-surface);
    border: 1px solid var(--md-outline);
    border-radius: var(--radius-sm);
    padding: var(--space-2);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  button {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-lg);
    border: 1px solid var(--md-outline);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: var(--md-surface-container-high);
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  button.primary {
    background: var(--md-primary);
    color: var(--md-on-primary);
    border-color: var(--md-primary);
  }

  .start {
    margin-top: var(--space-2);
  }

  .note {
    font-size: 0.85rem;
    max-width: var(--prose-max);
  }
</style>
