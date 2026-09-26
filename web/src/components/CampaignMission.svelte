<script lang="ts">
  import { session, updateEncounter } from '../lib/session.svelte';
  import { beginAttempt, allocateAttack, finishAttempt, missionSucceeded, participates, type MissionProgress } from '../lib/campaign/mission';
  import type { Strings } from '../lib/i18n';
  import CardRef from './CardRef.svelte';
  let { t, initialThreat, missionCode, overseerCode, cardName }: {
    t: Strings; initialThreat: number; missionCode: string; overseerCode: string; cardName: (code: string) => string;
  } = $props();
  const m = $derived(session.current.encounter?.progress.mission);
  let confirmed = $state(false);
  const change = (next: MissionProgress): void => updateEncounter(e => ({...e, progress: {...e.progress, mission: next}}));
  const number = (e: Event): number => Math.max(0, Math.trunc(Number((e.target as HTMLInputElement).value) || 0));
  const icons = [['p', '✊'], ['e', '⚡'], ['m', '🧠'], ['w', '✶']] as const;
  function initialize(): void {
    change({threat: initialThreat, attempts: 0, overseer: 5 * Math.max(1,session.current.seats.length), minions: 0, allies: [], attackLeft: 0, thwartPending: 0, resolving: false, lastRound: 0});
  }
</script>

<section class="surface mission" aria-label={t.missionMissionArea}>
  <h2>{t.missionMissionArea}</h2>
  <p><CardRef code={missionCode} name={cardName(missionCode)} /> · <CardRef code={overseerCode} name={cardName(overseerCode)} /> · <CardRef code="45171a" name={cardName('45171a')} /></p>
  {#if m === undefined}
    <button class="btn btn--primary" onclick={initialize}>{t.missionPrepareMission}</button>
  {:else}
    <div class="counts">
      <label>{t.missionThreat}<input class="field" type="number" min="0" value={m.threat} onchange={e => change({...m, threat: number(e)})} /></label>
      <label>{t.missionOverseerHP}<input class="field" type="number" min="0" value={m.overseer} onchange={e => change({...m, overseer: number(e)})} /></label>
      <label>{t.missionOtherMinions}<input class="field" type="number" min="0" value={m.minions} onchange={e => change({...m, minions: number(e)})} /></label>
      <label>{t.missionAttempts}<input class="field" type="number" min="0" max="4" value={m.attempts} onchange={e => change({...m, attempts: Math.min(4, number(e))})} /></label>
    </div>
    {#if missionSucceeded(m)}<p role="status">{t.missionMissionAccomplishedResolveTheCardS}</p>
    {:else if m.attempts >= 4}<p role="status">{t.missionFourAttemptsRemoveMissionTeamAnd}</p>
    {:else if m.resolving}
      <p>{t.missionDamageToAllocate}: <strong>{m.attackLeft}</strong> · {t.missionThreatToRemoveNext}: {m.thwartPending}</p>
      <button class="btn" disabled={m.attackLeft === 0 || m.minions === 0} onclick={() => change(allocateAttack(m, false))}>{t.missionDamageToAnotherMinion}</button>
      <button class="btn" disabled={m.attackLeft === 0 || m.minions > 0 || m.overseer === 0} onclick={() => change(allocateAttack(m, true))}>{t.missionDamageToOverseer}</button>
      <p class="muted">{t.missionApplyDamageToOneMinionAt}</p>
      <button class="btn btn--primary" disabled={m.attackLeft > 0 && (m.minions > 0 || m.overseer > 0)} onclick={() => {change(finishAttempt(m)); confirmed = false;}}>{t.missionRemoveThreatAndFinish}</button>
    {:else}
      <p>{t.missionDiscardOneCardPerAllyResolve}</p>
      {#each m.allies as ally, i (i)}
        <fieldset>
          <legend>{t.missionAlly} {i + 1}{participates(ally) ? ' ✓' : ''}</legend>
          <label>{t.missionName}<input class="field" value={ally.name} onchange={e => change({...m, allies: m.allies.map((a,j) => j === i ? {...a,name:e.currentTarget.value} : a)})} /></label>
          {#each ['resources', 'assigned'] as field}
            <p>{field === 'resources' ? (t.missionAllyResources) : (t.missionAssignedCardResources)}</p>
            {#each icons as [code, icon]}
              <button class="btn resource" aria-label={code === 'p' ? (t.missionPhysical) : code === 'e' ? (t.missionEnergy) : code === 'm' ? (t.missionMental) : (t.missionWild)} aria-pressed={(field === 'resources' ? ally.resources : ally.assigned).includes(code)} onclick={() => {
                const value = field === 'resources' ? ally.resources : ally.assigned;
                change({...m, allies: m.allies.map((a,j) => j === i ? {...a,[field]: value.includes(code) ? value.replaceAll(code,'') : value + code} : a)});
              }}>{icon}</button>
            {/each}
          {/each}
          <div class="counts"><label>ATK<input class="field" type="number" min="0" value={ally.attack} onchange={e => change({...m, allies: m.allies.map((a,j) => j === i ? {...a,attack:number(e)} : a)})} /></label><label>{t.missionTHW}<input class="field" type="number" min="0" value={ally.thwart} onchange={e => change({...m, allies: m.allies.map((a,j) => j === i ? {...a,thwart:number(e)} : a)})} /></label></div>
          <button class="btn" onclick={() => change({...m, allies: m.allies.filter((_,j) => j !== i)})}>{t.missionRemoveAlly}</button>
        </fieldset>
      {/each}
      <button class="btn" onclick={() => change({...m, allies: [...m.allies,{name:'',resources:'',assigned:'',attack:0,thwart:0}]})}>{t.missionAddAlly}</button>
      <label class="confirm"><input type="checkbox" bind:checked={confirmed} />{t.missionMissionTeamIsUsableThisPhase}</label>
      <button class="btn btn--primary" disabled={!confirmed || m.allies.length === 0} onclick={() => change(beginAttempt(m, session.current.encounter?.progress.round ?? 1))}>{t.missionCalculateAndAllocateAttack}</button>
    {/if}
    {#if m.attempts > 0}<p class="muted">{t.missionAfterEachAttemptNotEndedBy}</p>{/if}
  {/if}
</section>
<style>
  .mission {padding:var(--space-4); margin-block:var(--space-4); border-top:5px solid var(--accent)}
  .counts {display:flex; flex-wrap:wrap; gap:var(--space-3); margin-block:var(--space-3)}
  label {display:grid; gap:var(--space-1); max-width:100%} .counts input {width:7rem} fieldset {margin-block:var(--space-3); min-width:0}
  .resource[aria-pressed=true] {background:var(--accent);color:var(--accent-ink)} .confirm {display:flex;gap:var(--space-2);margin-block:var(--space-3)}
</style>
