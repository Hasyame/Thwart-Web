/**
 * What the tracker writes into a play's notes, and how it is read back.
 *
 * The play record is the phone's contract and has no field for the round
 * count or the villain's stage; the notes do, as one labelled line each,
 * the way the modular sets have always gone in ("Modular sets: …"). Written
 * only when the tracker was in use — a game recorded without it has no
 * rounds to claim — and read back here so the detail can show them as
 * facts rather than as a line of text.
 */

export interface TrackerNotes {
  /** Rounds played, or null when the game was not tracked. */
  readonly rounds: number | null;
  /** The villain's stage when the game ended, as printed: "I", "II", "III". */
  readonly villainStage: string | null;
  /** The notes with those lines taken out, for reading. */
  readonly rest: string;
}

const ROUNDS = /^Rounds: (\d+)$/;
const STAGE = /^Villain stage: (\S+)$/;

/** The lines the tracker adds, in the order they are written. */
export function trackerLines(rounds: number, villainStage: string): string[] {
  const out: string[] = [];
  if (rounds > 0) {
    out.push(`Rounds: ${rounds}`);
  }
  if (villainStage !== '') {
    out.push(`Villain stage: ${villainStage}`);
  }
  return out;
}

export function parseTrackerNotes(notes: string): TrackerNotes {
  let rounds: number | null = null;
  let villainStage: string | null = null;
  const rest: string[] = [];
  for (const line of notes.split('\n')) {
    const r = ROUNDS.exec(line.trim());
    if (r !== null) {
      rounds = Number(r[1]);
      continue;
    }
    const s = STAGE.exec(line.trim());
    if (s !== null) {
      villainStage = s[1] ?? null;
      continue;
    }
    rest.push(line);
  }
  return { rounds, villainStage, rest: rest.join('\n').trim() };
}
