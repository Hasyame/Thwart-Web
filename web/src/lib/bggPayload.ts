import type { Play } from './records';
import type { BggPlay } from './sync/api';
import { bggComment } from './bggComment';

/**
 * A finished game, in the shape BoardGameGeek records one.
 *
 * Field for field what the Android app builds (`BggPayload.kt`), so a play
 * sent from either client lands on BGG the same way. BoardGameGeek has no win
 * flag on a play and no field for the heroes or the start time, so those go
 * in the comment — `bggComment`, which both clients write line for line.
 *
 * One seat: the account holder, and nobody else. Two-handed solo is one
 * person holding two decks, and at a real table the others have their own BGG
 * accounts and log the game themselves. Every hero at the table is named in
 * the comment, so nothing is lost by it. BGG shows the colour beside the
 * name, which is where the hero belongs: it is what tells one seat from
 * another.
 */
export function bggPlayOf(
  play: Play,
  bggUsername: string,
  difficultyLabel: (id: string) => string,
): BggPlay {
  const finished = new Date(play.playedAt);
  return {
    playedOn: isoDay(finished),
    // BGG records length in minutes. A game shorter than a minute is almost
    // certainly a mistimed entry, so it reports as zero rather than rounding
    // up to something that looks deliberate.
    lengthMinutes: Math.max(0, Math.floor(play.elapsedMillis / 60_000)),
    location: play.location,
    comment: bggComment(play, difficultyLabel),
    players: [
      {
        username: bggUsername,
        name: bggUsername,
        score: play.victoryPoints,
        won: play.won,
        color: [play.heroName, play.aspects].filter((part) => part.trim() !== '').join(' / '),
      },
    ],
  };
}

/* A wire format for one site, fixed rather than following the device language. */
const two = (n: number): string => String(n).padStart(2, '0');
const isoDay = (d: Date): string => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
