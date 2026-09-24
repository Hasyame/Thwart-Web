<script lang="ts" module>
  /*
   * The banner's entrance plays once per visit to the site, not every time
   * somebody comes back to the home page: the first time it is a welcome,
   * the fifth time it is in the way.
   */
  let bannerPlayed = false;
</script>

<script lang="ts">
  import type { Strings } from '../lib/i18n';
  import type { IndexRow, Locale, Pack } from '../lib/types';
  import type { Route } from '../lib/router';
  import { CHANGELOG, changelogLines } from '../lib/changelog';
  import { session } from '../lib/sync/session.svelte';
  import AchievementsStrip from './AchievementsStrip.svelte';
  import InstallGuide from './InstallGuide.svelte';

  /**
   * The front door.
   *
   * What is new since the last visit, where everything is, and — for
   * somebody not signed in — why an account is worth having. Every
   * destination is a real link with a real address, so a crawler that never
   * runs the script still finds the whole site from here, and so does a
   * reader with a middle mouse button. index.html carries the same words
   * and links in the document itself, for the crawler's first pass; keep
   * the two in step by hand.
   */

  interface Props {
    t: Strings;
    uiLocale: Locale;
    index: readonly IndexRow[];
    packs: readonly Pack[];
    hrefFor: (route: Route) => string;
    onNavigate: (route: Route) => void;
  }

  const { t, uiLocale, index, packs, hrefFor, onNavigate }: Props = $props();

  const PATREON = 'https://www.patreon.com/cw/thwart';
  const ANDROID = 'https://github.com/Hasyame/Thwart/releases/latest';

  /*
   * One card at random, chosen when the page opens and kept while it is
   * open: a link whose destination changed under the pointer would be a
   * surprise, and reopening the page draws again.
   */
  const randomCard = $derived.by((): Route | null => {
    const candidates = index.filter((row) => row.img !== undefined || row.typeCode !== 'hero');
    const row = candidates[Math.floor(Math.random() * candidates.length)];
    return row === undefined ? null : { name: 'card', code: row.code };
  });

  interface Tile {
    readonly route: Route;
    readonly title: string;
    readonly detail: string;
    readonly glyph: string;
    /** Smaller doors inside the tile: the ways of playing, under Play. */
    readonly inside?: readonly { readonly route: Route; readonly title: string }[];
  }

  const tiles = $derived.by((): Tile[] => [
    { route: { name: 'search' }, title: t.navCards, detail: t.home.cardsDetail, glyph: '▤' },
    { route: { name: 'rules' }, title: t.navRules, detail: t.home.rulesDetail, glyph: '❔' },
    { route: { name: 'collection' }, title: t.navCollection, detail: t.home.collectionDetail, glyph: '▣' },
    {
      route: { name: 'hub' },
      title: t.navPlayShort,
      detail: t.home.playDetail,
      glyph: '▶',
      inside: [
        { route: { name: 'campaigns' }, title: t.navCampaigns },
        { route: { name: 'play' }, title: t.navPlay },
        { route: { name: 'randomizer' }, title: t.navRandomizer },
        { route: { name: 'draft' }, title: t.navDraft },
      ],
    },
    ...(randomCard === null
      ? []
      : [{ route: randomCard, title: t.home.randomCard, detail: t.home.randomCardDetail, glyph: '✦' }]),
    { route: { name: 'history' }, title: t.navHistory, detail: t.home.historyDetail, glyph: '⏱' },
    { route: { name: 'stats' }, title: t.navStats, detail: t.home.statsDetail, glyph: '▥' },
  ]);

  function go(event: MouseEvent, route: Route): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    onNavigate(route);
  }

  const latest = $derived(CHANGELOG[0] ?? null);
  const earlier = $derived(CHANGELOG.slice(1));

  const slam = !bannerPlayed;
  bannerPlayed = true;

  const dayOf = (iso: string): string =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(uiLocale, { year: 'numeric', month: 'long', day: 'numeric' });
</script>

