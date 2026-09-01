<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale } from '../lib/types';
  import type { SavedDeck } from '../lib/records';
  import { textOf, type CampaignTemplate } from '../lib/campaign/types';
  import {
    loadTemplate,
    loadTemplateIndex,
    startCampaign,
    type TemplateSummary,
  } from '../lib/campaign/store';

  interface Props {
    t: Strings;
    uiLocale: Locale;
    decks: readonly SavedDeck[];
    onStarted: (runId: string) => void;
    onCancel: () => void;
  }

  const { t, uiLocale, decks, onStarted, onCancel }: Props = $props();

  let summaries = $state.raw<readonly TemplateSummary[]>([]);
  let loadError = $state(false);

  $effect(() => {
    let cancelled = false;
    loadTemplateIndex()
      .then((list) => {
        if (!cancelled) {
          summaries = list;
        }
      })
      .catch(() => {
        if (!cancelled) {
          loadError = true;
        }
      });
    return () => {
      cancelled = true;
    };
  });

  let templateId = $state('');
  let template = $state.raw<CampaignTemplate | null>(null);
  let difficulty = $state('standard');
  let name = $state('');
  let chosenDeckIds = $state<string[]>([]);
  let choices = $state<Record<string, string>>({});
  let starting = $state(false);

  // Loaded in full only once a campaign is picked: the index is a few hundred
  // bytes and the templates are tens of kilobytes each.
  $effect(() => {
    if (templateId === '') {
      template = null;
      return;
    }
    let cancelled = false;
    loadTemplate(templateId)
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        template = loaded;
        name = textOf(loaded.name, uiLocale);
        difficulty = loaded.difficulties?.[0] ?? 'standard';
        // Every question gets its own first option, so a campaign started
        // without touching them behaves exactly as the fold would assume.
        choices = Object.fromEntries(
          (loaded.setupChoices ?? []).map((choice) => [choice.id, choice.options?.[0]?.id ?? '']),
        );
      })
      .catch(() => {
        if (!cancelled) {
          loadError = true;
        }
      });
    return () => {
      cancelled = true;
    };
  });

  function toggleDeck(id: string): void {
    chosenDeckIds = chosenDeckIds.includes(id)
      ? chosenDeckIds.filter((existing) => existing !== id)
      : [...chosenDeckIds, id];
  }

  const canStart = $derived(
    template !== null && chosenDeckIds.length > 0 && name.trim() !== '' && !starting,
  );

  async function start(): Promise<void> {
    if (template === null || !canStart) {
      return;
    }
    starting = true;
    try {
      const heroes = chosenDeckIds.map((deckId) => {
        const deck = decks.find((candidate) => candidate.id === deckId);
        return {
          // The deck id is the hero id for the whole run, which is what lets a
          // per-hero counter follow one player across every scenario.
          id: deckId,
          deckId,
          heroCardCode: deck?.heroCode ?? '',
          name: deck?.heroName ?? deck?.name ?? deckId,
        };
      });

      const run = await startCampaign({
        template,
        name: name.trim(),
        difficulty,
        standardSet: '',
        heroes,
        choices,
        startScenarioId: template.startScenarioId ?? template.scenarios?.[0]?.id ?? '',
      });
      onStarted(run.id);
    } finally {
      starting = false;
    }
  }
</script>

<div class="start surface">
  <h2>{t.startCampaign}</h2>

  {#if loadError}
    <p class="muted note">{t.campaignsUnavailable}</p>
  {:else if summaries.length === 0}
    <p class="muted note">{t.loading}</p>
  {:else}
    <label class="field">
      <span class="muted">{t.campaign}</span>
      <select value={templateId} onchange={(e) => (templateId = e.currentTarget.value)}>
        <option value="">{t.choose}</option>
        {#each summaries as summary (summary.id)}
          <option value={summary.id}>{textOf(summary.name, uiLocale)}</option>
        {/each}
      </select>
    </label>
  {/if}

  {#if template !== null}
    {#if template.wip === true}
      <!-- Marked incomplete by whoever wrote it. Shown anyway, because a
           half-written campaign is still worth reading, but not silently. -->
      <p class="warning">{t.campaignWip}</p>
    {/if}

    {#if template.notice !== null && template.notice !== undefined}
      <p class="muted note">{textOf(template.notice, uiLocale)}</p>
    {/if}

    <label class="field">
      <span class="muted">{t.campaignName}</span>
      <input type="text" value={name} oninput={(e) => (name = e.currentTarget.value)} />
    </label>

    <label class="field">
      <span class="muted">{t.difficultyLabel}</span>
      <select value={difficulty} onchange={(e) => (difficulty = e.currentTarget.value)}>
        {#each template.difficulties ?? ['standard'] as id (id)}
          <option value={id}>{t.campaignDifficulty(id)}</option>
        {/each}
      </select>
    </label>

    {#each template.setupChoices ?? [] as choice (choice.id)}
      <label class="field">
        <span class="muted">{textOf(choice.label, uiLocale)}</span>
        <select
          value={choices[choice.id] ?? ''}
          onchange={(e) => (choices = { ...choices, [choice.id]: e.currentTarget.value })}
        >
          {#each choice.options ?? [] as option (option.id)}
            <option value={option.id}>{textOf(option.label, uiLocale)}</option>
          {/each}
        </select>
      </label>
      {#if (choice.options ?? []).find((option) => option.id === choices[choice.id])?.detail != null}
        <p class="muted note">
          {textOf(
            (choice.options ?? []).find((option) => option.id === choices[choice.id])?.detail,
            uiLocale,
          )}
        </p>
      {/if}
    {/each}

    <fieldset>
      <legend class="muted">{t.campaignRoster}</legend>
      {#if decks.length === 0}
        <p class="muted note">{t.noDecksForPlay}</p>
      {:else}
        <!-- The roster is fixed for the whole campaign, which is why it is
             chosen here and never again: a per-hero counter has to follow the
             same player from the first scenario to the last. -->
        {#each decks as deck (deck.id)}
          <label class="deck">
            <input
              type="checkbox"
              checked={chosenDeckIds.includes(deck.id)}
              onchange={() => toggleDeck(deck.id)}
            />
            <span><strong>{deck.name}</strong> · {deck.heroName}</span>
          </label>
        {/each}
      {/if}
    </fieldset>

    <div class="actions">
      <button class="primary" type="button" onclick={start} disabled={!canStart}>
        {t.startCampaign}
      </button>
      <button type="button" onclick={onCancel} disabled={starting}>{t.cancel}</button>
    </div>
    <p class="muted note">{t.campaignRosterNote}</p>
  {/if}
</div>

<style>
  .start {
    padding: var(--space-4);
    margin: var(--space-4) 0;
  }

  h2 {
    font-size: 1.05rem;
    margin-bottom: var(--space-2);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: var(--space-3) 0;
    max-width: 30rem;
  }

  select,
  input[type='text'] {
    background: var(--md-surface);
    color: var(--md-on-surface);
    border: 1px solid var(--md-outline);
    border-radius: var(--radius-sm);
    padding: var(--space-2);
  }

  fieldset {
    border: 1px solid var(--md-outline-variant);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    margin: var(--space-4) 0;
  }

  legend {
    padding-inline: var(--space-1);
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .deck {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
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

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  button.primary {
    background: var(--md-primary);
    color: var(--md-on-primary);
    border-color: var(--md-primary);
  }

  .warning {
    color: var(--md-error);
    font-weight: 600;
  }

  .note {
    font-size: 0.85rem;
    max-width: var(--prose-max);
  }
</style>
