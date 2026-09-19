import type { IndexRow } from '../types';
import { cardImageUrl } from '../data';
import { boxArtOf } from '../campaignTile';
import { scenarioFaceOf } from '../scenarioFace';
import { FNE_TEMPLATE_ID } from '../fearNoEvil';
import type { AchievementDefinition, Catalogue } from './types';

/**
 * A small picture for each achievement, the way a store shows a badge.
 *
 * Nothing is drawn for this: the picture is a card's art on MarvelCDB — a
 * hero for what is about heroes, a villain for what is about scenarios —
 * or Fear No Evil's bundled cover. A box achievement takes the face of the
 * box's first scenario; a hero-flavoured one takes a hero of the Core Set.
 * Two achievements may share a picture; the title beside it tells them
 * apart, and a badge is a decoration, not an identifier.
 */

/** Hero card codes, by what the achievement is about. Core Set heroes: everybody has them. */
const HERO_BY_ID: Readonly<Record<string, string>> = {
  win_with_every_hero_core: '01001a',
  win_with_every_hero: '01010a',
  win_all_aspects: '04031a',
  plays_count: '01010a',
  wins_count: '01019a',
  heroes_played: '01029a',
  distinct_days: '01040a',
  true_solo_win: '01001a',
  two_player_win: '01010a',
  three_player_win: '01019a',
  four_player_win: '01029a',
  four_player_four_aspects: '04031a',
  draft_win: '05001a',
  draft_wins_5: '04031a',
  draft_wins_10: '01029a',
  draft_wins_50: '21031a',
  sealed_win: '04001a',
  sealed_wins_5: '16029a',
  sealed_wins_10: '01040a',
  sealed_wins_50: '09001a',
  losses_1: '01001a',
  losses_5: '05001a',
  losses_10: '35001a',
  losses_50: '34001a',
  losses_100: '03001a',
};

/** Scenario keys, for the achievements about beating something. */
const SCENARIO_BY_ID: Readonly<Record<string, string>> = {
  beat_every_scenario: 'ultron',
  beat_every_scenario_expert: 'ultron',
  beat_every_scenario_core_expert: 'klaw',
  rhino_all_aspects: 'rhino',
  first_expert_win: 'klaw',
  finish_campaign: 'crossbones',
  finish_campaign_no_defeat: 'absorbing_man',
  finish_campaign_expert: 'red_skull',
};

export function achievementArt(
  definition: AchievementDefinition,
  index: readonly IndexRow[],
  catalogue: Catalogue | null,
): string | null {
  const hero = HERO_BY_ID[definition.id];
  if (hero !== undefined) {
    return cardImageUrl(index.find((row) => row.code === hero)?.img);
  }
  let scenario = SCENARIO_BY_ID[definition.id];
  const p = definition.predicate;
  if (scenario === undefined && (p.kind === 'scenarios_won' || p.kind === 'heroes_won') && p.pack !== '*') {
    if (p.pack === FNE_TEMPLATE_ID) {
      return boxArtOf(FNE_TEMPLATE_ID);
    }
    scenario = catalogue?.scenarios.find((s) => s.packCode === p.pack)?.key;
  }
  if (scenario === undefined && p.kind === 'aspects_won' && p.scenario !== undefined) {
    scenario = p.scenario;
  }
  if (scenario !== undefined) {
    return cardImageUrl(scenarioFaceOf(index, scenario)?.img);
  }
  return cardImageUrl(index.find((row) => row.code === '01001a')?.img);
}
