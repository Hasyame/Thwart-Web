import type { CampaignRun, Play, SavedDeck } from './records';
import type { CampaignEvent } from './campaign/types';
import type { CardSet, IndexRow } from './types';
import type { Seat, Session } from './session.svelte';
import { DIFFICULTIES, type DifficultyId } from './randomizer';
import { seatsOf } from './plays';
import { templateOf } from './campaign/store';
import { fold } from './campaign/engine';
import { encounterSetsOf, trackedSetCode } from './campaign/encounter';

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
 * - **The modular sets.** Kept by code on the play since both clients grew
 *   the `modularSets` field, and read straight back. Before that, both wrote
 *   only a line into the notes, `Modular sets: A, B`, by name, so an older
 *   play gets them back by looking the names up, in both card languages; a
 *   name that matches nothing is dropped rather than guessed at. A play that
 *   comes back with none says so on the setup screen.
 *
 * Only a play recorded from the setup page or from a draw comes back this
 * way. A campaign's scenario is logged under the campaign's own scenario id
 * (`s1_unus`, not a card set code) and the campaign's own difficulty word,
 * and neither is something the one-off setup can put on a table; a campaign
 * is played again from its own box.
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
  if (DIFFICULTY_IDS.has(upper)) {
    return upper as DifficultyId;
  }
  // A campaign records only the mode — `standard` or `expert` — because the
  // template decides the cards. Played on its own, that is the core set's
  // version of the mode: Expert must come back as Expert, not as Standard.
  if (upper === 'EXPERT') {
    return 'EXPERT_I';
  }
  return 'STANDARD_I';
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

/**
 * What a campaign's scenario looks like laid out on its own.
 *
 * A play from a campaign records the template's own scenario id — `s1_musee`
 * — which is not a card set and which the setup screen cannot offer. So the
 * button was hidden for those, which made every campaign scenario the one
 * kind of game that could not be played again, and the reason people would
 * most want to: the one they just lost.
 *
 * The template knows what was on the table. The villain follows from
 * `baseSetup` — or from the folded state, for a scenario that draws one from
 * a pool as the campaign goes — and the set follows from the villain, by the
 * same `trackedSetCode` the campaign tracker itself uses. The modular sets
 * are whatever the template shuffles in that the card database calls a
 * modular set: a template lists the villain's own set and the standard set in
 * the same breath, and neither belongs in the modular picker.
 *
 * Null when the run is gone or its template unreadable, in which case the
 * replay falls back to what the play says and the person picks the scenario.
 */
export interface CampaignLayout {
  readonly scenarioCode: string;
  readonly modularSetCodes: readonly string[];
}

export function campaignLayoutOf(
  play: Play,
  run: CampaignRun,
  events: readonly CampaignEvent[],
  index: readonly IndexRow[],
  sets: readonly CardSet[],
): CampaignLayout | null {
  const template = templateOf(run);
  const scenario = template?.scenarios?.find((s) => s.id === play.scenarioCode) ?? null;
  if (template === null || scenario === null) {
    return null;
  }
  const setCode = trackedSetCode(scenario, fold(template, events), index);
  if (setCode === null) {
    return null;
  }
  const modular = new Set(sets.filter((s) => s.type === 'modular').map((s) => s.code));
  return {
    scenarioCode: setCode,
    modularSetCodes: [...new Set(encounterSetsOf(scenario).filter((code) => modular.has(code)))],
  };
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

export function replayOf(
  play: Play,
  decks: readonly SavedDeck[],
  sets: readonly CardSet[],
  /** For a campaign's scenario: what its template says was on the table. */
  layout: CampaignLayout | null = null,
): Replay {
  const difficulty = difficultyOf(play.difficulty);
  const standard = isExpert(difficulty) && play.standardSet !== ''
    ? difficultyOf(play.standardSet)
    : null;

  // The template first, then the field when the play has one, then the notes
  // line for a play older than the field.
  const recorded = (play.modularSets ?? '').split(',').map((c) => c.trim()).filter((c) => c !== '');
  const modularSetCodes =
    layout !== null
      ? [...layout.modularSetCodes]
      : recorded.length > 0
        ? recorded
        : modularCodesFrom(play.notes, sets);

  const scenarioCode = layout?.scenarioCode ?? play.scenarioCode;
  // Named as the set is named where the set is known, so the setup screen and
  // the game it will record agree; a campaign's own title belongs to it.
  const setName = sets.find((s) => s.code === scenarioCode)?.name;

  return {
    session: {
      scenarioCode,
      scenarioName: setName ?? (play.scenarioName !== '' ? play.scenarioName : scenarioCode),
      difficulty,
      standardSet: standard,
      seats: seatsOf(play).map((hero) => seatFor(hero, decks)),
      modularSetCodes,
    },
    // A template that lists none is a scenario that has none: known, not
    // unknown.
    modularSetsUnknown: layout === null && modularSetCodes.length === 0,
  };
}
