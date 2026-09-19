<script lang="ts">
  import type { Locale } from '../lib/types';
  import type { Strings } from '../lib/i18n';
  import {
    identify,
    ruleBody,
    ruleLines,
    ruleTerm,
    searchRules,
    type IdentifiedRule,
    type RulesFile,
  } from '../lib/rules';

  interface Props {
    t: Strings;
    /** The rules follow the card language, since that is the game's language. */
    cardLocale: Locale;
  }

  const { t, cardLocale }: Props = $props();

  let file = $state.raw<RulesFile | null>(null);
  let entries = $state.raw<readonly IdentifiedRule[]>([]);
  let loadFailed = $state(false);
  let query = $state('');
  let openTerm = $state<string | null>(null);

  /**
   * Loaded when the page opens, not with the rest of the site.
   *
   * It is 418 KB of glossary — worth having in full and offline, not worth
   * handing to somebody who only came to look up a card.
   */
  $effect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}data/rules-reference.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((loaded: RulesFile) => {
        if (!cancelled) {
          file = loaded;
          entries = identify(loaded.entries);
        }
      })
      .catch(() => {
        if (!cancelled) {
          loadFailed = true;
        }
      });
    return () => {
      cancelled = true;
    };
  });

  const results = $derived(searchRules(entries, query, cardLocale));
</script>

<section>
  <h1 class="comic-title">{t.rulesTitle}</h1>

  {#if loadFailed}
    <div class="notice surface"><p>{t.rulesLoadError}</p></div>
  {:else if file === null}
    <p class="notice muted">{t.rulesLoading}</p>
  {:else}
    <p class="credit">
      {t.rulesCreditBefore}
      <a href={file.source} target="_blank" rel="noopener">{file.sourceCredit}</a>
      {t.rulesCreditAfter(file.sourceLicence)}
    </p>

    <label class="search">
      <span class="visually-hidden">{t.rulesSearchHint}</span>
      <input
        type="search"
        placeholder={t.rulesSearchHint}
        value={query}
        autocomplete="off"
        spellcheck="false"
        oninput={(e) => (query = e.currentTarget.value)}
      />
    </label>

    <p class="count muted" aria-live="polite">
      {t.rulesCount(results.length, entries.length)}
    </p>

    {#if results.length === 0}
      <div class="notice surface"><p>{t.rulesNoResults}</p></div>
    {:else}
      <ul class="entries">
        {#each results as entry (entry.id)}
          {@const open = openTerm === entry.id}
          <li class="surface entry" class:open>
            <button
              type="button"
              class="term"
              aria-expanded={open}
              onclick={() => (openTerm = open ? null : entry.id)}
            >
              <span>{ruleTerm(entry, cardLocale)}</span>
              <span class="chevron" aria-hidden="true">{open ? '−' : '+'}</span>
            </button>

            {#if open}
              <div class="body">
                {#each ruleLines(ruleBody(entry, cardLocale)) as line, i (i)}
                  <p class="line" data-depth={line.depth}>{line.text}</p>
                {/each}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  h1 {
    font-size: var(--text-2xl);
    margin: var(--space-5) 0 var(--space-3);
  }

  .notice {
    padding: var(--space-4);
    margin: var(--space-3) 0;
    max-width: var(--prose-max);
  }

  .search input {
    width: 100%;
    max-width: 40rem;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--surface-1);
    color: var(--text);
    font-size: var(--text-lg);
  }

  .count {
    font-size: var(--text-sm);
    margin: var(--space-3) 0;
  }

  .entries {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-2);
  }

  .entry {
    padding: 0;
    overflow: hidden;
  }

  .entry.open {
    border-color: var(--accent);
  }

  .term {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    width: 100%;
    border: 0;
    background: none;
    color: inherit;
    text-align: start;
    padding: var(--space-3) var(--space-4);
    cursor: pointer;
    font-weight: 600;
    font-size: var(--text-base);
  }

  .term:hover {
    background: var(--surface-2);
  }

  .chevron {
    color: var(--text-muted);
    font-size: var(--text-lg);
    line-height: 1;
  }

  .body {
    padding: 0 var(--space-4) var(--space-4);
    max-width: 52rem;
  }

  .line {
    margin: 0 0 var(--space-2);
    line-height: 1.55;
  }

  /*
   * The indent is the meaning. A point about a point is an exception or a
   * clarification, and flattening the two would change what the rule says.
   */
  .line[data-depth='1'] {
    padding-inline-start: var(--space-4);
    border-inline-start: 2px solid var(--hairline);
  }

  .line[data-depth='2'] {
    padding-inline-start: var(--space-6);
    border-inline-start: 2px solid var(--text);
    color: var(--text-muted);
    font-size: var(--text-base);
  }

  /*
   * Above the search rather than under the last entry. The glossary is 247
   * entries long, so a credit at the bottom is a credit nobody reaches, and
   * this text is somebody else's work given away for free.
   */
  .credit {
    margin: 0 0 var(--space-4);
    padding-inline-start: var(--space-3);
    border-inline-start: 3px solid var(--text);
    font-size: var(--text-sm);
    max-width: var(--prose-max);
  }

  .credit a {
    font-weight: 600;
  }
</style>
