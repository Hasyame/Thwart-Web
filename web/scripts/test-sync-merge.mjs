/**
 * The merges the server does not know about.
 *
 * The server applies last-write-wins to whole records and never reads a body,
 * so each rule here lives in the client — and a client that skips one loses
 * what the other kept, silently. These assert the five refinements the Android
 * sync contract names, plus the tenth collection this client was missing.
 *
 *   npm run test:merge
 */
import {
  LOCAL_ONLY_FIELDS,
  UNION_ON_FIRST_MERGE,
  mergeBodies,
  withLocalOnlyFields,
} from '../src/lib/sync/merge.ts';
import { COLLECTIONS, SETTINGS } from '../src/lib/sync/collections.ts';

let failures = 0;
function check(label, ok, detail = '') {
  if (ok) {
    console.log(`ok    ${label}${detail ? `  (${detail})` : ''}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  }
}

// --- the collections ----------------------------------------------------------------

{
  const names = COLLECTIONS.map((collection) => collection.name).sort();
  // Ten are the contract with the phone. favourite_plays, ratings and
  // deck_folders are the web one release ahead: the server serves them only
  // to a client that names them (opt-in), so the phone's cursor is never
  // held by a record it cannot read. If this list ever gains a name without
  // the server's map and doc 08 knowing, this is the line that should make
  // somebody stop and check.
  const expected = [
    'campaign_events',
    'campaign_runs',
    'deck_folders',
    'excluded_modular_sets',
    'excluded_scenarios',
    'favourite_cards',
    'favourite_plays',
    'owned_packs',
    'plays',
    'randomizer_history',
    'ratings',
    'saved_decks',
    'settings',
  ];
  check(
    'every collection is synced, spelled as the contract spells them',
    names.length === expected.length && names.every((name, i) => name === expected[i]),
    names.join(', '),
  );

  const body = SETTINGS.bodyOf({
    id: 'app',
    cardLocale: 'fr',
    themeChoice: 'dark',
    playLocation: 'kitchen table',
    trackEncounter: true,
    dismissedPacks: ['core'],
    lastCardSync: 1700000000000,
  });
  check(
    'the settings body is exactly the five keys',
    Object.keys(body).sort().join(',') ===
      'cardLocale,dismissedPacks,playLocation,themeChoice,trackEncounter',
    Object.keys(body).sort().join(','),
  );
  check('and never carries lastCardSync', !('lastCardSync' in body));
  check('the settings id is literally app', SETTINGS.idOf({}) === 'app');
}

// --- a play reported to BoardGameGeek ----------------------------------------------

{
  /*
   * The only wrong merge whose effect leaves the app: a stale false over a true
   * makes the app believe the game was never reported, and the next report
   * posts a duplicate to somebody's real account.
   */
  const truthWins = mergeBodies('plays', { reportedToBgg: true }, { reportedToBgg: false });
  check('a local report survives an incoming false', truthWins.body.reportedToBgg === true);

  const other = mergeBodies('plays', { reportedToBgg: false }, { reportedToBgg: true });
  check('and an incoming report survives a local false', other.body.reportedToBgg === true);

  const neither = mergeBodies('plays', { reportedToBgg: false }, { reportedToBgg: false });
  check('two falses stay false', neither.body.reportedToBgg === false);
}

// --- when a card was starred --------------------------------------------------------

{
  const earlier = mergeBodies(
    'favourite_cards',
    { cardCode: '01001', addedAt: 100 },
    { cardCode: '01001', addedAt: 900 },
  );
  check('the earlier date wins from the local side', earlier.body.addedAt === 100);

  const incoming = mergeBodies(
    'favourite_cards',
    { cardCode: '01001', addedAt: 900 },
    { cardCode: '01001', addedAt: 100 },
  );
  check('and from the incoming side', incoming.body.addedAt === 100);
}

// --- when a game was starred ---------------------------------------------------------

{
  // The same rule as a card, and worth its own line: the day somebody first
  // starred a game must not move because a second device starred it later.
  const game = mergeBodies(
    'favourite_plays',
    { playId: 'p1', addedAt: 900 },
    { playId: 'p1', addedAt: 100 },
  );
  check('a starred game keeps the earlier date too', game.body.addedAt === 100);
  check('and its play id', game.body.playId === 'p1');
}

// --- the timer columns that never travel ---------------------------------------------

{
  /*
   * A running clock is a fact about the device somebody is holding. The columns
   * are absent from every body, so replacing a row wholesale would clear them —
   * which is a sync silently resetting a campaign's recorded time to nothing.
   */
  const local = {
    id: 'r1',
    name: 'Fear No Evil',
    timerAccumulatedMillis: 3_600_000,
    timerRunningSince: null,
    timerScenarioId: 's1',
  };
  const incoming = { id: 'r1', name: 'Fear No Evil (renamed)' };
  const merged = mergeBodies('campaign_runs', local, incoming);

  check('an incoming run does not clear the local clock', merged.body.timerAccumulatedMillis === 3_600_000);
  check('nor which scenario it was running', merged.body.timerScenarioId === 's1');
  check('while everything else is taken from the incoming record', merged.body.name === 'Fear No Evil (renamed)');
  check(
    'the rule is declared for campaign_runs and nothing else',
    Object.keys(LOCAL_ONLY_FIELDS).join(',') === 'campaign_runs',
  );
  check(
    'and it is applied on an ordinary pull, not only on a conflict',
    withLocalOnlyFields('campaign_runs', local, incoming).timerAccumulatedMillis === 3_600_000,
  );
  check(
    'with nothing to keep when the record is new here',
    withLocalOnlyFields('campaign_runs', null, incoming).timerAccumulatedMillis === undefined,
  );
}

// --- packs, on a first merge and after ------------------------------------------------

{
  const first = mergeBodies(
    'owned_packs',
    { packCode: 'core', quantity: 2 },
    { packCode: 'core', quantity: 1 },
    { firstMerge: true },
  );
  check('a first merge keeps the larger quantity', first.body.quantity === 2);

  const later = mergeBodies(
    'owned_packs',
    { packCode: 'core', quantity: 2 },
    { packCode: 'core', quantity: 1 },
  );
  check(
    'but afterwards a smaller quantity is a real edit',
    later.body.quantity === 1,
    'selling a pack has to be sayable',
  );
}

// --- settings ---------------------------------------------------------------------------

{
  const merged = mergeBodies(
    'settings',
    { themeChoice: 'dark', dismissedPacks: ['core', 'gob'] },
    { themeChoice: 'light', dismissedPacks: ['core', 'thor'] },
  );
  check(
    'a pack dismissed anywhere stays dismissed',
    ['core', 'gob', 'thor'].every((code) => merged.body.dismissedPacks.includes(code)),
    merged.body.dismissedPacks.join(','),
  );
  check('and the union does not duplicate', merged.body.dismissedPacks.length === 3);
  check('the other keys take the incoming record', merged.body.themeChoice === 'light');
}

// --- two devices that both edited one deck -------------------------------------------

{
  const local = {
    id: 'decklist-12345',
    name: 'Thor Aggression',
    slots: '01001=3,01002=2',
    locallyEdited: true,
  };
  const incoming = {
    id: 'decklist-12345',
    name: 'Thor Aggression',
    slots: '01001=3,01003=1',
    locallyEdited: true,
  };
  const forked = mergeBodies('saved_decks', local, incoming, {
    newId: () => 'fixed-uuid',
    forkSuffix: ' (this device)',
  });

  check('both edited and the lists differ, so it forks', forked.kind === 'fork');
  check('the incoming deck keeps the shared id', forked.body.slots === '01001=3,01003=1');
  check('the local one is re-keyed under local-', forked.forkedId === 'local-fixed-uuid');
  check('with its own slots intact', forked.forkedBody.slots === '01001=3,01002=2');
  check('renamed so the two are tellable apart', forked.forkedBody.name === 'Thor Aggression (this device)');
  check('and marked as a local deck so it uploads as itself', forked.forkedBody.kind === 'LOCAL');

  const untouched = mergeBodies(
    'saved_decks',
    { ...local, locallyEdited: false },
    { ...incoming, locallyEdited: false },
    { newId: () => 'fixed-uuid' },
  );
  check(
    'two untouched imports do not fork, which is the point of a shared id',
    untouched.kind === 'take',
  );

  const sameSlots = mergeBodies('saved_decks', local, { ...incoming, slots: local.slots }, {
    newId: () => 'fixed-uuid',
  });
  check('and neither do two edits that agree', sameSlots.kind === 'take');
}

// --- the union collections ---------------------------------------------------------------

{
  check(
    'exclusions and campaign events union on a first merge',
    UNION_ON_FIRST_MERGE.has('excluded_modular_sets') &&
      UNION_ON_FIRST_MERGE.has('excluded_scenarios') &&
      UNION_ON_FIRST_MERGE.has('campaign_events'),
  );
  check(
    'and plays are not among them, because a play is not a set membership',
    !UNION_ON_FIRST_MERGE.has('plays'),
  );
}

// --- anything without a rule ---------------------------------------------------------------

{
  const plain = mergeBodies('randomizer_history', { id: 'h1', beaten: true }, { id: 'h1', beaten: false });
  check('a collection with no refinement takes the incoming record', plain.body.beaten === false);
}

process.exit(failures === 0 ? 0 : 1);
