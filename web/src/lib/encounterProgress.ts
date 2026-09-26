import { startOf, type Encounter, type EncounterProgress, type EncounterSetup } from './encounter';

const integer = (v: unknown): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Validate every field consumed by the tracker while retaining future fields for round trips. */
export function parseEncounterProgress(text: string): Partial<EncounterProgress> | null {
  try {
    const p: unknown = JSON.parse(text);
    if (!record(p)) return null;
    const numbers = ['layoutVersion','villainIndex','damage','schemeIndex','schemeOption','threat','round','activeVillain','villainForm','structureIndex','structureDamage'];
    if (!numbers.every(k => p[k] === undefined || integer(p[k]))) return null;
    if (p.genePool != null && !integer(p.genePool)) return null;
    const maximum = (v: unknown): boolean => v == null || (integer(v) && (v as number) > 0);
    if (!['manualVillainHealth','manualSchemeLimit'].every(k => maximum(p[k]))) return null;
    if (p.extraThreats !== undefined && (!Array.isArray(p.extraThreats) || !p.extraThreats.every(integer))) return null;
    for (const key of ['moreVillains','moreSchemes']) {
      const tracks = p[key];
      if (tracks !== undefined && (!Array.isArray(tracks) || !tracks.every(t => record(t) && integer(t.index) && integer(t.value) && maximum(t.manual)))) return null;
    }
    if (p.environment != null && typeof p.environment !== 'string') return null;
    if (!['needsReview','noLongerWorthy'].every(k => p[k] == null || typeof p[k] === 'boolean')) return null;
    if (p.mission != null) {
      const m = p.mission;
      if (!record(m) || !['threat','attempts','overseer','minions','attackLeft','thwartPending','lastRound'].every(k => integer(m[k])) || typeof m.resolving !== 'boolean') return null;
      if (!Array.isArray(m.allies) || !m.allies.every(a => record(a) && ['name','resources','assigned'].every(k => typeof a[k] === 'string') && integer(a.attack) && integer(a.thwart))) return null;
    }
    return p as Partial<EncounterProgress>;
  } catch { return null; }
}

export function recoveredEncounter(setup: EncounterSetup, saved: Partial<EncounterProgress>): Encounter {
  let p = {...startOf(setup).progress, ...saved};
  if ((saved.layoutVersion ?? 0) < 2 && setup.villainForms?.length) {
    const old = saved.villainIndex ?? 0;
    p = {...p, villainIndex: Math.floor(old / 3), villainForm: old % 3, needsReview: true};
  }
  if ((saved.layoutVersion ?? 0) < 2 && setup.activeVillainMarker) {
    // Older trackers had one sequential dial. Preserve its known damage and
    // explicitly request the other three values instead of inventing them.
    const code = `4508${1 + Math.floor((saved.villainIndex ?? 0) / 2)}`;
    const track = [setup.villain,...(setup.moreVillains ?? [])].findIndex(cards => cards[0]?.code?.startsWith(code));
    const extras = Array.from({length: setup.moreVillains?.length ?? 0}, (_,i) => ({index:0,value:i + 1 === track ? p.damage : 0,manual:null}));
    p = {...p, villainIndex: 0, damage: track <= 0 ? p.damage : 0, moreVillains: extras, needsReview: true};
  }
  p = {...p, layoutVersion: 2, villainIndex: Math.min(Math.max(0,p.villainIndex),Math.max(0,setup.villain.length-1)),
    schemeIndex: Math.min(Math.max(0,p.schemeIndex),Math.max(0,setup.scheme.length-1))};
  return {setup,progress:p};
}
