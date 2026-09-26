<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale } from '../lib/types';
  import { evaluate } from '../lib/campaign/conditions';
  import { heroDrawId } from '../lib/campaign/engine';
  import { drawnVillainFor, encounterSetsOf, villainStages, scenarioDifficulty, scenarioSet } from '../lib/campaign/encounter';
  import { parseCampaignText, resolveAmount, type TextContext } from '../lib/campaign/text';
  import {
    amountFor,
    amountInputOf,
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
  import { openingAllies } from '../lib/campaign/openingAlly';
  import type { IndexRow } from '../lib/types';
  import type { SavedDeck } from '../lib/records';

  interface Props {
    runKey: string;
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
    onDifficulty: (expert: boolean) => void;
    index: readonly IndexRow[];
    decks: readonly SavedDeck[];
    standardSet: string;
    expertSet: string;
    onSet: (kind: 'standard' | 'expert', value: number) => void;
    heroStats: Readonly<Record<string, {printedHealth: number | null}>>;
  }

  const {
    runKey,
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
    onDifficulty,
    index,
    decks,
    standardSet,
    expertSet,
    onSet,
    heroStats,
  }: Props = $props();

  const label = (value: Parameters<typeof textOf>[0]): string => textOf(value, uiLocale);
  const context = $derived({ state: campaign, scenarioId: scenario.id });
  /** The rate a computed amount is paid at: campaigns state two. */
  const expert = $derived(campaign.difficulty.toLowerCase() === 'expert');
  const rejoinRequired = $derived(template.id === 'aoa' && expert && campaign.completedScenarios.some(r => r.victory) && campaign.heroes.some(h => heroCounterOf(campaign, 'hp', h.id) <= 0));

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
      : amountFor(step.compute, amountInputOf(campaign, step.compute), expert);

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
    villainStages(scenario.baseSetup, scenarioDifficulty(campaign, scenario.id), drawnVillainFor(campaign, scenario.id)),
  );
  const mainScheme = $derived(scenario.baseSetup?.mainScheme ?? []);
  const encounterSets = $derived(encounterSetsOf(scenario, campaign, standardSet, expertSet));

  const hasChips = $derived(
    villainDeck.length > 0 || mainScheme.length > 0 || encounterSets.length > 0,
  );

  const isHeroCounter = (id: string): boolean =>
    (template.counters ?? []).find((counter) => counter.id === id)?.scope === 'hero';

  /** A step can exist only to carry a draw; drawing its empty text is a stray bullet. */
  const hasText = (step: SetupStep): boolean => label(step.text) !== '';
  const guided = $derived(template.id === 'aoa');
  const guideKey = $derived(`thwart.campaign-guide.${runKey}.${scenario.id}.${campaign.completedScenarios.length}`);
  let guideStep = $state(0);
  const guideTitles = $derived([t.campaignGuideStory, t.campaignGuideHeroes, t.campaignGuideGather, t.campaignGuideScenario, t.campaignGuideCampaign, t.campaignGuideReady]);
  $effect(() => { const key = guideKey; try { const saved = Number(localStorage.getItem(key)); guideStep = Number.isInteger(saved) && saved >= 0 && saved < 6 ? saved : 0; } catch { guideStep = 0; } });
  function moveGuide(step: number): void { guideStep = step; try { localStorage.setItem(guideKey, String(step)); } catch { /* Preparation navigation remains usable without storage. */ } }
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
      {#each campaign.heroes.filter(hero => (campaign.heroCardLists[step.showCardList ?? '']?.[hero.id] ?? []).length > 0) as hero (hero.id)}
        <p class="reading"><strong>{hero.name}: </strong>
          {#each campaign.heroCardLists[step.showCardList]?.[hero.id] ?? [] as code (code)}
            <CardRef {code} name={cardName(code)} />
          {/each}
        </p>
      {/each}
      {@const recorded = campaign.cardLists[step.showCardList] ?? []}
      <p class="reading">
        {#if recorded.length === 0 && Object.keys(campaign.heroCardLists[step.showCardList] ?? {}).length === 0}
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
            {@const heroTaken = (campaign.setupActionsTaken[`${scenario.id}:${hero.id}`] ?? []).includes(action.id)}
            {@const missingHealth = action.effects?.some(e => e.valueFrom === 'heroCard.health') && !(heroStats[hero.id]?.printedHealth ?? 0)}
            <button type="button" class="act" disabled={!enabled || missingHealth || (heroTaken && action.repeatable !== true)} onclick={() => onAction(action.id, hero.id)}>
              {label(action.label)}: {hero.name}{heroTaken ? ' ✓' : ''}
            </button>
            {#if missingHealth}<span>{t.campaignHealthUnavailable}</span>{/if}
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

{#if guided}
  <nav class="guide-nav" aria-label={t.campaignGuideTitle}>
    <h2>{t.campaignGuideTitle}</h2>
    <label class="field-group"><span>{guideStep + 1} / {guideTitles.length}</span><select class="field" value={guideStep} onchange={e => moveGuide(Number(e.currentTarget.value))}>{#each guideTitles as title, i}<option value={i}>{i + 1}. {title}</option>{/each}</select></label>
    <progress max={guideTitles.length} value={guideStep + 1} aria-label={t.campaignGuideTitle}></progress>
  </nav>
{/if}
<div hidden={guided && guideStep !== 0}>
<!-- Four boxes, in the order the table works through them: the story, what to
     fetch, what to lay out, and what to know once it is laid out. -->
{#if scenario.flavour != null && label(scenario.flavour) !== ''}
  <section class="panel story">
    <p><CampaignText segments={parseCampaignText(label(scenario.flavour), text)} /></p>
  </section>
{/if}

</div>
{#if guided && guideStep === 1}<section class="panel"><h3>{t.campaignGuideHeroes}</h3><p>{t.campaignGuideHeroesText}</p></section>{/if}
<div hidden={guided && guideStep !== 2}>
{#if hasChips}
  <section class="panel">
    <label class="field-group">
      <span>{t.scenarioDifficulty}</span>
      <select class="field" value={scenarioDifficulty(campaign, scenario.id)} onchange={e => onDifficulty(e.currentTarget.value === 'expert')}>
        <option value="standard">Standard</option>
        <option value="expert">Expert</option>
      </select>
    </label>
    {#each ['standard', 'expert'] as kind}
      {#if kind === 'standard' || scenarioDifficulty(campaign, scenario.id) === 'expert'}
        <label class="field-group"><span>{kind === 'standard' ? 'Standard' : 'Expert'}</span>
          <select class="field" value={scenarioSet(campaign, scenario.id, kind === 'standard' ? 'standard' : 'expert', kind === 'standard' ? standardSet : expertSet)} onchange={e => onSet(kind === 'standard' ? 'standard' : 'expert', ['i','ii','iii'].indexOf(e.currentTarget.value.split('_')[1] ?? 'i') + 1)}>
            {#each (kind === 'standard' ? ['i','ii','iii'] : ['i','ii']) as numeral}<option value={`${kind}_${numeral}`}>{t.difficulty(`${kind}_${numeral}`.toUpperCase())}</option>{/each}
          </select>
        </label>
      {/if}
    {/each}
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

</div><div hidden={guided && guideStep !== 3}>
{#if guided}<p>{t.campaignGuideScenarioText}</p>{/if}
{#if schemeSteps.length > 0}
  <!-- Rules Reference 1.8: scenario setup precedes campaign setup. -->
  <section class="panel">
    <h3>{t.schemeSetupTitle}</h3>
    <ul class="steps">
      {#each schemeSteps as step, i (i)}
        <li class="step"><p class="line">{step}</p></li>
      {/each}
    </ul>
  </section>
{/if}

</div><div hidden={guided && guideStep !== 4}>
{@render panel(t.campaignSetupLabel, setup)}
{@render panel(t.campaignInformation, information)}

{#each (template.cardLists ?? []).filter(list => list.recoveryFlag) as list (list.id)}
  {#each campaign.heroes.filter(hero => !(campaign.heroCardLists[list.id]?.[hero.id] ?? []).length && Object.entries(campaign.flags[list.recoveryFlag ?? ''] ?? {}).some(([scenario,won]) => won && !(campaign.eliminatedInScenario[scenario] ?? []).includes(hero.id))) as hero (hero.id)}
    <section class="panel">
      <h3>{hero.name} · {t.campaignRecoverReward}</h3>
      <p>{t.campaignRecoverRewardHint}</p>
      <select class="field" aria-label={`${hero.name}: ${t.campaignRecoverReward}`} onchange={event => { if (event.currentTarget.value) onKeep(`${list.id}|${hero.id}`, event.currentTarget.value); }}>
        <option value="">{t.campaignChooseOne}</option>
        {#each index.filter(card => list.recoveryCards?.includes(card.code) || (list.recoveryCardType && card.typeCode === list.recoveryCardType && ['aggression','justice','leadership','protection','basic','pool'].includes(card.factionCode))) as card (card.code)}
          <option value={card.code}>{card.name}</option>
        {/each}
      </select>
    </section>
  {/each}
{/each}

{#if template.id === 'aoa'}
  <section class="panel">
    <h3>{t.campaignOpeningAlly}</h3>
    <p>{t.campaignOpeningAllyHint}</p>
    {#each campaign.heroes as hero (hero.id)}
      {@const eligible = openingAllies(hero, decks, index, expert)}
      {@const selected = campaign.draws[scenario.id]?.[`openingAlly|${hero.id}`]?.[0] ?? ''}
      <label class="field-group"><span>{hero.name}</span>
        <select class="field" value={selected} onchange={e => onKeep(`openingAlly|${hero.id}`, e.currentTarget.value)}>
          <option value="">{t.campaignChooseOne}</option>
          {#each eligible as card (card.code)}<option value={card.code}>{card.name}</option>{/each}
        </select>
      </label>
      {#if selected !== ''}<CardRef code={selected} name={cardName(selected)} />{/if}
      {#if eligible.length === 0}<p class="muted">{t.campaignOpeningAllyFallback}</p>{/if}
    {/each}
  </section>
{/if}

</div><div hidden={guided && guideStep !== 5}>
{#if guided}<section class="panel"><h3>{t.campaignGuideReady}</h3><p>{t.campaignGuideHandText}</p></section>{/if}
<!-- The way into the scenario, as the last panel of the page: a comic
     frame to tap, and the quieter way back beneath it. -->
<div class="ready">
  {#if rejoinRequired}<p>{t.campaignRejoinRequired}</p>{/if}
  <button class="launch" type="button" disabled={rejoinRequired} onclick={onReady}>
    <span class="launch-title">{t.campaignImReady}</span>
    <span class="launch-detail">{t.campaignReadyDetail}</span>
  </button>
  <button class="big" type="button" onclick={onNotReady}>{t.campaignNotReady}</button>
</div>

</div>
{#if guided}<div class="guide-actions"><button class="btn" disabled={guideStep === 0} onclick={() => moveGuide(guideStep - 1)}>{t.campaignGuidePrevious}</button>{#if guideStep < 5}<button class="btn btn--primary" onclick={() => moveGuide(guideStep + 1)}>{t.campaignGuideNext}</button>{/if}</div>{/if}
<style>
  [hidden] { display: none !important; }
  .guide-nav { padding: var(--space-4); border-left: 5px solid var(--accent); background: var(--surface); }
  .guide-nav h2 { font-weight: 900; font-style: italic; text-transform: uppercase; }
  .guide-nav progress { width: 100%; accent-color: var(--accent); }
  .guide-actions { display: flex; justify-content: space-between; gap: var(--space-4); margin-top: var(--space-5); padding-block: var(--space-4); }
  .guide-actions button { min-height: 48px; }

  /*
   * A guide to read down, not a stack of boxes: after ArkhamCards' scenario
   * guide, at the owner's request. The story in italics on a red rule, each
   * part under a red comic heading, the steps marked with a diamond, and the
   * way into the scenario as a comic panel at the foot.
   */
  .panel {
    margin: var(--space-5) 0 0;
    padding: 0;
    background: none;
    border: 0;
    box-shadow: none;
    border-radius: 0;
  }

  h3 {
    margin: 0 0 var(--space-3);
    color: var(--accent);
    font-size: var(--text-xl);
    font-weight: 900;
    font-style: italic;
    text-transform: uppercase;
    letter-spacing: -0.01em;
  }

  .story {
    padding-inline-start: var(--space-4);
    border-inline-start: 4px solid var(--accent);
  }

  .story p {
    font-style: italic;
    font-size: var(--text-lg);
    line-height: var(--leading-body);
    color: var(--text);
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

  /* A small red diamond, where a printed guide puts its step mark. */
  .step::before {
    content: '';
    position: absolute;
    inset-inline-start: 0.1em;
    top: 0.5em;
    width: 0.55em;
    height: 0.55em;
    background: var(--accent);
    transform: rotate(45deg);
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
    gap: var(--space-3);
    margin: var(--space-6) 0 var(--space-4);
  }

  /* The comic panel: a heavy frame with an offset shadow, halftone dots. */
  .launch {
    display: grid;
    gap: var(--space-1);
    justify-items: center;
    padding: var(--space-5) var(--space-4);
    border: 3px solid var(--text);
    border-radius: var(--radius-sm);
    background:
      radial-gradient(rgb(255 255 255 / 18%) 1.1px, transparent 1.5px) 0 0 / 7px 7px,
      var(--accent);
    color: var(--accent-ink);
    box-shadow: 6px 6px 0 var(--text);
    font: inherit;
    cursor: pointer;
    text-align: center;
    transition: transform var(--motion-fast) var(--ease-out), box-shadow var(--motion-fast) var(--ease-out);
  }

  .launch:hover {
    transform: translate(-2px, -2px);
    box-shadow: 8px 8px 0 var(--text);
  }

  .launch:active {
    transform: translate(3px, 3px);
    box-shadow: 3px 3px 0 var(--text);
  }

  @media (prefers-reduced-motion: reduce) {
    .launch {
      transition: none;
    }
  }

  .launch-title {
    font-size: var(--text-2xl);
    font-weight: 900;
    font-style: italic;
    text-transform: uppercase;
    letter-spacing: -0.02em;
  }

  .launch-detail {
    font-size: var(--text-sm);
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
</style>
