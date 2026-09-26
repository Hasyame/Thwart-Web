<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale, IndexRow } from '../lib/types';
  import { evaluate } from '../lib/campaign/conditions';
  import { formatElapsed } from '../lib/session.svelte';
  import { parseCampaignText, type TextContext } from '../lib/campaign/text';
  import {
    promptTypeOf,
    textOf,
    type AnswerSet,
    type CampaignState,
    type Outcome,
    type Prompt,
    type ScenarioTemplate,
  } from '../lib/campaign/types';
  import CampaignText from './CampaignText.svelte';
  import CardRef from './CardRef.svelte';

  interface Props {
    index: readonly IndexRow[];
    t: Strings;
    uiLocale: Locale;
    campaign: CampaignState;
    scenario: ScenarioTemplate;
    victory: boolean;
    elapsedMillis: number;
    text: TextContext;
    cardName: (code: string) => string;
    /** Every card in the decks being played, for questions that pick from them. */
    deckCardCodes: readonly string[];
    submitting: boolean;
    onSubmit: (answers: AnswerSet) => void;
    onBack: () => void;
  }

  const {
    index,
    t,
    uiLocale,
    campaign,
    scenario,
    victory,
    elapsedMillis,
    text,
    cardName,
    deckCardCodes,
    submitting,
    onSubmit,
    onBack,
  }: Props = $props();

  const label = (value: Parameters<typeof textOf>[0]): string => textOf(value, uiLocale);
  const outcome = $derived<Outcome | null>(
    (victory ? scenario.onVictory : scenario.onDefeat) ?? null,
  );

  let answers = $state<{
    numbers: Record<string, number>;
    booleans: Record<string, boolean>;
    choices: Record<string, string>;
    cardLists: Record<string, string[]>;
    perHeroNumbers: Record<string, Record<string, number>>;
    perHeroBooleans: Record<string, Record<string, boolean>>;
    perHeroCards: Record<string, Record<string, string[]>>;
  }>({
    numbers: {},
    booleans: {},
    choices: {},
    cardLists: {},
    perHeroNumbers: {},
    perHeroBooleans: {},
    perHeroCards: {},
  });

  const built = $derived<AnswerSet>({
    numbers: answers.numbers,
    booleans: answers.booleans,
    choices: answers.choices,
    cardLists: answers.cardLists,
    perHeroNumbers: answers.perHeroNumbers,
    perHeroBooleans: answers.perHeroBooleans,
    perHeroCards: answers.perHeroCards,
  });

  /*
   * Conditions are judged against the answers as they stand, so a question can
   * appear because of one already answered. That is why this re-derives rather
   * than being computed once when the page opens.
   */
  const prompts = $derived(
    (outcome?.prompts ?? []).filter((prompt) =>
      evaluate(prompt.when, { state: campaign, scenarioId: scenario.id, answers: built }),
    ),
  );

  /** The cards a question offers: its own list, or the players' decks. */
  const cardsFor = (prompt: Prompt): readonly string[] =>
    prompt.cardType != null ? index.filter(card => card.typeCode === prompt.cardType && ['aggression','justice','leadership','protection','basic','pool'].includes(card.factionCode)).map(card => card.code)
      : promptTypeOf(prompt) === 'deckcardselect' ? deckCardCodes : (prompt.cards ?? []);

  const heroesFor = (prompt: Prompt) => campaign.heroes.filter(hero => !prompt.excludeEliminated || answers.perHeroBooleans.eliminated?.[hero.id] !== true);
  let rewardSearch = $state('');

  /**
   * A choice left open blocks recording.
   *
   * The campaign expects it and later scenarios assume it was made, so
   * defaulting one silently would take a decision away from the table and hide
   * having done so.
   */
  const missing = $derived(
    prompts.filter(
      (prompt) =>
        (campaign.templateId === 'aoa' && promptTypeOf(prompt) === 'boolean' && answers.booleans[prompt.id] === undefined) ||
        (campaign.templateId === 'aoa' && promptTypeOf(prompt) === 'perheroboolean' && campaign.heroes.some(hero => answers.perHeroBooleans[prompt.id]?.[hero.id] === undefined)) ||
        (promptTypeOf(prompt) === 'choice' && (answers.choices[prompt.id] ?? '') === '') ||
        (promptTypeOf(prompt) === 'perherocardselect' && heroesFor(prompt).some(hero => {
          const count = answers.perHeroCards[prompt.id]?.[hero.id]?.length ?? 0;
          return count < (prompt.min ?? 0) || count > (prompt.max ?? Infinity);
        })),
    ),
  );

  const setNumber = (id: string, value: number): void => {
    answers = { ...answers, numbers: { ...answers.numbers, [id]: value } };
  };
  const setBoolean = (id: string, value: boolean): void => {
    answers = { ...answers, booleans: { ...answers.booleans, [id]: value } };
  };
  const setChoice = (id: string, value: string): void => {
    answers = { ...answers, choices: { ...answers.choices, [id]: value } };
  };
  const setHeroNumber = (id: string, heroId: string, value: number): void => {
    answers = {
      ...answers,
      perHeroNumbers: {
        ...answers.perHeroNumbers,
        [id]: { ...(answers.perHeroNumbers[id] ?? {}), [heroId]: value },
      },
    };
  };
  const setHeroBoolean = (id: string, heroId: string, value: boolean): void => {
    answers = {
      ...answers,
      perHeroBooleans: {
        ...answers.perHeroBooleans,
        [id]: { ...(answers.perHeroBooleans[id] ?? {}), [heroId]: value },
      },
    };
  };

  const toggle = (list: readonly string[], code: string): string[] =>
    list.includes(code) ? list.filter((entry) => entry !== code) : [...list, code];

  const toggleCard = (id: string, code: string): void => {
    answers = {
      ...answers,
      cardLists: { ...answers.cardLists, [id]: toggle(answers.cardLists[id] ?? [], code) },
    };
  };
  const toggleHeroCard = (id: string, heroId: string, code: string): void => {
    const forPrompt = answers.perHeroCards[id] ?? {};
    answers = {
      ...answers,
      perHeroCards: {
        ...answers.perHeroCards,
        [id]: { ...forPrompt, [heroId]: toggle(forPrompt[heroId] ?? [], code) },
      },
    };
  };

  /** A free-text list, split the way the app splits it: on commas. */
  const setTypedList = (id: string, typed: string): void => {
    answers = {
      ...answers,
      cardLists: {
        ...answers.cardLists,
        [id]: typed
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry !== ''),
      },
    };
  };
