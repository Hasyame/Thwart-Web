/** Player-reported cards only. Never infer an unrevealed card or an enemy response. */
export interface MissionAlly {
  readonly name: string;
  readonly resources: string;
  readonly assigned: string;
  readonly attack: number;
  readonly thwart: number;
}
export interface MissionProgress {
  readonly threat: number;
  readonly attempts: number;
  readonly overseer: number;
  readonly minions: number;
  readonly allies: readonly MissionAlly[];
  readonly attackLeft: number;
  readonly thwartPending: number;
  readonly resolving: boolean;
  readonly lastRound: number;
}
export function participates(ally: MissionAlly): boolean {
  const a = [...ally.resources].filter(x => 'pemw'.includes(x));
  const b = [...ally.assigned].filter(x => 'pemw'.includes(x));
  return a.some(x => b.some(y => x === y || x === 'w' || y === 'w'));
}
export const missionTotals = (allies: readonly MissionAlly[]): { attack: number; thwart: number } =>
  allies.filter(participates).reduce((sum, ally) => ({
    attack: sum.attack + Math.max(0, ally.attack), thwart: sum.thwart + Math.max(0, ally.thwart),
  }), {attack: 0, thwart: 0});
export const missionSucceeded = (m: MissionProgress): boolean => m.threat === 0 && m.overseer === 0 && m.minions === 0;
export function beginAttempt(m: MissionProgress, round: number): MissionProgress {
  if (m.resolving || m.attempts >= 4 || missionSucceeded(m) || m.allies.length === 0) return m;
  const totals = missionTotals(m.allies);
  return {...m, resolving: true, attackLeft: totals.attack, thwartPending: totals.thwart, lastRound: round};
}
export function allocateAttack(m: MissionProgress, overseer: boolean): MissionProgress {
  if (!m.resolving || m.attackLeft === 0 || (overseer && m.minions > 0) || (overseer && m.overseer === 0)) return m;
  return {...m, attackLeft: m.attackLeft - 1, overseer: overseer ? m.overseer - 1 : m.overseer};
}
export function finishAttempt(m: MissionProgress): MissionProgress {
  if (!m.resolving || (m.attackLeft > 0 && (m.overseer > 0 || m.minions > 0))) return m;
  return {...m, resolving: false, threat: Math.max(0, m.threat - m.thwartPending), attempts: m.attempts + 1,
    attackLeft: 0, thwartPending: 0, allies: m.allies.map(a => ({...a, assigned: ''}))};
}