<section class="home">
  <header class="hero">
    <h1 class="comic-title banner" class:slam>{t.home.title}</h1>
    <p class="lead">{t.home.lead}</p>
  </header>
  <InstallGuide {t} />

  {#if session.status === 'signed-in' && session.account !== null}
    <!-- Signed in: a greeting, and nothing to sell. -->
    <p class="surface ready">
      <span class="glyph" aria-hidden="true">✓</span>
      <span>{t.home.readyToPlay(session.account.handle)}</span>
    </p>
  {:else if session.status === 'signed-out'}
    <!-- Not signed in: what an account is for, said once and plainly. The
         site works without one, and the text says that too, so this is an
         offer and not a gate. -->
    <div class="surface account">
      <div class="words">
        <h2>{t.home.accountTitle}</h2>
        <p>{t.home.accountBody}</p>
        <p class="muted small">{t.home.accountNote}</p>
      </div>
      <a class="btn btn--primary" href={hrefFor({ name: 'account' })} onclick={(e) => go(e, { name: 'account' })}>
        {t.home.signIn}
      </a>
    </div>
  {/if}

  <!-- The achievements at a glance, the way a store shows them. -->
  <AchievementsStrip {t} {uiLocale} {index} {packs} {hrefFor} {onNavigate} />

  <h2 class="section-title">{t.home.whereTo}</h2>
  <ul class="tiles">
    {#each tiles as tile (tile.title)}
      <li>
        <a class="surface tile" href={hrefFor(tile.route)} onclick={(e) => go(e, tile.route)}>
          <span class="glyph" aria-hidden="true">{tile.glyph}</span>
          <span class="words">
            <span class="title">{tile.title}</span>
            <span class="detail">{tile.detail}</span>
          </span>
        </a>
        {#if tile.inside !== undefined}
          <ul class="inside">
            {#each tile.inside as door (door.title)}
              <li><a href={hrefFor(door.route)} onclick={(e) => go(e, door.route)}>{door.title}</a></li>
            {/each}
          </ul>
        {/if}
      </li>
    {/each}
  </ul>

  <h2 class="section-title">{t.home.elsewhere}</h2>
  <ul class="tiles elsewhere">
    <li>
      <a class="surface tile" href={PATREON} target="_blank" rel="noopener">
        <span class="glyph" aria-hidden="true">♥</span>
        <span class="words">
          <span class="title">{t.home.patreon}</span>
          <span class="detail">{t.home.patreonDetail}</span>
        </span>
      </a>
    </li>
    <li>
      <a class="surface tile" href={ANDROID} target="_blank" rel="noopener">
        <span class="glyph" aria-hidden="true">▣</span>
        <span class="words">
          <span class="title">{t.home.android}</span>
          <span class="detail">{t.home.androidDetail}</span>
        </span>
      </a>
    </li>
  </ul>

  {#if latest !== null}
    <section class="surface news">
      <h2>{t.home.whatsNew} <span class="muted date">{dayOf(latest.date)}</span></h2>
      <ul>
        {#each changelogLines(latest, uiLocale) as line (line)}
          <li>{line}</li>
        {/each}
      </ul>
      {#if earlier.length > 0}
        <details>
          <summary>{t.home.earlier}</summary>
          {#each earlier as entry (entry.date)}
            <h3>{dayOf(entry.date)}</h3>
            <ul>
              {#each changelogLines(entry, uiLocale) as line (line)}
                <li>{line}</li>
              {/each}
            </ul>
          {/each}
        </details>
      {/if}
    </section>
  {/if}

  <p class="muted small credit">{t.homeIntroNote}</p>
</section>

<style>
  .home {
    padding-top: var(--space-5);
  }

  .hero {
    max-width: var(--prose-max);
    margin-bottom: var(--space-4);
  }

  /*
   * The banner, as a comic panel lands: it slams in from the left, skewed,
   * overshoots and settles, then a glint crosses the red the way it crosses
   * the Marvel Studios logo. Ben-Day dots, the printed comic's halftone, fade
   * across it. The dots stay for everybody; the movement is off for anybody
   * whose device asks for reduced motion.
   */
  .banner {
    position: relative;
    isolation: isolate;
  }

  .banner::before,
  .banner::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .banner::before {
    background-image: radial-gradient(rgb(255 255 255 / 22%) 1.1px, transparent 1.5px);
    background-size: 7px 7px;
    mask-image: linear-gradient(100deg, transparent 35%, black 100%);
  }

  .banner::after {
    background: linear-gradient(105deg, transparent 42%, rgb(255 255 255 / 55%) 50%, transparent 58%) no-repeat;
    background-size: 250% 100%;
    background-position: 160% 0;
  }

  .banner.slam {
    animation: banner-slam 0.75s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
  }

  .banner.slam::after {
    animation: banner-glint 0.9s ease-in-out 0.65s both;
  }

  .banner:hover::after {
    animation: banner-glint-again 0.9s ease-in-out both;
  }

  @keyframes banner-slam {
    0% { transform: translateX(-45%) skewX(-18deg) scale(1.12); opacity: 0; }
    55% { transform: translateX(2%) skewX(-6deg) scale(1.03); opacity: 1; }
    75% { transform: translateX(-0.6%) skewX(3deg) scale(0.99); }
    100% { transform: none; opacity: 1; }
  }

  @keyframes banner-glint {
    from { background-position: 160% 0; }
    to { background-position: -60% 0; }
  }

  /* The same sweep under another name, so hovering can play it again. */
  @keyframes banner-glint-again {
    from { background-position: 160% 0; }
    to { background-position: -60% 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .banner.slam,
    .banner.slam::after,
    .banner:hover::after {
      animation: none;
    }
  }

  h1 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-2xl);
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-tight);
  }

  .lead {
    margin: 0;
    font-size: var(--text-base);
    color: var(--text-muted);
  }

  .section-title {
    margin: var(--space-5) 0 var(--space-3);
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
  }

  /* The greeting and the account offer share one shape: a card with a glyph. */
  .ready {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: 0;
    padding: var(--space-3) var(--space-4);
    font-weight: var(--weight-semibold);
  }

  .ready .glyph {
    color: var(--accent);
    font-size: var(--text-xl);
  }

  .account {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3) var(--space-4);
    padding: var(--space-4);
  }

  .account .words {
    flex: 1 1 22rem;
    min-width: 0;
  }

  .account h2 {
    margin: 0 0 var(--space-1);
    font-size: var(--text-lg);
  }

  .account p {
    margin: 0 0 var(--space-1);
  }

  .tiles {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  @media (min-width: 48rem) {
    .tiles {
      grid-template-columns: 1fr 1fr;
    }
  }

  @media (min-width: 72rem) {
    .tiles:not(.elsewhere) {
      grid-template-columns: 1fr 1fr 1fr;
    }
  }

  .tile {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    min-height: var(--tap-min);
    padding: var(--space-4);
    color: inherit;
    text-decoration: none;
  }

  .tile:hover {
    border-color: var(--accent);
  }

  .tile .glyph {
    flex: none;
    font-size: var(--text-xl);
    line-height: 1.1;
    color: var(--accent);
  }

  .tile .words {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }

  .tile .title {
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
  }

  .tile .detail {
    color: var(--text-muted);
  }

  /* The ways of playing, as a row of links under the Play tile. */
  .inside {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
    margin: var(--space-2) 0 0;
    padding: 0 var(--space-2);
    list-style: none;
  }

  .inside a {
    font-weight: var(--weight-semibold);
  }

  .news {
    margin-top: var(--space-5);
    padding: var(--space-4);
  }

  .news h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-lg);
  }

  .news h3 {
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--text-base);
  }

  .news .date {
    font-size: var(--text-sm);
    font-weight: var(--weight-normal);
  }

  .news ul {
    margin: 0;
    padding-left: 1.2em;
  }

  .news li {
    margin-bottom: var(--space-1);
  }

  .news details {
    margin-top: var(--space-3);
  }

  .news summary {
    cursor: pointer;
    color: var(--accent);
    font-weight: var(--weight-semibold);
  }

  .small {
    font-size: var(--text-sm);
  }

  .credit {
    max-width: var(--prose-max);
    margin: var(--space-5) 0 0;
  }
</style>
