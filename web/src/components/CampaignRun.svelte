<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale } from '../lib/types';
  import type { CampaignRun } from '../lib/records';
  import { evaluate } from '../lib/campaign/conditions';
  import { allSetupSteps, fold } from '../lib/campaign/engine';
  import { choosableScenarios, deal, drawPool } from '../lib/campaign/rules';
  import {
    counterOf,
    heroCounterOf,
    textOf,
    type AnswerSet,
    type CampaignEvent,
    type CampaignState,
    type Prompt,
    type ScenarioTemplate,
    type SetupStep,
  } from '../lib/campaign/types';
  import {
    chooseScenario,
    concede,
    continueOutcome,
    eventsOf,
    recordDraw,
    recordResult,
    takeSetupAction,
    templateOf,
  } from '../lib/campaign/store';
  import CampaignMarket from './CampaignMarket.svelte';

  interface Props {
    t: Strings;
    uiLocale: Locale;
    run: CampaignRun;
    /** Card names by code, so a template's card codes read as cards. */
    cardNames: ReadonlyMap<string, string>;
    onBack: () => void;
  }

  const { t, uiLocale, run, cardNames, onBack }: Props = $props();

  const template = $derived(templateOf(run));

  let events = $state.raw<readonly CampaignEvent[]>([]);
  let reloadToken = $state(0);

  $effect(() => {
    // Named so the effect re-runs after every append.
    void reloadToken;
    let cancelled = false;
    void eventsOf(run.id).then((loaded) => {
      if (!cancelled) {
        events = loaded;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  const reload = (): void => {
    reloadToken += 1;
  };

  const campaign = $derived<CampaignState | null>(
    template === null ? null : fold(template, events),
  );

  const scenario = $derived<ScenarioTemplate | null>(
    template === null || campaign === null || campaign.currentScenarioId === null
      ? null
      : ((template.scenarios ?? []).find((s) => s.id === campaign.currentScenarioId) ?? null),
  );

  const label = (text: Parameters<typeof textOf>[0]): string => textOf(text, uiLocale);
  const cardName = (code: string): string => cardNames.get(code) ?? code;

  /**
   * The setup steps to show, with fragments pulled in and conditions applied.
   *
   * A step naming a fragment is replaced by that fragment's steps, so a rule
   * written once appears wherever it is included. Conditions are judged against
   * the campaign as it stands now, which is what makes a campaign's setup change
   * as the run goes on.
   */
  const steps = $derived.by((): readonly SetupStep[] => {
    if (scenario === null || campaign === null || template === null) {
      return [];
    }
    const context = { state: campaign, scenarioId: scenario.id };
    const expanded: SetupStep[] = [];
    for (const step of allSetupSteps(scenario)) {
      if (!evaluate(step.when, context)) {
        continue;
      }
      if (step.include != null) {
        for (const inner of template.setupFragments?.[step.include] ?? []) {
          if (evaluate(inner.when, context)) {
            expanded.push(inner);
          }
        }
        continue;
      }
      expanded.push(step);
    }
    return expanded;
  });

  const takenActions = $derived(
    campaign === null || scenario === null ? [] : (campaign.setupActionsTaken[`${scenario.id}:`] ?? []),
  );

  async function act(step: SetupStep): Promise<void> {
    if (scenario === null || step.action == null) {
      return;
    }
    await takeSetupAction(run, scenario.id, step.action.id);
    reload();
  }

  /**
   * Draws for a setup step that asks for one, once.
   *
   * Recorded as an event rather than rolled while rendering: a pick made during
   * a redraw would come out differently every time, so the mission would change
   * while the player was reading it.
   */
  async function drawFor(step: SetupStep): Promise<void> {
    if (scenario === null || campaign === null || step.draw == null) {
      return;
    }
    const pool = drawPool(step.draw, campaign);
    const cards = deal(pool, step.draw.count ?? 1);
    await recordDraw(run, scenario.id, step.draw.id, cards);
    reload();
  }

  const drawnFor = (drawId: string): readonly string[] =>
    scenario === null || campaign === null ? [] : (campaign.draws[scenario.id]?.[drawId] ?? []);

  // --- recording a result ------------------------------------------------------

  let recording = $state<boolean | null>(null);
  let answers = $state<{
    numbers: Record<string, number>;
    booleans: Record<string, boolean>;
    choices: Record<string, string>;
    perHeroNumbers: Record<string, Record<string, number>>;
    perHeroBooleans: Record<string, Record<string, boolean>>;
  }>({ numbers: {}, booleans: {}, choices: {}, perHeroNumbers: {}, perHeroBooleans: {} });

  const outcome = $derived(
    scenario === null || recording === null
      ? null
      : recording
        ? (scenario.onVictory ?? null)
        : (scenario.onDefeat ?? null),
  );

  const prompts = $derived.by((): readonly Prompt[] => {
    if (outcome === null || campaign === null || scenario === null) {
      return [];
    }
    const context = { state: campaign, scenarioId: scenario.id, answers: built() };
    return (outcome.prompts ?? []).filter((prompt) => evaluate(prompt.when, context));
  });

  function built(): AnswerSet {
    return {
      numbers: answers.numbers,
      booleans: answers.booleans,
      choices: answers.choices,
      perHeroNumbers: answers.perHeroNumbers,
      perHeroBooleans: answers.perHeroBooleans,
    };
  }

  function begin(victory: boolean): void {
    recording = victory;
    answers = { numbers: {}, booleans: {}, choices: {}, perHeroNumbers: {}, perHeroBooleans: {} };
  }

  async function save(): Promise<void> {
    if (scenario === null || recording === null) {
      return;
    }
    await recordResult(run, scenario.id, recording, built(), 0);
    recording = null;
    reload();
  }

  async function moveOn(): Promise<void> {
    const last = campaign?.completedScenarios.at(-1);
    if (last === undefined) {
      return;
    }
    await continueOutcome(run, last.scenarioId, last.victory);
    reload();
  }

  const choices = $derived(
    template === null || campaign === null ? [] : choosableScenarios(template, campaign),
  );

  async function pick(scenarioId: string): Promise<void> {
    await chooseScenario(run, scenarioId);
    reload();
  }

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
</script>

<div class="run">
  <button class="back" type="button" onclick={onBack}>← {t.campaignsTitle}</button>

  {#if template === null}
    <p class="muted note">{t.campaignsUnavailable}</p>
  {:else if campaign === null}
    <p class="muted note">{t.loading}</p>
  {:else}
    <h2>{run.name}</h2>
    <p class="muted">
      {t.campaignDifficulty(campaign.difficulty)} ·
      {campaign.heroes.map((hero) => hero.name).join(', ')}
    </p>

    <!-- Counters first: they are the campaign's memory, and the thing a table
         checks before anything else. -->
    {#if (template.counters ?? []).length > 0}
      <div class="counters surface">
        {#each template.counters ?? [] as counter (counter.id)}
          {#if evaluate(counter.activeWhen, { state: campaign })}
            <div class="counter">
              <span class="muted">{label(counter.label) || counter.id}</span>
              {#if counter.scope === 'hero'}
                <ul class="per-hero">
                  {#each campaign.heroes as hero (hero.id)}
                    <li>{hero.name}: <strong>{heroCounterOf(campaign, counter.id, hero.id)}</strong></li>
                  {/each}
                </ul>
              {:else}
                <strong class="value">{counterOf(campaign, counter.id)}</strong>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    {/if}

    {#if campaign.finished}
      <div class="surface panel">
        <h3>{campaign.campaignLost ? t.campaignLost : t.campaignComplete}</h3>
        <p class="muted note">{t.campaignSummary(
          campaign.completedScenarios.length,
          campaign.completedScenarios.filter((r) => r.victory).length,
        )}</p>
      </div>
    {:else if campaign.awaitingChoice}
      <div class="surface panel">
        <h3>{t.whatNext}</h3>
        <div class="actions">
          {#each choices as option (option.id)}
            <button type="button" onclick={() => pick(option.id)}>
              {label(option.name) || option.id}
            </button>
          {/each}
        </div>
      </div>
    {:else if recording !== null}
      <div class="surface panel">
        <h3>{recording ? t.won : t.lost}</h3>
        {#if outcome?.message != null}
          <p class="muted note">{label(outcome.message)}</p>
        {/if}

        {#each prompts as prompt (prompt.id)}
          <div class="prompt">
            <p class="ask">{label(prompt.label) || prompt.id}</p>

            {#if prompt.type === 'number'}
              <input
                type="number"
                min={prompt.min ?? 0}
                max={prompt.max ?? undefined}
                value={answers.numbers[prompt.id] ?? 0}
                oninput={(e) => setNumber(prompt.id, Number.parseInt(e.currentTarget.value, 10) || 0)}
              />
            {:else if prompt.type === 'boolean'}
              <label class="yes">
                <input
                  type="checkbox"
                  checked={answers.booleans[prompt.id] === true}
                  onchange={(e) => setBoolean(prompt.id, e.currentTarget.checked)}
                />
                <span>{t.yes}</span>
              </label>
            {:else if prompt.type === 'choice'}
              <select
                value={answers.choices[prompt.id] ?? ''}
                onchange={(e) => setChoice(prompt.id, e.currentTarget.value)}
              >
                <option value="">{t.choose}</option>
                {#each prompt.options ?? [] as option (option.id)}
                  <option value={option.id}>{label(option.label) || option.id}</option>
                {/each}
              </select>
            {:else if prompt.type === 'per_hero_number'}
              {#each campaign.heroes as hero (hero.id)}
                <label class="per-hero-field">
                  <span>{hero.name}</span>
                  <input
                    type="number"
                    min={prompt.min ?? 0}
                    value={answers.perHeroNumbers[prompt.id]?.[hero.id] ?? 0}
                    oninput={(e) =>
                      setHeroNumber(prompt.id, hero.id, Number.parseInt(e.currentTarget.value, 10) || 0)}
                  />
                </label>
              {/each}
            {:else if prompt.type === 'per_hero_boolean'}
              {#each campaign.heroes as hero (hero.id)}
                <label class="yes">
                  <input
                    type="checkbox"
                    checked={answers.perHeroBooleans[prompt.id]?.[hero.id] === true}
                    onchange={(e) => setHeroBoolean(prompt.id, hero.id, e.currentTarget.checked)}
                  />
                  <span>{hero.name}</span>
                </label>
              {/each}
            {:else}
              <!-- A prompt this build cannot ask yet. Named rather than
                   skipped: silently dropping a question changes the campaign,
                   and the table needs to know it was asked something. -->
              <p class="muted note">{t.promptUnsupported(prompt.type)}</p>
            {/if}
          </div>
        {/each}

        <div class="actions">
          <button class="primary" type="button" onclick={save}>{t.saveResult}</button>
          <button type="button" onclick={() => (recording = null)}>{t.cancel}</button>
        </div>
      </div>
    {:else if scenario !== null}
      <div class="surface panel">
        <h3>{label(scenario.name) || scenario.id}</h3>
        {#if scenario.flavour != null}
          <p class="muted note">{label(scenario.flavour)}</p>
        {/if}

        {#each steps as step, i (i)}
          <div class="step">
            {#if step.text != null}
              <p>{label(step.text)}</p>
            {/if}

            {#if (step.cards ?? []).length > 0}
              <ul class="cards">
                {#each step.cards ?? [] as code (code)}
                  <li>{cardName(code)}</li>
                {/each}
              </ul>
            {/if}

            {#if step.showCounter != null}
              <p class="reading"><strong>{counterOf(campaign, step.showCounter)}</strong></p>
            {/if}

            {#if step.showCardList != null}
              <ul class="cards">
                {#each campaign.cardLists[step.showCardList] ?? [] as code (code)}
                  <li>{cardName(code)}</li>
                {/each}
              </ul>
            {/if}

            {#if step.draw != null}
              {#if drawnFor(step.draw.id).length > 0}
                <ul class="cards drawn">
                  {#each drawnFor(step.draw.id) as code (code)}
                    <li>{cardName(code)}</li>
                  {/each}
                </ul>
              {:else}
                <button type="button" onclick={() => drawFor(step)}>{t.drawCard}</button>
              {/if}
            {/if}

            {#if step.action != null}
              {#if takenActions.includes(step.action.id) && step.action.repeatable !== true}
                <p class="muted note">{t.actionTaken}</p>
              {:else}
                <button
                  type="button"
                  disabled={!evaluate(step.action.enabledWhen, { state: campaign, scenarioId: scenario.id })}
                  onclick={() => act(step)}
                >
                  {label(step.action.label)}
                  {#if step.action.cost != null}
                    ({step.action.cost.amount})
                  {/if}
                </button>
              {/if}
            {/if}
          </div>
        {/each}

        <div class="actions">
          <button class="primary" type="button" onclick={() => begin(true)}>{t.won}</button>
          <button type="button" onclick={() => begin(false)}>{t.lost}</button>
        </div>
      </div>

      <CampaignMarket {t} {uiLocale} {run} {template} {campaign} {cardNames} onChanged={reload} />
    {:else}
      <div class="surface panel">
        <h3>{t.campaignBetween}</h3>
        <div class="actions">
          <button class="primary" type="button" onclick={moveOn}>{t.campaignContinue}</button>
        </div>
      </div>
      <CampaignMarket {t} {uiLocale} {run} {template} {campaign} {cardNames} onChanged={reload} />
    {/if}

    {#if !campaign.finished}
      <button class="forget" type="button" onclick={async () => { await concede(run); reload(); }}>
        {t.campaignConcede}
      </button>
    {/if}
  {/if}
</div>

<style>
  .run {
    margin: var(--space-4) 0;
  }

  .back {
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    padding: 0;
    font-weight: 600;
  }

  h2 {
    font-size: 1.3rem;
    margin-top: var(--space-2);
  }

  h3 {
    font-size: 1.05rem;
    margin-bottom: var(--space-2);
  }

  .panel,
  .counters {
    padding: var(--space-4);
    margin: var(--space-4) 0;
  }

  .counters {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: var(--space-3);
  }

  .counter .value {
    display: block;
    font-size: 1.6rem;
    font-variant-numeric: tabular-nums;
  }

  .per-hero {
    list-style: none;
    font-size: 0.9rem;
  }

  .step {
    padding: var(--space-3) 0;
    border-top: 1px solid var(--md-outline-variant);
    max-width: var(--prose-max);
  }

  .step:first-of-type {
    border-top: 0;
  }

  .cards {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-2);
  }

  .cards li {
    border: 1px solid var(--md-outline-variant);
    border-radius: var(--radius-sm);
    padding: 2px var(--space-2);
    font-size: 0.9rem;
  }

  .cards.drawn li {
    border-color: var(--md-primary);
    color: var(--md-primary);
    font-weight: 600;
  }

  .prompt {
    padding: var(--space-3) 0;
    border-top: 1px solid var(--md-outline-variant);
  }

  .ask {
    font-weight: 600;
    margin-bottom: var(--space-2);
  }

  .yes,
  .per-hero-field {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
  }

  .per-hero-field {
    justify-content: space-between;
    max-width: 20rem;
  }

  .reading {
    font-size: 1.4rem;
    font-variant-numeric: tabular-nums;
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

  input,
  select {
    background: var(--md-surface);
    color: var(--md-on-surface);
    border: 1px solid var(--md-outline);
    border-radius: var(--radius-sm);
    padding: var(--space-2);
  }

  .forget {
    display: block;
    margin: var(--space-4) auto 0;
    border: 0;
    background: none;
    color: var(--md-error);
    font-weight: 600;
  }

  .note {
    font-size: 0.85rem;
    max-width: var(--prose-max);
  }
</style>
