<script lang="ts">
  import type { CampaignState, CampaignTemplate } from '../lib/campaign/types';
  import { textOf } from '../lib/campaign/types';
  import type { Locale } from '../lib/types';
  const {template, campaign, locale}: {template: CampaignTemplate; campaign: CampaignState; locale: Locale} = $props();
</script>
<ol class="journey">
  {#each template.scenarios ?? [] as chapter, i (chapter.id)}
    {@const completed = campaign.completedScenarios.some(result => result.scenarioId === chapter.id && result.victory)}
    <li class:current={campaign.currentScenarioId === chapter.id} class:completed aria-current={campaign.currentScenarioId === chapter.id ? 'step' : undefined}>
      <span class="number">{String(i + 1).padStart(2, '0')}{completed ? ' ✓' : ''}</span>
      <span>{textOf(chapter.name, locale)}</span>
    </li>
  {/each}
</ol>
<style>
  .journey { display: grid; grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr)); gap: var(--space-2); list-style: none; padding: 0; margin: var(--space-4) 0; }
  li { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2); border-bottom: 4px solid var(--border); font-weight: 700; }
  .number { font-style: italic; font-size: var(--text-lg); }
  .current { border-color: var(--accent); background: var(--accent-soft); }
  .completed .number { color: var(--accent); }
  @media (prefers-reduced-motion: no-preference) { .current { animation: arrive .2s ease-out; } @keyframes arrive { from { transform: translateY(4px); opacity: .6; } to { transform: translateY(0); opacity: 1; } } }
</style>
