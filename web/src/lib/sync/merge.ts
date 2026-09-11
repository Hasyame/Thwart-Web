/**
 * The merges the server does not know about.
 *
 * The server applies last-write-wins to whole records and never reads a body,
 * so every refinement below lives in the clients — and a client that skips one
 * loses what the other kept. They come from the Android inventory's sync
 * contract, which is a specification rather than a description: the two sides
 * either agree or they quietly build two sets of records on one account, each
 * seeing only its own.
 *
 * Written as pure functions over bodies. Nothing here touches IndexedDB or the
 * network, so every rule below can be asserted directly, which matters because
 * getting one wrong is silent and expensive: a duplicate posted to somebody's
 * real BoardGameGeek account, a favourite that forgets when it was starred, a
 * deck edited on two devices where one edit disappears.
 */

export type Body = Record<string, unknown>;

/**
 * What to do when both sides hold a record and the bodies differ.
 *
 * `fork` exists for one case only. Two devices that both edited the same
 * imported deck cannot be reconciled — the slots are a list, not a counter, and
 * there is no rule that makes one right. So the incoming one keeps the shared
 * id and the local one is re-keyed and renamed, which turns a lost edit into an
 * extra deck somebody can delete.
 */
export type MergeDecision =
  | { readonly kind: 'take'; readonly body: Body }
  | {
      readonly kind: 'fork';
      readonly body: Body;
      readonly forkedId: string;
      readonly forkedBody: Body;
    };

export interface MergeOptions {
  /**
   * True on a first sign-in or a full resync, where there is no history to
   * adjudicate with and the safe direction is keeping data.
   */
  readonly firstMerge?: boolean;
  /** Injected so a test can name the fork rather than guess at a UUID. */
  readonly newId?: () => string;
  /** Injected for the same reason: the suffix a forked deck's name gets. */
  readonly forkSuffix?: string;
}

/**
 * Fields that belong to this device and must survive an incoming record.
 *
 * The timer columns never travel — a running clock is a fact about the phone in
 * somebody's hand, and pulling one from a tablet mid-game starts counting a
 * session nobody is playing. They are absent from every body, so applying a
 * pulled record must merge onto the existing row rather than replace it, or the
 * clock is silently reset to nothing by a sync.
 */
export const LOCAL_ONLY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  campaign_runs: ['timerAccumulatedMillis', 'timerRunningSince', 'timerScenarioId'],
};

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const asStringList = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/** Union that keeps the order of the first list and appends what only the second has. */
const union = (first: readonly string[], second: readonly string[]): string[] => {
  const out = [...first];
  for (const entry of second) {
    if (!out.includes(entry)) {
      out.push(entry);
    }
  }
  return out;
};

/**
 * Carries this device's own fields across an incoming record.
 *
 * Applied to every pull, not only to a conflict: the incoming body simply does
 * not contain these fields, so replacing the row wholesale would clear them
 * whether or not anything conflicted.
 */
export function withLocalOnlyFields(collection: string, local: Body | null, incoming: Body): Body {
  const keep = LOCAL_ONLY_FIELDS[collection];
  if (keep === undefined || local === null) {
    return incoming;
  }
  const out: Body = { ...incoming };
  for (const field of keep) {
    if (field in local) {
      out[field] = local[field];
    }
  }
  return out;
}

/**
 * Merges two versions of one record.
 *
 * The incoming record is the base — it is what the server accepted, and the
 * local one is being reconciled against it — and each rule below names the one
 * field where that is not good enough.
 */
