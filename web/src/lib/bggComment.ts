import type { Play } from './records';

/**
 * The play as the comment BGG will hold, for pasting into its comment field.
 *
 * Line for line what the Android app posts (`BggPayload.kt`), so a play logged
 * from either client reads the same on BGG. BoardGameGeek has no field for
 * the outcome, the heroes, or when a game started, so they go here: the
 * result and scenario first, then who was played, then the day and the
 * start–end times the app knows and BGG does not, then the notes -- which is
 * where the modular sets already are, as the line both clients write.
 *
 * English on purpose, as on the phone: this is one comment read back on one
 * site, and two clients writing "Win" and "Victoire" for the same game would
 * describe it two ways. Difficulty is the label the interface uses, which is
 * what the person will recognise.
 */
export function bggComment(play: Play, difficultyLabel: (id: string) => string): string {
  const heroes = [play.heroName, play.otherHeroes].filter((name) => name.trim() !== '').join(', ');
  const finished = new Date(play.playedAt);
  const started = new Date(play.playedAt - play.elapsedMillis);
  const lines = [
    `${play.won ? 'Win' : 'Loss'} — ${play.scenarioName || play.scenarioCode}` +
      (play.difficulty === '' ? '' : ` (${difficultyLabel(play.difficulty)})`),
  ];
  if (heroes !== '') {
    lines.push(`Heroes: ${heroes}`);
  }
  if (play.aspects !== '') {
    lines.push(`Aspects: ${play.aspects}`);
  }
  lines.push(`Played ${isoDay(finished)}, ${clock(started)}–${clock(finished)}`);
  if (play.notes.trim() !== '') {
    lines.push(play.notes.trim());
  }
  return lines.join('\n');
}

/* Fixed formats, as on the phone: a wire format for one site, not something
   that should follow the device language. */
const two = (n: number): string => String(n).padStart(2, '0');
const isoDay = (d: Date): string => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const clock = (d: Date): string => `${two(d.getHours())}:${two(d.getMinutes())}`;
