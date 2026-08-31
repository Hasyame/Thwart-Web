import type { DifficultyId } from './randomizer';
import type { Encounter } from './encounter';

/**
 * The game currently on the table.
 *
 * Module-level state so walking to the card browser mid-game and coming back
 * does not lose the clock. It is deliberately *not* in IndexedDB: a game in
 * progress describes the table in front of one person, and doc 01 keeps the
 * app's `paused_games` out of sync for exactly that reason. Closing the tab
 * ends the game, which is the honest behaviour for something this transient.
 */

/**
 * One seat at the table, which is a deck rather than a hero.
 *
 * Asking for a hero and then an aspect makes somebody describe a deck they
 * already have, and gets the aspect wrong for a two-aspect deck. A deck
 * carries both, so the deck is what is chosen and the row leads with its name,
 * because that is what its owner recognises.
 *
 * `heroName` is the name the *deck* states, not one looked up from the card
 * database: a deck imported from MarvelCDB can name a hero this collection has
 * never heard of, and without carrying it the seat reads as a bare card code
 * and the play is filed under that.
 */
export interface Seat {
  readonly deckId: string;
  readonly deckName: string;
  readonly heroCode: string;
  readonly heroName: string;
  /** The deck's aspects, joined, since a deck can carry two. */
  readonly aspect: string;
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
  /**
   * The counters, once the scenario's cards have been read.
   *
   * Null while they load, and null for a scenario the card database cannot
   * describe. A tracker that shows nothing is better than one that shows
   * numbers it made up, so the panel simply does not appear.
   */
  encounter: Encounter | null;
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
    encounter: null,
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

export function setEncounter(encounter: Encounter | null): void {
  session.current.encounter = encounter;
}

/**
 * Applies a move to the counters.
 *
 * The domain functions return new values rather than mutating, so this is the
 * one place the session state is reassigned and every screen reads the result.
 */
export function updateEncounter(change: (current: Encounter) => Encounter): void {
  const current = session.current.encounter;
  if (current !== null) {
    session.current.encounter = change(current);
  }
}

/**
 * Puts a written-down game back on the table.
 *
 * The clock comes back stopped. Somebody resuming is getting the cards out
 * again, and counting that as play time is the same mistake as counting setup.
 */
export function resumeSession(restored: Partial<Session>): void {
  session.current = { ...empty(), ...restored, started: true, runningSince: null };
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