export function mergeBodies(
  collection: string,
  local: Body,
  incoming: Body,
  options: MergeOptions = {},
): MergeDecision {
  const base = withLocalOnlyFields(collection, local, incoming);

  switch (collection) {
    case 'plays': {
      /*
       * `reportedToBgg: true` wins, always.
       *
       * This is the only wrong merge whose effect leaves the app. A stale
       * `false` arriving over a `true` makes the app believe the game was
       * never reported, and the next report posts a duplicate to somebody's
       * real BoardGameGeek account — which no amount of local tidying undoes.
       */
      const reported = local.reportedToBgg === true || incoming.reportedToBgg === true;
      return { kind: 'take', body: { ...base, reportedToBgg: reported } };
    }

    case 'favourite_cards':
    case 'favourite_plays': {
      /*
       * The earlier date wins while both sides are live.
       *
       * A favourite is starred once. If two devices disagree about when, the
       * true answer is the first time it happened; taking the later one would
       * let a sync quietly reset the age of a list somebody sorts by it.
       */
      const localAt = asNumber(local.addedAt, Number.POSITIVE_INFINITY);
      const incomingAt = asNumber(incoming.addedAt, Number.POSITIVE_INFINITY);
      const earliest = Math.min(localAt, incomingAt);
      return {
        kind: 'take',
        body: { ...base, addedAt: Number.isFinite(earliest) ? earliest : 0 },
      };
    }

    case 'owned_packs': {
      /*
       * On a first merge only, the larger quantity wins.
       *
       * Two devices that have never met produce the same id for the same pack —
       * it is a natural key — so a first merge has no history to adjudicate
       * with. Somebody who owns two core sets on one device and recorded one on
       * the other owns two; the reverse reading loses a box they have.
       *
       * Afterwards this is an ordinary edit and the server's order decides,
       * because by then "I sold a pack" is a real thing to say.
       */
      if (options.firstMerge !== true) {
        return { kind: 'take', body: base };
      }
      const quantity = Math.max(asNumber(local.quantity, 1), asNumber(incoming.quantity, 1));
      return { kind: 'take', body: { ...base, quantity } };
    }

    case 'settings': {
      /*
       * Last-write-wins per key, except the dismissals, which union.
       *
       * A pack dismissed anywhere is dismissed: the notice has been read, and
       * showing it again on the other device because that one has not heard is
       * a worse answer than never showing it again.
       *
       * The per-key part is as far as it can honestly go here. There are no
       * per-key timestamps on the wire, so "per key" degrades to the whole
       * record for the other four — which is what the server would have done
       * anyway. The union is the part that is actually implemented, and it is
       * the part that matters.
       */
      return {
        kind: 'take',
        body: {
          ...base,
          dismissedPacks: union(asStringList(local.dismissedPacks), asStringList(incoming.dismissedPacks)),
        },
      };
    }

    case 'saved_decks': {
      /*
       * Two devices that both edited one imported deck.
       *
       * Nothing reconciles two card lists. Rather than pick a winner and drop
       * an evening's work, the incoming deck keeps the shared id and the local
       * one becomes a new deck: re-keyed to `local-<uuid>`, renamed, and marked
       * as locally edited so it uploads as itself.
       *
       * Only when both sides actually edited and the lists actually differ.
       * Two devices holding the same untouched import agreeing is the point of
       * a shared id, and forking that would litter the list.
       */
      const bothEdited = local.locallyEdited === true && incoming.locallyEdited === true;
      const slotsDiffer = String(local.slots ?? '') !== String(incoming.slots ?? '');
      if (!bothEdited || !slotsDiffer) {
        return { kind: 'take', body: base };
      }
      const newId = options.newId?.() ?? crypto.randomUUID();
      const forkedId = `local-${newId}`;
      const suffix = options.forkSuffix ?? ' (this device)';
      return {
        kind: 'fork',
        body: base,
        forkedId,
        forkedBody: {
          ...local,
          id: forkedId,
          kind: 'LOCAL',
          name: `${String(local.name ?? '')}${suffix}`,
          locallyEdited: true,
        },
      };
    }

    default:
      return { kind: 'take', body: base };
  }
}

/**
 * Whether a collection is union-merged on a first merge rather than reconciled.
 *
 * Exclusions and campaign events have nothing to compare: an entry exists or it
 * does not, and on a first merge the safe direction is keeping data. A wrongly
 * kept exclusion is one tap to remove; a wrongly dropped campaign is gone.
 */
export const UNION_ON_FIRST_MERGE: ReadonlySet<string> = new Set([
  'excluded_modular_sets',
  'excluded_scenarios',
  'campaign_events',
]);
