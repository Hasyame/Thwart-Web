import type { IndexRow } from './types';

/**
 * The card that stands for a scenario: its villain.
 *
 * A scenario's code is the code of its card set on MarvelCDB, and the set's
 * first villain — stage I, in the order the file holds them — is the face
 * everybody knows it by. Civil War's leaders sit in the villain's place, and
 * a scenario with no villain at all (Wrecking Crew, the Morlock Siege) shows
 * its main scheme instead. Nothing is re-hosted: the row carries the picture's
 * path on MarvelCDB, written into the index by the fetch for exactly this.
 */
export function scenarioFaceOf(index: readonly IndexRow[], scenarioCode: string): IndexRow | null {
  if (scenarioCode === '') {
    return null;
  }
  // A villain with a picture beats one without, whatever the stage: the
  // newest boxes reach MarvelCDB with some cards' art still missing.
  let villain: IndexRow | null = null;
  let scheme: IndexRow | null = null;
  for (const row of index) {
    if (row.setCode !== scenarioCode) {
      continue;
    }
    if (row.typeCode === 'villain' || row.typeCode === 'leader') {
      if (row.img !== undefined) {
        return row;
      }
      villain ??= row;
    } else if (row.typeCode === 'main_scheme' && (scheme === null || (scheme.img === undefined && row.img !== undefined))) {
      scheme = row;
    }
  }
  return scheme?.img !== undefined && villain?.img === undefined ? scheme : (villain ?? scheme);
}
