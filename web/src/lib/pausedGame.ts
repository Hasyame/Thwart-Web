import { db } from './db';
import type { PausedGame, PausedPhase, VillainStep } from './records';
import type { Seat, Session } from './session.svelte';
import { elapsedMillis } from './session.svelte';
import {
  startOf,
  totalFor,
  type Encounter,
  type EncounterSetup,
} from './encounter';

/**
 * Putting a game away, and picking it up again.
 *
 * The joined strings are the app's, field for field. They are not how anybody
 * would design this fresh, but the shape is shared with `PausedGameEntity` and
 * a second spelling would be a second thing to keep in step for no gain.
 *
 * One row at a time. Saving replaces whatever was there, which is the app's
 * rule and the right one: two saved games would need naming and choosing
 * between, which is a filing system for a thing that happens when somebody has
 * to go and eat.
 */

const ONLY_ROW = 'current';

export interface LongBreakDraft {
  readonly phase: PausedPhase;
  readonly villainStep: VillainStep;
  /** Hit points left, by hero code, as typed. Blank until somebody fills it. */
  readonly heroLives: Readonly<Record<string, string>>;
  readonly villainLife: string;
  readonly villainStage: number;
}

export function emptyDraft(seats: readonly Seat[], encounter: Encounter | null): LongBreakDraft {
  const heroLives: Record<string, string> = {};
  for (const seat of seats) {
    heroLives[seat.heroCode] = '';
  }
  return {
    phase: 'PLAYER',
    villainStep: 'PLACE_THREAT',
    heroLives,
    // Seeded from the tracker when there is one, because it already knows
    // where the villain stood and retyping it is a chance to get it wrong.
    villainLife: villainLifeLeft(encounter),
    villainStage: encounter === null ? 1 : encounter.progress.villainIndex + 1,
  };
}

/**
 * What the villain has left, not the damage on it.
 *
 * The table reads the number beside the card, and the card counts down. The
 * tracker counts up, so this is where the two meet.
 */
function villainLifeLeft(encounter: Encounter | null): string {
  if (encounter === null) {
    return '';
  }
  const side = encounter.setup.villain[encounter.progress.villainIndex];
  const printed =
    side === undefined ? null : (totalFor(side, encounter.setup.players) ?? encounter.progress.manualVillainHealth);
  if (printed === null) {
    return '';
  }
  return String(Math.max(0, printed - encounter.progress.damage));
}

const joinHeroes = (seats: readonly Seat[]): string =>
  seats.map((seat) => `${seat.heroCode}|${seat.heroName}`).join(',');

const joinLives = (lives: Readonly<Record<string, string>>): string =>
  Object.entries(lives)
    .filter(([, value]) => value.trim() !== '')
    .map(([code, value]) => `${code}|${value.trim()}`)
    .join(',');

export function buildPausedGame(
  session: Session,
  draft: LongBreakDraft,
  now: number,
  /** The campaign run this scenario belongs to, or empty for a one-off game. */
  campaignRunId = '',
): PausedGame {
  return {
    id: ONLY_ROW,
    savedAt: now,
    scenarioCode: session.scenarioCode,
    scenarioName: session.scenarioName,
    difficulty: session.difficulty,
    heroes: joinHeroes(session.seats),
    modularSetCodes: session.modularSetCodes.join(','),
    elapsedMillis: elapsedMillis(now),
    phase: draft.phase,
    // Empty in the player phase, which has no steps of its own.
    villainStep: draft.phase === 'VILLAIN' ? draft.villainStep : '',
    heroLives: joinLives(draft.heroLives),
    villainLife: Number.parseInt(draft.villainLife, 10) || 0,
    villainStage: draft.villainStage,
    campaignRunId,
  };
}

export async function savePausedGame(game: PausedGame): Promise<void> {
  await db.pausedGames.put(game);
}

export async function loadPausedGame(): Promise<PausedGame | undefined> {
  return db.pausedGames.get(ONLY_ROW);
}

export async function discardPausedGame(): Promise<void> {
  await db.pausedGames.delete(ONLY_ROW);
}

// --- reading one back --------------------------------------------------------

export const splitHeroes = (packed: string): { code: string; name: string }[] =>
  packed
    .split(',')
    .filter((entry) => entry !== '')
    .map((entry) => {
      const [code = '', name = ''] = entry.split('|');
      return { code, name: name === '' ? code : name };
    });

export const splitLives = (packed: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const entry of packed.split(',')) {
    if (entry === '') {
      continue;
    }
    const [code = '', life = ''] = entry.split('|');
    if (code !== '') {
      out[code] = life;
    }
  }
  return out;
};

/**
 * Rebuilds the counters from what was written down.
 *
 * The table recorded the stage and the life left on it, so the damage is the
 * difference from that stage's printed total. Without a printed total to work
 * from, the life is carried as a manual figure instead, which is what the
 * tracker already does for a scenario it cannot read.
 */
export function restoreEncounter(setup: EncounterSetup, game: PausedGame): Encounter {
  const index = Math.min(Math.max(0, game.villainStage - 1), Math.max(0, setup.villain.length - 1));
  const side = setup.villain[index];
  const printed = side === undefined ? null : totalFor(side, setup.players);
  const base = startOf(setup);
  return {
    setup,
    progress: {
      ...base.progress,
      villainIndex: index,
      damage: printed === null ? 0 : Math.max(0, printed - game.villainLife),
      manualVillainHealth: printed === null && game.villainLife > 0 ? game.villainLife : null,
    },
  };
}