</script>

<section class="panel">
  <p class="verdict" class:won={victory}>{victory ? t.campaignBravo : t.campaignDefeatRecorded}</p>
  <p class="clock">{formatElapsed(elapsedMillis)}</p>
  <p class="muted note centre">{t.timePlayedLabel}</p>

  {#if outcome?.message != null && label(outcome.message) !== ''}
    <p class="message"><CampaignText segments={parseCampaignText(label(outcome.message), text)} /></p>
  {/if}
</section>

<section class="panel">
  <h3>{t.campaignQuestionsTitle}</h3>

  {#if prompts.length === 0}
    <p class="muted note">{t.campaignNoQuestions}</p>
  {/if}

  {#each prompts as prompt (prompt.id)}
    {@const kind = promptTypeOf(prompt)}
    <div class="prompt">
      <p class="ask">
        <CampaignText segments={parseCampaignText(label(prompt.label) || prompt.id, text)} />
      </p>

      {#if kind === 'number'}
        <input class="field"
          type="number"
          min={prompt.min ?? 0}
          max={prompt.max ?? undefined}
          inputmode="numeric"
          value={answers.numbers[prompt.id] ?? 0}
          oninput={(e) => setNumber(prompt.id, Number.parseInt(e.currentTarget.value, 10) || 0)}
        />
      {:else if kind === 'boolean'}
        {#if campaign.templateId === 'aoa'}
          <div class="binary-answer" role="group" aria-label={label(prompt.label) || prompt.id}>
            {#each [true, false] as value}<label class="binary-option" class:selected={answers.booleans[prompt.id] === value}><input type="radio" name={`answer-${prompt.id}`} checked={answers.booleans[prompt.id] === value} onchange={() => setBoolean(prompt.id, value)} /><span>{value ? t.yes : t.campaignAnswerNo}</span></label>{/each}
          </div>
        {:else}
        <label class="tick">
          <input
            type="checkbox"
            checked={answers.booleans[prompt.id] === true}
            onchange={(e) => setBoolean(prompt.id, e.currentTarget.checked)}
          />
          <span>{t.yes}</span>
        </label>
        {/if}
      {:else if kind === 'choice'}
        <select class="field"
          value={answers.choices[prompt.id] ?? ''}
          onchange={(e) => setChoice(prompt.id, e.currentTarget.value)}
        >
          <option value="">{t.choose}</option>
          {#each prompt.options ?? [] as option (option.id)}
            <option value={option.id}>{label(option.label) || option.id}</option>
          {/each}
        </select>
      {:else if kind === 'perheronumber'}
        {#each campaign.heroes as hero (hero.id)}
          <label class="row">
            <span>{hero.name}</span>
            <input class="field"
              type="number"
              min={prompt.min ?? 0}
              inputmode="numeric"
              value={answers.perHeroNumbers[prompt.id]?.[hero.id] ?? 0}
              oninput={(e) =>
                setHeroNumber(prompt.id, hero.id, Number.parseInt(e.currentTarget.value, 10) || 0)}
            />
          </label>
        {/each}
      {:else if kind === 'perheroboolean'}
        {#each campaign.heroes as hero (hero.id)}
          {#if campaign.templateId === 'aoa'}
            <p>{hero.name}</p><div class="binary-answer" role="group" aria-label={`${hero.name}: ${label(prompt.label) || prompt.id}`}>
              {#each [true, false] as value}<label class="binary-option" class:selected={answers.perHeroBooleans[prompt.id]?.[hero.id] === value}><input type="radio" name={`answer-${prompt.id}-${hero.id}`} checked={answers.perHeroBooleans[prompt.id]?.[hero.id] === value} onchange={() => setHeroBoolean(prompt.id, hero.id, value)} /><span>{value ? t.yes : t.campaignAnswerNo}</span></label>{/each}
            </div>
          {:else}
          <label class="tick">
            <input
              type="checkbox"
              checked={answers.perHeroBooleans[prompt.id]?.[hero.id] === true}
              onchange={(e) => setHeroBoolean(prompt.id, hero.id, e.currentTarget.checked)}
            />
            <span>{hero.name}</span>
          </label>
          {/if}
        {/each}
      {:else if kind === 'cardselect' || kind === 'deckcardselect'}
        {@const codes = cardsFor(prompt)}
        {#if codes.length === 0}
          <p class="muted note">{t.campaignNoDeckCards}</p>
        {:else}
          <!-- Card codes recorded rather than typed titles, so a later scenario
               can act on the answer instead of only showing it back. -->
          <div class="picks">
            {#each codes as code (code)}
              <label class="tick">
                <input
                  type="checkbox"
                  checked={(answers.cardLists[prompt.id] ?? []).includes(code)}
                  onchange={() => toggleCard(prompt.id, code)}
                />
                <span><CardRef {code} name={cardName(code)} /></span>
              </label>
            {/each}
          </div>
        {/if}
      {:else if kind === 'perherocardselect'}
        <!-- One answer per player, not one set for the table: two players may
             well pick the same card, and a shared set cannot hold it twice nor
             say who took it. -->
        {#if prompt.cardType}<input class="field" type="search" aria-label={label(prompt.label)} bind:value={rewardSearch} />{/if}
        {#each heroesFor(prompt) as hero (hero.id)}
          <p class="who muted">{hero.name}</p>
          <div class="picks">
            {#each cardsFor(prompt).filter(code => !prompt.cardType || cardName(code).toLocaleLowerCase().includes(rewardSearch.toLocaleLowerCase()) || (answers.perHeroCards[prompt.id]?.[hero.id] ?? []).includes(code)) as code (code)}
              <label class="tick">
                <input
                  type="checkbox"
                  checked={(answers.perHeroCards[prompt.id]?.[hero.id] ?? []).includes(code)}
                  onchange={() => toggleHeroCard(prompt.id, hero.id, code)}
                />
                <span><CardRef {code} name={cardName(code)} /></span>
              </label>
            {/each}
          </div>
        {/each}
      {:else if kind === 'cardlist'}
        <input class="field"
          type="text"
          value={(answers.cardLists[prompt.id] ?? []).join(', ')}
          oninput={(e) => setTypedList(prompt.id, e.currentTarget.value)}
        />
        <p class="muted note">{t.campaignCardListHint}</p>
      {:else}
        <!-- A question this build cannot ask. Named rather than skipped:
             silently dropping one changes the campaign, and the table needs to
             know it was asked something. -->
        <p class="muted note">{t.promptUnsupported(prompt.type)}</p>
      {/if}
    </div>
  {/each}

  {#if missing.length > 0}
    <p class="warning">{t.campaignAnswerRequired}</p>
  {/if}

  <div class="actions">
    <button
      class="btn btn--primary"
      type="button"
      disabled={submitting || missing.length > 0}
      onclick={() => onSubmit(built)}
    >
      {submitting ? t.campaignValidating : t.campaignValidate}
    </button>
    <button class="btn" type="button" disabled={submitting} onclick={onBack}>{t.backToGame}</button>
  </div>
</section>

<style>
  .binary-answer { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); margin-block: var(--space-3); }
  .binary-option { min-height: 56px; display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3); border: 2px solid var(--border); cursor: pointer; font-weight: 700; }
  .binary-option.selected { border-color: var(--accent); background: var(--accent-soft); }
  .binary-option input { width: 22px; height: 22px; accent-color: var(--accent); }
  .binary-option:focus-within { outline: 3px solid var(--accent); outline-offset: 3px; }

  .panel {
    margin: var(--space-3) 0;
  }

  h3 {
    font-size: var(--text-lg);
    font-weight: 700;
    margin-bottom: var(--space-2);
  }

  .verdict {
    text-align: center;
    font-size: var(--text-xl);
    font-weight: 700;
    margin: 0;
    color: var(--danger);
  }

  .verdict.won {
    color: var(--accent);
  }

  .clock {
    text-align: center;
    font-size: var(--text-3xl);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    margin: var(--space-2) 0 0;
  }

  .centre {
    text-align: center;
  }

  .message {
    margin: var(--space-3) 0 0;
    max-width: var(--prose-max);
  }

  .prompt {
    padding: var(--space-3) 0;
    border-top: 1px solid var(--hairline);
    max-width: var(--prose-max);
  }

  .ask {
    font-weight: 600;
    margin: 0 0 var(--space-2);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap-min);
  }

  .row {
    justify-content: space-between;
    max-width: 22rem;
  }

  .picks {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(14rem, 100%), 1fr));
    gap: 0 var(--space-3);
  }

  .who {
    font-size: var(--text-sm);
    font-weight: 600;
    margin: var(--space-2) 0 0;
  }

  .note {
    font-size: var(--text-sm);
    max-width: var(--prose-max);
  }

  .warning {
    color: var(--danger);
    font-weight: 600;
    max-width: var(--prose-max);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }

  input[type='text'] {
    width: 100%;
    max-width: var(--prose-max);
  }

</style>
