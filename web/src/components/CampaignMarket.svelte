<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { Locale } from '../lib/types';
  import type { CampaignRun } from '../lib/records';
  import { canBuy, offersFor } from '../lib/campaign/rules';
  import { heroCounterOf, type CampaignState, type CampaignTemplate } from '../lib/campaign/types';
  import { buy, refund } from '../lib/campaign/store';
  import CardRef from './CardRef.svelte';

  interface Props {
    t: Strings;
    uiLocale: Locale;
    run: CampaignRun;
    template: CampaignTemplate;
    campaign: CampaignState;
    cardName: (code: string) => string;
    onChanged: () => void;
  }

  const { t, run, template, campaign, cardName, onChanged }: Props = $props();

  let heroId = $state('');
  const chosen = $derived(heroId === '' ? (campaign.heroes[0]?.id ?? '') : heroId);

  const counterId = $derived(template.market?.counterId ?? 'credits');
  const credits = $derived(chosen === '' ? 0 : heroCounterOf(campaign, counterId, chosen));
  const offers = $derived(chosen === '' ? [] : offersFor(template, campaign, chosen));

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
  <section class="market surface">
    <div class="head">
      <h3>{t.market}</h3>
      <p class="credits">{t.creditsLeft(credits)}</p>
    </div>

    {#if campaign.heroes.length > 1}
      <label class="field-group">
        <span class="field-label">{t.campaignWhoIsBuying}</span>
        <select class="field" value={chosen} onchange={(e) => (heroId = e.currentTarget.value)}>
          {#each campaign.heroes as hero (hero.id)}
            <option value={hero.id}>{hero.name}</option>
          {/each}
        </select>
      </label>
    {/if}

    <ul class="offers">
      {#each offers as offer (offer.entry.cardCode)}
        {@const owner = boughtBy(offer.entry.cardCode)}
        <li class:taken={owner !== null}>
          <span class="name"><CardRef code={offer.entry.cardCode} name={cardName(offer.entry.cardCode)} /></span>
          <span class="cost">{offer.entry.cost}</span>

          {#if owner !== null}
            <!-- One copy per campaign across the whole group, not per hero, so
                 a card somebody else took is closed to everyone and says who
                 has it. -->
            <span class="owner muted">{t.ownedBy(owner)}</span>
            <button class="btn" type="button" onclick={() => giveBack(offer.entry.cardCode)}>{t.refund}</button>
          {:else}
            <button
              class="btn buy"
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
  </section>
{/if}

<style>
  .market {
    padding: var(--space-4) var(--space-5);
    margin: var(--space-3) 0;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }

  h3 {
    font-size: var(--text-lg);
    font-weight: 700;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    max-width: 18rem;
    margin: var(--space-3) 0;
  }

  .credits {
    font-weight: 700;
    color: var(--accent);
    margin: 0;
  }

  .offers {
    list-style: none;
    padding: 0;
    margin: var(--space-2) 0 0;
    display: grid;
    gap: var(--space-1);
  }

  .offers li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-top: 1px solid var(--hairline);
  }

  .offers li.taken {
    opacity: 0.65;
  }

  .name {
    flex: 1 1 12rem;
  }

  .cost {
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    min-width: 1.5rem;
    text-align: end;
  }

  .owner {
    font-size: var(--text-sm);
  }

  button.buy:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }

</style>
