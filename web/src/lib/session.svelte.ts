import type { Aspect, DifficultyId } from './randomizer';

/**
 * The game currently on the table.
 *
 * Module-level state so walking to the card browser mid-game and coming back
 * does not lose the clock. It is deliberately *not* in IndexedDB: a game in
 * progress describes the table in front of one person, and doc 01 keeps the
 * app's `paused_games` out of sync for exactly that reason. Closing the tab
 * ends the game, which is the honest behaviour for something this transient.
 */

export interface Seat {
  readonly heroCode: string;
  readonly heroName: string;
  readonly aspect: Aspect;
}

export interface Session {
  scenarioCode: string;
  scenarioName: string;
  difficulty: DifficultyId;
  standardSet: DifficultyId | null;
  seats: Seat[];
  modularSetCodes: string[];
  /** Milliseconds banked before the current run of the clock. */
  accumulatedMillis: number;
  /** When the clock last started, or null when it is stopped. */
  runningSince: number | null;
  started: boolean;
}

function empty(): Session {
  return {
    scenarioCode: '',
    scenarioName: '',
    difficulty: 'STANDARD_I',
    standardSet: null,
    seats: [],
    modularSetCodes: [],
    accumulatedMillis: 0,
    runningSince: null,
    started: false,
  };
}

export const session = $state<{ current: Session }>({ current: empty() });

export function elapsedMillis(now: number): number {
  const s = session.current;
  return s.runningSince === null
    ? s.accumulatedMillis
    : s.accumulatedMillis + Math.max(0, now - s.runningSince);
}

export function startGame(): void {
  session.current.started = true;
  session.current.runningSince = Date.now();
}

export function pauseGame(): void {
  const s = session.current;
  if (s.runningSince === null) {
    return;
  }
  s.accumulatedMillis += Math.max(0, Date.now() - s.runningSince);
  s.runningSince = null;
}

export function resumeGame(): void {
  if (session.current.runningSince === null) {
    session.current.runningSince = Date.now();
  }
}

export function endGame(): void {
  session.current = empty();
}

/** Wall-clock based, so it reads sensibly however long the break was. */
export function formatElapsed(millis: number): string {
  const total = Math.floor(millis / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}
