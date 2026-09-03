<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale } from '../lib/types';
  import { evaluate } from '../lib/campaign/conditions';
  import { heroDrawId } from '../lib/campaign/engine';
  import { drawnVillainFor, villainStages } from '../lib/campaign/encounter';
  import { parseCampaignText, resolveAmount, type TextContext } from '../lib/campaign/text';
  import {
    amountFor,
    counterOf,
    heroCounterOf,
    textOf,
    type CampaignState,
    type CampaignTemplate,
    type ScenarioTemplate,
    type SetupStep,
  } from '../lib/campaign/types';
  import CampaignText from './CampaignText.svelte';
  import CardRef from './CardRef.svelte';

  interface Props {
    t: Strings;
    uiLocale: Locale;
    template: CampaignTemplate;
    campaign: CampaignState;
    scenario: ScenarioTemplate;
    /** Resolves card codes, template-local ids included. */
    cardName: (code: string) => string;
    setName: (code: string) => string;
    text: TextContext;
    /** The setup printed on the scenario's own main scheme, in the card language. */
    schemeSteps: readonly string[];
    onAction: (actionId: string, heroId: string | null) => void;
    onKeep: (drawId: string, cardCode: string) => void;
    onReady: () => void;
    onNotReady: () => void;
  }

  const {
    t,
    uiLocale,
    template,
    campaign,
    scenario,
    cardName,
    setName,
    text,
    schemeSteps,
    onAction,
    onKeep,
    onReady,
    onNotReady,
  }: Props = $props();

  const label = (value: Parameters<typeof textOf>[0]): string => textOf(value, uiLocale);
  const context = $derived({ state: campaign, scenarioId: scenario.id });
  /** The rate a computed amount is paid at: campaigns state two. */
  const expert = $derived(campaign.difficulty.toLowerCase() === 'expert');

  /**
   * One section's steps, as this run should read them right now.
   *
   * Fragments are already spelled out — `expandTemplate` does that once when
   * the template is read, so the dealer and the engine see the same steps this
   * does. All that is left is the conditions, judged against the campaign as it
   * stands, which is what makes a setup change as the run goes on.
   */
  /**
   * What a step's `{value}` comes to, given the campaign as it stands.
   *
   * Null when the step declares no sum, which is nearly all of them.
   */
  const amountOf = (step: SetupStep): number | null =>
    step.compute == null
      ? null
      : amountFor(step.compute, counterOf(campaign, step.compute.counter), expert);

  const shown = (steps: readonly SetupStep[] | undefined): readonly SetupStep[] =>
    (steps ?? [])
      .filter((step) => evaluate(step.when, context))
      // A step whose amount comes to nothing is not shown at all: the rule that
      // decides whether it applies and the sum that says how much are the same
      // declaration, so "place 0 threat" is a step that does not exist.
      .filter((step) => amountOf(step) !== 0);

  const preSetup = $derived(shown(scenario.preSetup));
  const setup = $derived(shown(scenario.campaignSetup));
  const information = $derived(shown(scenario.information));

  const drawnFor = (drawId: string): readonly string[] =>
    campaign.draws[scenario.id]?.[drawId] ?? [];

  /** The villain deck this scenario fields, once the log has settled who it is. */
  const villainDeck = $derived(
    villainStages(scenario.baseSetup, campaign.difficulty, drawnVillainFor(campaign, scenario.id)),
  );
  const mainScheme = $derived(scenario.baseSetup?.mainScheme ?? []);
  const encounterSets = $derived([
    ...(scenario.baseSetup?.encounterSets ?? []),
    ...(scenario.baseSetup?.modularSets ?? []),
  ]);

  const hasChips = $derived(
    villainDeck.length > 0 || mainScheme.length > 0 || encounterSets.length > 0,
  );

  const isHeroCounter = (id: string): boolean =>
    (template.counters ?? []).find((counter) => counter.id === id)?.scope === 'hero';

  /** A step can exist only to carry a draw; drawing its empty text is a stray bullet. */
  const hasText = (step: SetupStep): boolean => label(step.text) !== '';
</script>

