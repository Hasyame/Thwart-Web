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
  <h1>{t.rulesTitle}</h1>

  {#if loadFailed}
    <div class="notice surface"><p>{t.rulesLoadError}</p></div>
  {:else if file === null}
    <p class="notice muted">{t.rulesLoading}</p>
  {:else}
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

    <p class="muted credit">
      {t.rulesCredit(file.sourceCredit, file.sourceLicence)}
      <a href={file.source} target="_blank" rel="noopener">{file.source}</a>
    </p>
  {/if}
</section>

<style>
  h1 {
    font-size: 1.6rem;
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
    border: 1px solid var(--md-outline);
    background: var(--md-surface);
    color: var(--md-on-surface);
    font-size: 1.05rem;
  }

  .count {
    font-size: 0.85rem;
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
    border-color: var(--md-primary);
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
    font-size: 1rem;
  }

  .term:hover {
    background: var(--md-surface-container-high);
  }

  .chevron {
    color: var(--md-on-surface-variant);
    font-size: 1.1rem;
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
    border-inline-start: 2px solid var(--md-outline-variant);
  }

  .line[data-depth='2'] {
    padding-inline-start: var(--space-6);
    border-inline-start: 2px solid var(--md-secondary);
    color: var(--md-on-surface-variant);
    font-size: 0.95rem;
  }

  .credit {
    margin-top: var(--space-6);
    padding-top: var(--space-3);
    border-top: 1px solid var(--md-outline-variant);
    font-size: 0.85rem;
    max-width: var(--prose-max);
  }
</style>
