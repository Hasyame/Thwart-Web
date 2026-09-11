import type { Play, SavedDeck } from './records';
import type { CardSet } from './types';
import type { Seat, Session } from './session.svelte';
import { DIFFICULTIES, type DifficultyId } from './randomizer';
import { seatsOf } from './plays';

/**
 * Turning a game that was played into a game that is about to be.
 *
 * The inverse of `buildPlay`, as far as the record allows. A play stores the
 * scenario, the difficulty, the standard set and every seat's hero and aspect,
 * so all of those come back exactly. Two things do not, and the reasons are
 * worth knowing:
 *
 * - **Which deck was at each seat.** A play records heroes, not decks, because
 *   that is what the phone records and the two must agree. So each seat is
 *   matched back to a saved deck by hero and aspect, and when there is one it
 *   is used — the name on the seat is the deck's, as it was. When there is not,
 *   the seat carries the hero alone, which is what a game put away and picked
 *   up later already does.
 *
 * - **The modular sets.** Neither client stores them as a field. The web writes
 *   them into the notes as a line, `Modular sets: A, B`, by name, so a game
 *   recorded here gets them back by looking the names up; a game recorded on
 *   the phone has no such line and starts with none chosen. That is stated on
 *   the setup screen rather than silently guessed at.
 *
 * Every play qualifies, including one that was part of a campaign. What is
 * replayed is the scenario as it was laid out, as an ordinary game — not the
 * campaign, which has its own way of being continued.
 */

/** The line `buildPlay` writes, and the only thing this reads out of the notes. */
const MODULAR_LINE = /^Modular sets:\s*(.+)$/m;

const DIFFICULTY_IDS = new Set<string>(DIFFICULTIES.map((d) => d.id));

/**
 * A recorded difficulty back to the id the session uses.
 *
 * Recorded lowercased, as the phone does it — `standard_i` — so this is the
 * reverse. Anything unrecognised falls back to Standard I rather than to an
 * empty session: an old row with an odd value should still be playable.
 */
function difficultyOf(recorded: string): DifficultyId {
  const upper = recorded.trim().toUpperCase();
  return DIFFICULTY_IDS.has(upper) ? (upper as DifficultyId) : 'STANDARD_I';
}

function isExpert(id: DifficultyId): boolean {
  return DIFFICULTIES.find((d) => d.id === id)?.expert === true;
}

/**
 * Aspects compared as sets, not strings.
 *
 * A seat says `Leadership, Justice`; the deck it came from says
 * `leadership,justice` or the other way round. Both name the same deck.
 */
function aspectKey(aspects: string): string {
  return aspects
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter((a) => a !== '')
    .sort()
    .join(',');
}

function seatFor(hero: { code: string; name: string; aspect: string }, decks: readonly SavedDeck[]): Seat {
  const wanted = aspectKey(hero.aspect);
  const deck = decks.find((d) => d.heroCode === hero.code && aspectKey(d.aspects) === wanted);
  if (deck !== undefined) {
    return {
      deckId: deck.id,
      deckName: deck.name,
      heroCode: deck.heroCode,
      heroName: deck.heroName,
      aspect: hero.aspect,
    };
  }
  // No such deck any more, or never one here. The hero stands in for it, the
  // same way a paused game's seats do.
  return {
    deckId: hero.code,
    deckName: hero.name,
    heroCode: hero.code,
    heroName: hero.name,
    aspect: hero.aspect,
  };
}

/**
 * Modular set names back to codes, for the ones the card database knows.
 *
 * Names rather than codes because that is what the notes line carries. A name
 * the database does not recognise is dropped rather than guessed at: a wrong
 * modular set on the table is worse than a missing one.
 */
function modularCodesFrom(notes: string, sets: readonly CardSet[]): string[] {
  const match = MODULAR_LINE.exec(notes ?? '');
  if (match === null || match[1] === undefined) {
    return [];
  }
  const byName = new Map(
    sets.filter((s) => s.type === 'modular').map((s) => [s.name.toLowerCase(), s.code] as const),
  );
  const codes: string[] = [];
  for (const name of match[1].split(',')) {
    const code = byName.get(name.trim().toLowerCase());
    if (code !== undefined && !codes.includes(code)) {
      codes.push(code);
    }
  }
  return codes;
}

export interface Replay {
  readonly session: Partial<Session>;
  /**
   * True when no modular set came back, so the setup screen can say so.
   *
   * Cannot tell "the game had none" from "they were never written down" — a
   * phone-recorded play looks the same either way — so this is only "choose
   * them again", never an accusation that something was lost.
   */
  readonly modularSetsUnknown: boolean;
}

export function replayOf(play: Play, decks: readonly SavedDeck[], sets: readonly CardSet[]): Replay {
  const difficulty = difficultyOf(play.difficulty);
  const standard = isExpert(difficulty) && play.standardSet !== ''
    ? difficultyOf(play.standardSet)
    : null;

  const modularSetCodes = modularCodesFrom(play.notes, sets);

  return {
    session: {
      scenarioCode: play.scenarioCode,
      scenarioName:
        play.scenarioName !== ''
          ? play.scenarioName
          : (sets.find((s) => s.code === play.scenarioCode)?.name ?? play.scenarioCode),
      difficulty,
      standardSet: standard,
      seats: seatsOf(play).map((hero) => seatFor(hero, decks)),
      modularSetCodes,
    },
    modularSetsUnknown: modularSetCodes.length === 0,
  };
}
