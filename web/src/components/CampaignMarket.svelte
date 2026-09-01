<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale } from '../lib/types';
  import type { CampaignRun } from '../lib/records';
  import { canBuy, offersFor } from '../lib/campaign/rules';
  import { heroCounterOf, type CampaignState, type CampaignTemplate } from '../lib/campaign/types';
  import { buy, refund } from '../lib/campaign/store';

  interface Props {
    t: Strings;
    uiLocale: Locale;
    run: CampaignRun;
    template: CampaignTemplate;
    campaign: CampaignState;
    cardNames: ReadonlyMap<string, string>;
    onChanged: () => void;
  }

  const { t, run, template, campaign, cardNames, onChanged }: Props = $props();

  let heroId = $state('');
  const chosen = $derived(heroId === '' ? (campaign.heroes[0]?.id ?? '') : heroId);

  const counterId = $derived(template.market?.counterId ?? 'credits');
  const credits = $derived(chosen === '' ? 0 : heroCounterOf(campaign, counterId, chosen));
  const offers = $derived(chosen === '' ? [] : offersFor(template, campaign, chosen));

  const cardName = (code: string): string => cardNames.get(code) ?? code;

  const boughtBy = (code: string): string | null => {
    const purchase = campaign.purchases.find((entry) => entry.cardCode === code);
    if (purchase === undefined) {
      return null;
    }
    return campaign.heroes.find((hero) => hero.id === purchase.heroId)?.name ?? purchase.heroId;
  };

  async function take(cardCode: string, cost: number, cardListId: string): Promise<void> {
    if (chosen === '') {
      return;
    }
    await buy(run, chosen, cardCode, cost, cardListId);
    onChanged();
  }

  async function giveBack(cardCode: string): Promise<void> {
    const purchase = campaign.purchases.find((entry) => entry.cardCode === cardCode);
    if (purchase === undefined) {
      return;
    }
    await refund(run, purchase.eventId);
    onChanged();
  }
</script>

{#if template.market != null && (template.market.entries ?? []).length > 0}
  <div class="market surface">
    <h3>{t.market}</h3>

    {#if campaign.heroes.length > 1}
      <label class="field">
        <span class="muted">{t.marketFor}</span>
        <select value={chosen} onchange={(e) => (heroId = e.currentTarget.value)}>
          {#each campaign.heroes as hero (hero.id)}
            <option value={hero.id}>{hero.name}</option>
          {/each}
        </select>
      </label>
    {/if}

    <p class="credits">{t.creditsLeft(credits)}</p>

    <ul class="offers">
      {#each offers as offer (offer.entry.cardCode)}
        {@const owner = boughtBy(offer.entry.cardCode)}
        <li class:taken={owner !== null}>
          <span class="name">{cardName(offer.entry.cardCode)}</span>
          <span class="cost muted">{offer.entry.cost}</span>

          {#if owner !== null}
            <!-- One copy per campaign across the whole group, not per hero, so
                 a card somebody else took is closed to everyone and says who
                 has it. -->
            <span class="owner muted">{t.ownedBy(owner)}</span>
            <button type="button" onclick={() => giveBack(offer.entry.cardCode)}>{t.refund}</button>
          {:else}
            <button
              type="button"
              disabled={!canBuy(offer)}
              onclick={() => take(offer.entry.cardCode, offer.entry.cost, offer.entry.cardListId ?? 'purchases')}
            >
              {t.buy}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .market {
    padding: var(--space-4);
    margin: var(--space-4) 0;
  }

  h3 {
    font-size: 1.05rem;
    margin-bottom: var(--space-2);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 18rem;
    margin-bottom: var(--space-3);
  }

  .credits {
    font-weight: 600;
    margin-bottom: var(--space-2);
  }

  .offers {
    list-style: none;
    display: grid;
    gap: var(--space-1);
  }

  .offers li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border-top: 1px solid var(--md-outline-variant);
  }

  .offers li.taken {
    opacity: 0.7;
  }

  .name {
    flex: 1 1 12rem;
  }

  .cost {
    font-variant-numeric: tabular-nums;
  }

  .owner {
    font-size: 0.85rem;
  }

  button {
    padding: var(--space-1) var(--space-3);
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

  select {
    background: var(--md-surface);
    color: var(--md-on-surface);
    border: 1px solid var(--md-outline);
    border-radius: var(--radius-sm);
    padding: var(--space-2);
  }
</style>
