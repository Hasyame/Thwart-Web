<script lang="ts">
  import type { IndexRow } from '../lib/types';
  import type { Strings } from '../lib/i18n';

  interface Props {
    row: IndexRow;
    packName: string | undefined;
    t: Strings;
    href: string;
    onOpen: (code: string) => void;
  }

  const { row, packName, t, href, onOpen }: Props = $props();

  /**
   * Plain-click navigation only.
   *
   * Ctrl-click, middle-click and "open in new tab" must keep working, so the
   * handler bows out for modified clicks and lets the browser follow the real
   * href. That is the whole reason these are anchors rather than buttons.
   */
  function handleClick(event: MouseEvent): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onOpen(row.code);
  }
</script>

<li>
  <a class="row surface" {href} onclick={handleClick} data-faction={row.factionCode}>
    <span class="faction" aria-hidden="true"></span>

    <span class="body">
      <span class="name">
        {row.name}
        {#if row.isUnique}
          <span class="unique" title={t.unique} aria-label={t.unique}>◆</span>
        {/if}
      </span>
      {#if row.subname !== null && row.subname !== ''}
        <span class="subname muted">{row.subname}</span>
      {/if}
      <span class="meta muted">
        {row.typeName} · {row.factionName}{packName === undefined
          ? ''
          : ` · ${packName}`}
      </span>
    </span>

    {#if row.cost !== null}
      <span class="cost" title={t.cost}>{row.cost}</span>
    {/if}
  </a>
</li>

<style>
  li {
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    text-decoration: none;
    color: inherit;
    overflow: hidden;
  }

  .row:hover {
    border-color: var(--accent);
    /* One more rung up the ladder, so hover is a lift rather than a tint. */
    background: var(--surface-2);
  }

  .faction {
    flex: 0 0 auto;
    width: 5px;
    align-self: stretch;
    border-radius: 3px;
    background: var(--faction-basic);
    margin: calc(var(--space-3) * -1) 0;
    margin-inline-start: calc(var(--space-3) * -1);
  }

  [data-faction='leadership'] .faction {
    background: var(--faction-leadership);
  }
  [data-faction='pool'] .faction {
    background: var(--faction-pool);
  }
  [data-faction='justice'] .faction {
    background: var(--faction-justice);
  }
  [data-faction='aggression'] .faction {
    background: var(--faction-aggression);
  }
  [data-faction='protection'] .faction {
    background: var(--faction-protection);
  }
  [data-faction='hero'] .faction {
    background: var(--faction-hero);
  }
  [data-faction='encounter'] .faction {
    background: var(--faction-encounter);
  }
  [data-faction='campaign'] .faction {
    background: var(--faction-campaign);
  }

  .body {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1 1 auto;
  }

  .name {
    font-weight: 600;
  }

  .unique {
    color: var(--text);
    font-size: 0.8em;
  }

  .subname,
  .meta {
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cost {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    min-width: 2rem;
    height: 2rem;
    padding: 0 var(--space-1);
    border-radius: 50%;
    background: var(--surface-3);
    color: var(--text);
    font-weight: 700;
  }
</style>