{#snippet drawnCards(drawId: string, offer: number, who: string | null)}
  {@const codes = drawnFor(drawId)}
  {#if codes.length > 0}
    <!-- What came up, and nothing else. Listing the whole pool beside it would
         put the player back to picking one, which is the job just done for
         them. -->
    <div class="drawn">
      {#if who !== null}<span class="who muted">{who}</span>{/if}
      {#if offer > 0 && codes.length > 1}
        <span class="pick">{t.campaignChooseOne}</span>
        <span class="chips">
          {#each codes as code (code)}
            <button type="button" class="chip keep" onclick={() => onKeep(drawId, code)}>
              {cardName(code)}
            </button>
          {/each}
        </span>
      {:else}
        <span class="chips">
          {#each codes as code (code)}
            <span class="chip"><CardRef {code} name={cardName(code)} /></span>
          {/each}
        </span>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet stepBody(step: SetupStep)}
  {@const segments = parseCampaignText(resolveAmount(label(step.text), amountOf(step)), text)}
  {@const named = new Set(segments.filter((s) => s.kind === 'card').map((s) => s.code))}
  <li class="step">
    <p class="line"><CampaignText {segments} /></p>

    <!-- Values the campaign carries forward from earlier scenarios, so the step
         can be followed without leafing back through it. -->
    {#if step.showCounter != null}
      {#if isHeroCounter(step.showCounter)}
        <p class="reading">
          {#each campaign.heroes as hero (hero.id)}
            <span class="tally">{hero.name}
              <strong>{heroCounterOf(campaign, step.showCounter, hero.id)}</strong></span>
          {/each}
        </p>
      {:else}
        <!-- The number alone. Prefixing it with the counter's id put
             "pincerThreat" in front of a player who has no reason to know the
             app calls it that; the step's own text says what it is. -->
        <p class="reading"><strong class="big">{counterOf(campaign, step.showCounter)}</strong></p>
      {/if}
    {/if}

    {#if step.showCardList != null}
      {@const recorded = campaign.cardLists[step.showCardList] ?? []}
      <p class="reading">
        {#if recorded.length === 0}
          <span class="muted">{t.campaignNothingRecorded}</span>
        {:else}
          {#each recorded as code, i (code + i)}
            {#if i > 0}<span>, </span>{/if}<CardRef {code} name={cardName(code)} />
          {/each}
        {/if}
      </p>
    {/if}

    {#if step.showHeroesWith != null}
      {@const holders = campaign.heroes.filter(
        (hero) => heroCounterOf(campaign, step.showHeroesWith ?? '', hero.id) > 0,
      )}
      <p class="reading">
        <strong>{holders.length === 0 ? t.campaignNobody : holders.map((h) => h.name).join(', ')}</strong>
      </p>
    {/if}

    <!-- Only the cards the sentence does not already name. The app repeats them
         as chips because its own prose is not touchable; here it is, and a chip
         under every line saying the same thing again is noise. -->
    {#if (step.cards ?? []).some((code) => !named.has(code))}
      <span class="chips">
        {#each (step.cards ?? []).filter((code) => !named.has(code)) as code (code)}
          <span class="chip"><CardRef {code} name={cardName(code)} /></span>
        {/each}
      </span>
    {/if}

    {#if step.draw != null}
      {#if step.draw.perHero === true}
        <!-- Dealt to each player in turn, so it is shown that way: a table of
             three has three rows and three separate decisions. -->
        {#each campaign.heroes as hero (hero.id)}
          {@render drawnCards(heroDrawId(step.draw.id, hero.id), step.draw.offer ?? 0, hero.name)}
        {/each}
      {:else}
        {@render drawnCards(step.draw.id, step.draw.offer ?? 0, null)}
      {/if}
    {/if}

    {#if step.action != null}
      {@const action = step.action}
      {@const enabled = evaluate(action.enabledWhen, context)}
      {@const taken = (campaign.setupActionsTaken[`${scenario.id}:`] ?? []).includes(action.id)}
      {#if taken && action.repeatable !== true}
        <p class="taken">✓ {t.actionTaken}</p>
      {:else if action.perHero === true}
        <span class="chips">
          {#each campaign.heroes as hero (hero.id)}
            <button type="button" class="act" disabled={!enabled} onclick={() => onAction(action.id, hero.id)}>
              {label(action.label)} — {hero.name}
            </button>
          {/each}
        </span>
      {:else}
        <button type="button" class="act" disabled={!enabled} onclick={() => onAction(action.id, null)}>
          {label(action.label)}{#if action.cost != null}&nbsp;({action.cost.amount}){/if}
        </button>
      {/if}
    {/if}
  </li>
{/snippet}

{#snippet panel(title: string, steps: readonly SetupStep[])}
  {@const shown = steps.filter(hasText)}
  {#if shown.length > 0}
    <section class="panel">
      <h3>{title}</h3>
      <ul class="steps">
        {#each shown as step, i (i)}
          {@render stepBody(step)}
        {/each}
      </ul>
    </section>
  {/if}
{/snippet}

<!-- Four boxes, in the order the table works through them: the story, what to
     fetch, what to lay out, and what to know once it is laid out. -->
{#if scenario.flavour != null && label(scenario.flavour) !== ''}
  <section class="panel story">
    <p><CampaignText segments={parseCampaignText(label(scenario.flavour), text)} /></p>
  </section>
{/if}

{#if hasChips}
  <section class="panel">
    <h3>{t.campaignPreSetup}</h3>
    <dl class="gather">
      {#if villainDeck.length > 0}
        <dt>{t.campaignVillainDeck}</dt>
        <dd>
          <span class="chips">
            {#each villainDeck as code (code)}
              <span class="chip"><CardRef {code} name={cardName(code)} /></span>
            {/each}
          </span>
        </dd>
      {/if}
      {#if mainScheme.length > 0}
        <dt>{t.campaignMainScheme}</dt>
        <dd>
          <span class="chips">
            {#each mainScheme as code (code)}
              <span class="chip"><CardRef {code} name={cardName(code)} /></span>
            {/each}
          </span>
        </dd>
      {/if}
      {#if encounterSets.length > 0}
        <dt>{t.encounterDeck}</dt>
        <dd>{encounterSets.map(setName).join(', ')}</dd>
      {/if}
    </dl>
    {#if preSetup.filter(hasText).length > 0}
      <ul class="steps">
        {#each preSetup.filter(hasText) as step, i (i)}
          {@render stepBody(step)}
        {/each}
      </ul>
    {/if}
  </section>
{:else}
  {@render panel(t.campaignPreSetup, preSetup)}
{/if}

{@render panel(t.campaignSetupLabel, setup)}
{@render panel(t.campaignInformation, information)}

{#if schemeSteps.length > 0}
  <!-- Last, because that is the order it is done in: gather the cards, apply
       whatever the campaign changes, then follow the setup printed on the
       scheme itself. Read off the card rather than written into the template,
       so it arrives in the language the cards are in. -->
  <section class="panel">
    <h3>{t.schemeSetupTitle}</h3>
    <ul class="steps">
      {#each schemeSteps as step, i (i)}
        <li class="step"><p class="line">{step}</p></li>
      {/each}
    </ul>
  </section>
{/if}

<div class="ready">
  <button class="primary big" type="button" onclick={onReady}>{t.campaignImReady}</button>
  <button class="big" type="button" onclick={onNotReady}>{t.campaignNotReady}</button>
</div>

<style>
  .panel {
    margin: var(--space-3) 0;
  }

  h3 {
    font-size: var(--text-lg);
    font-weight: 700;
    margin-bottom: var(--space-3);
  }

  .story p {
    font-style: italic;
    color: var(--text-muted);
    max-width: var(--prose-max);
    margin: 0;
  }

  .gather {
    display: grid;
    gap: var(--space-1);
    margin-bottom: var(--space-2);
  }

  dt {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  dd {
    margin: 0 0 var(--space-3);
  }

  .steps {
    list-style: none;
    padding: 0;
    margin: 0;
    max-width: var(--prose-max);
  }

  /* Spaced and bulleted rather than ruled between: a divider under every line
     turned a briefing into a table, and the steps are prose. */
  .step {
    position: relative;
    padding-inline-start: var(--space-4);
    margin-bottom: var(--space-3);
  }

  .step:last-child {
    margin-bottom: 0;
  }

  .step::before {
    content: '•';
    position: absolute;
    inset-inline-start: 0;
    color: var(--accent);
    font-weight: 700;
  }

  .line {
    margin: 0;
  }

  .reading {
    margin: var(--space-1) 0 0;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }

  .reading .big {
    font-size: var(--text-2xl);
  }

  .tally {
    display: inline-block;
    margin-inline-end: var(--space-3);
  }

  .chips {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
    margin-top: var(--space-1);
  }

  .drawn {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }

  .who {
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .pick {
    font-size: var(--text-sm);
    color: var(--accent);
  }

  .chip.keep {
    border-color: var(--accent);
    color: var(--accent);
  }

  .taken {
    margin: var(--space-1) 0 0;
    color: var(--accent);
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .act {
    margin-top: var(--space-2);
    padding: var(--space-1) var(--space-4);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .act:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .ready {
    display: grid;
    gap: var(--space-2);
    margin: var(--space-5) 0 var(--space-4);
  }

  button.big {
    padding: var(--space-3) var(--space-5);
    font-size: var(--text-lg);
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
</style>
