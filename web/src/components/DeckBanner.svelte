<script lang="ts">
  import type { Strings } from '../lib/i18n';

  interface Props {
    t: Strings;
    /** The hero's card picture, or null while it loads. */
    art: string | null;
    name: string;
    /** Given, the name is an input; absent, it is a heading. */
    onName?: (name: string) => void;
    heroName: string;
    aspects: readonly string[];
    cards: number;
    /** A page's banner rather than an editor's: more room for the art. */
    tall?: boolean;
  }

  const { t, art, name, onName, heroName, aspects, cards, tall = false }: Props = $props();
</script>

<!--
  The deck's banner: the hero's art behind, the name over it, and the facts
  as chips under the name. What the deck sites open with, and what makes
  two decks for two heroes look like two things rather than two rows.
-->
<div class="banner" class:tall>
  {#if art !== null}
    <img class="art" src={art} alt="" />
  {/if}
  <span class="shade" aria-hidden="true"></span>
  <div class="over">
    {#if onName !== undefined}
      <input
        class="name-input"
        type="text"
        aria-label={t.deckName}
        value={name}
        oninput={(e) => onName(e.currentTarget.value)}
      />
    {:else}
      <h2 class="name">{name}</h2>
    {/if}
    <div class="chips">
      <span class="chip chip--dark">{heroName}</span>
      {#each aspects as aspect (aspect)}
        <span class="chip chip--dark" data-faction={aspect}><span class="dot" aria-hidden="true"></span>{t.aspect(aspect)}</span>
      {/each}
      <span class="chip chip--dark">{t.cardCount(cards)}</span>
    </div>
  </div>
</div>

<style>
  .banner {
    position: relative;
    min-height: 9rem;
    margin: 0 calc(var(--space-4) * -1);
    padding: var(--space-4);
    color: #fff;
    background: #2a2224;
    overflow: hidden;
    display: flex;
    align-items: flex-end;
  }

  /* The art, blown up so its frame falls outside and softened so the name
     stays legible over it wherever the face happens to be. */
  .banner.tall {
    min-height: 14rem;
  }

  /* Wider still on a page: the frame and the stat boxes must fall further
     outside, and the face sits a little lower in the band. */
  .banner.tall .art {
    left: -20%;
    top: -34%;
    width: 140%;
    height: 175%;
    object-position: 50% 20%;
  }

  .art {
    position: absolute;
    left: -6%;
    top: -18%;
    width: 112%;
    height: 140%;
    object-fit: cover;
    object-position: 50% 14%;
    filter: saturate(1.05);
  }

  .shade {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(to right, rgb(20 14 16 / 92%) 0%, rgb(20 14 16 / 55%) 45%, rgb(20 14 16 / 25%) 100%),
      linear-gradient(to top, rgb(20 14 16 / 70%) 0%, rgb(20 14 16 / 0%) 60%);
  }

  .over {
    position: relative;
    display: grid;
    gap: var(--space-2);
    width: 100%;
    max-width: 40rem;
  }

  .name,
  .name-input {
    margin: 0;
    font-size: var(--text-2xl, 1.75rem);
    font-weight: var(--weight-bold);
    line-height: 1.15;
    letter-spacing: var(--tracking-tight);
    color: #fff;
    text-shadow: 0 1px 3px rgb(0 0 0 / 60%);
  }

  .name-input {
    width: 100%;
    padding: 0;
    border: 0;
    border-bottom: 1px dashed rgb(255 255 255 / 40%);
    background: none;
    font: inherit;
    font-size: var(--text-2xl, 1.75rem);
    font-weight: var(--weight-bold);
  }

  .name-input:focus {
    outline: none;
    border-bottom-color: #fff;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .chip--dark {
    min-height: 1.75rem;
    padding-block: 0;
    font-size: var(--text-xs);
    color: #fff;
    background: rgb(255 255 255 / 12%);
    border-color: rgb(255 255 255 / 25%);
    backdrop-filter: blur(4px);
  }

  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--faction-basic);
  }

  [data-faction='leadership'] .dot { background: var(--faction-leadership); }
  [data-faction='justice'] .dot { background: var(--faction-justice); }
  [data-faction='aggression'] .dot { background: var(--faction-aggression); }
  [data-faction='protection'] .dot { background: var(--faction-protection); }
  [data-faction='pool'] .dot { background: var(--faction-pool); }
</style>
