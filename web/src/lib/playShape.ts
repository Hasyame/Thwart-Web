import type { Play, PlayHero } from './records';

/**
 * A play with every field present, whatever arrived.
 *
 * # Why this exists
 *
 * The Android app serialises with kotlinx, which by default omits **every
 * property equal to its declared default** as well as every explicit null. So
 * `PlayEntity` — whose optional fields all have defaults — crosses the wire
 * missing most of them. A solo game with no notes arrives as roughly nine keys.
 *
 * The web stored that body as the row, spreading it as-is, and the `Play` type
 * says every field is present. TypeScript believed the type; the data did not
 * match it. What that cost, in order of discovery:
 *
 *   - Every standalone game synced from a phone was badged "in a campaign",
 *     because `campaignRunId` was absent and `undefined !== null`.
 *   - The statistics page showed nothing at all, for ever. `roster` was absent,
 *     `for (const seat of play.roster)` threw inside the aggregate, the
 *     `$derived` threw with it, and the render aborted — leaving whatever was
 *     last painted on screen, which was the loading line.
 *
 * The second is the reason this is a module and not another `?? []` at the call
 * site. A missing field is not one bug; it is one bug per reader, discovered
 * one at a time by users. Filling the row once, where it enters the database,
 * fixes every reader at once — including the ones nobody has written yet.
 *
 * # What the defaults are
 *
 * Kotlin's, exactly. They have to be, or the same account shows different
 * numbers on the two devices — which is the whole point of
 * `docs/spec/statistics.md`. `PlayEntity` declares them and they are repeated
 * here beside each field.
 */

/** A seat, with the three fields the app reads. */
const SEAT_KEYS = new Set(['code', 'name', 'aspect', 'isOwner', 'extra']);

/** The keys of a record this client does not read, kept aside; undefined when none. */
function extrasOf(raw: Record<string, unknown>, known: ReadonlySet<string>): Record<string, unknown> | undefined {
  const carried = raw['extra'];
  const out: Record<string, unknown> = carried !== null && typeof carried === 'object' && !Array.isArray(carried)
    ? { ...(carried as Record<string, unknown>) }
    : {};
  for (const [key, value] of Object.entries(raw)) {
    if (!known.has(key) && value !== undefined) {
      out[key] = value;
    }
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

function seatOf(value: unknown): PlayHero {
  const raw = (value ?? {}) as Record<string, unknown>;
  const extra = extrasOf(raw, SEAT_KEYS);
  return {
    code: typeof raw.code === 'string' ? raw.code : '',
    name: typeof raw.name === 'string' ? raw.name : '',
    aspect: typeof raw.aspect === 'string' ? raw.aspect : '',
    ...(raw.isOwner === true ? { isOwner: true } : {}),
    ...(extra === undefined ? {} : { extra }),
  };
}

const PLAY_KEYS = new Set([
  'id', 'playedAt', 'scenarioCode', 'scenarioName', 'difficulty', 'standardSet', 'modularSets',
  'heroCode', 'heroName', 'aspects', 'otherHeroes', 'roster', 'players', 'won', 'elapsedMillis',
  'notes', 'location', 'victoryPoints', 'campaignRunId', 'reportedToBgg', 'photos', 'updatedAt',
  'deletedAt', 'mode', 'extra',
]);

/**
 * The record as it goes on the wire and into a backup: the known fields,
 * with every unknown one this client carried put back beside them, and
 * nothing this client added for itself. The inverse of `completePlay`, so
 * a record round-trips through a client that does not know its newest
 * fields without losing them. docs/spec/achievements/sync.md §2.
 */
export function playWire(play: Play): Record<string, unknown> {
  const { extra, roster, mode, ...known } = play;
  // A row written before the roster existed may lack it; the wire says none.
  const seats = (roster ?? []).map((seat) => {
    const { extra: seatExtra, isOwner, ...seatKnown } = seat;
    return { ...(seatExtra ?? {}), ...seatKnown, ...(isOwner === true ? { isOwner: true } : {}) };
  });
  return { ...(extra ?? {}), ...known, roster: seats, ...(mode === undefined ? {} : { mode }) };
}

const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const number = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * Fills in whatever the body left out.
 *
 * Called on the way in from sync and from a backup file, and by the migration
 * that repairs rows already stored. Idempotent: a complete row passes through
 * unchanged.
 */
export function completePlay(body: unknown, id: string): Play {
  const raw = (body ?? {}) as Record<string, unknown>;

  const playedAt = number(raw.playedAt, 0);
  const extra = extrasOf(raw, PLAY_KEYS);

  return {
    id,
    playedAt,
    scenarioCode: text(raw.scenarioCode),
    scenarioName: text(raw.scenarioName),
    difficulty: text(raw.difficulty),
    // PlayEntity: `standardSet: String = ""`
    standardSet: text(raw.standardSet),
    // PlayEntity: `modularSets: String = ""`
    modularSets: text(raw.modularSets),
    heroCode: text(raw.heroCode),
    heroName: text(raw.heroName),
    aspects: text(raw.aspects),
    // PlayEntity: `otherHeroes: String = ""`
    otherHeroes: text(raw.otherHeroes),
    // PlayEntity: `roster: List<PlayHero> = emptyList()`. The one that blanked
    // the statistics page, because it is iterated rather than read.
    roster: Array.isArray(raw.roster) ? raw.roster.map(seatOf) : [],
    // PlayEntity: `players: Int = 1`. Not zero: a game had at least one player,
    // and a nought here would put a row in the table-size breakdown that no
    // bucket describes.
    players: number(raw.players, 1),
    won: raw.won === true,
    // PlayEntity: `elapsedMillis: Long = 0`, meaning a game nobody timed.
    elapsedMillis: number(raw.elapsedMillis, 0),
    notes: text(raw.notes),
    // PlayEntity: `location: String = ""`
    location: text(raw.location),
    // PlayEntity: `victoryPoints: Int = 0`
    victoryPoints: number(raw.victoryPoints, 0),
    /*
      PlayEntity: `campaignRunId: String? = null`.

      Absent and null both mean no campaign; an empty string is a campaign game.
      Three states on the wire, two in the record. See the specification's
      section 2.7.
    */
    campaignRunId: typeof raw.campaignRunId === 'string' ? raw.campaignRunId : null,
    // PlayEntity: `reportedToBgg: Boolean = false`
    reportedToBgg: raw.reportedToBgg === true,
    // PlayEntity: `photos: String = ""`. The server never receives any.
    photos: text(raw.photos),
    /*
      PlayEntity: `updatedAt: Long = 0`.

      Falls back to when the game was played, which is the same thing the v5
      migration used: a row that never carried the column has no better answer,
      and zero would make every merge prefer the other device's copy.
    */
    updatedAt: number(raw.updatedAt, 0) > 0 ? number(raw.updatedAt, 0) : playedAt,
    // PlayEntity: `deletedAt: Long? = null`
    deletedAt: typeof raw.deletedAt === 'number' ? raw.deletedAt : null,
    // Thwart's own mode, when the record names one; an unknown value is
    // kept as it is and read as none. docs/spec/achievements/data-model.md §3.
    ...(typeof raw.mode === 'string' && raw.mode !== '' ? { mode: raw.mode } : {}),
    ...(extra === undefined ? {} : { extra }),
  };
}
