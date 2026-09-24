/*
 * Fear No Evil's own ids, as real cards.
 *
 * The campaign template (shared with the Android app, not edited here) names
 * its jobs' environments `{card:s1_musee}` and its villains
 * `fne_villain_electro`, because no card database carried the box's
 * encounter cards when it was written. They are imported from MC4DB now
 * (scripts/fetch-cards.mjs), so each id maps to its card: a job to its
 * environment (the five `campaign` set environments, in job order, A side),
 * a villain to its set's first villain card, the finale to Kingpin. Built
 * from the index, so nothing here names a card number.
 */
const FNE_VILLAIN_SETS: Readonly<Record<string, string>> = {
  fne_villain_hammerhead: 'hammerhead',
  fne_villain_bullseye: 'bullseye',
  fne_villain_electro: 'electro',
  fne_villain_homme_pourpre: 'purple_man',
  fne_villain_mary_typhoide: 'typhoid_mary',
  s6_caid: 'kingpin',
};
const FNE_JOBS = ['s1_musee', 's2_poursuite', 's3_racket', 's4_raft', 's5_rotatives'] as const;

export function fneCardAliases(
  index: readonly { code: string; packCode: string; setCode: string | null; typeCode: string }[],
): Map<string, string> {
  const out = new Map<string, string>();
  const fne = index.filter((row) => row.packCode === 'fne').sort((a, b) => a.code.localeCompare(b.code));
  for (const [id, set] of Object.entries(FNE_VILLAIN_SETS)) {
    const villain = fne.find((row) => row.setCode === set && row.typeCode === 'villain');
    if (villain !== undefined) {
      out.set(id, villain.code);
    }
  }
  const environments = fne.filter(
    (row) => row.setCode === 'campaign' && row.typeCode === 'environment' && !row.code.endsWith('b'),
  );
  FNE_JOBS.forEach((id, i) => {
    const card = environments[i];
    if (card !== undefined) {
      out.set(id, card.code);
    }
  });
  return out;
}
