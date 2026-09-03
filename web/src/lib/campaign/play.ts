import type { Play, PlayHero, SavedDeck } from '../records';
import type { CampaignState, ScenarioTemplate } from './types';
import { textOf } from './types';
import type { Locale } from '../types';

/**
 * A campaign scenario, written into the play history like any other game.
 *
 * A lost scenario is still a game that was played, so it counts towards win
 * rates the same way. Field for field as `recordScenarioPlay` writes it, which
 * is what lets the statistics screen count campaign and one-off games together
 * without knowing the difference — `campaignRunId` is the only thing that tells
 * them apart, and it is what the campaign list reads.
 */
export interface CampaignPlayInput {
  readonly runId: string;
  readonly scenario: ScenarioTemplate | null;
  readonly scenarioId: string;
  readonly campaign: CampaignState;
  readonly decks: readonly SavedDeck[];
  readonly locale: Locale;
  readonly won: boolean;
  readonly elapsedMillis: number;
  readonly victoryPoints: number;
}

export function buildCampaignPlay(input: CampaignPlayInput): Play {
  const roster: PlayHero[] = input.campaign.heroes.map((hero) => {
    const deck = input.decks.find((candidate) => candidate.id === hero.deckId);
    return {
      code: hero.heroCardCode,
      name: hero.name,
      aspect: (deck?.aspects ?? '').split(',').filter((a) => a !== '').join(', '),
    };
  });

  const aspects = [
    ...new Set(
      roster
        .flatMap((seat) => seat.aspect.split(','))
        .map((aspect) => aspect.trim())
        .filter((aspect) => aspect !== ''),
    ),
  ];

  const first = roster[0];

  return {
    id: crypto.randomUUID(),
    playedAt: Date.now(),
    scenarioCode: input.scenarioId,
    // The campaign's own name for the scenario, resolved now, so the history
    // stays readable if the template later changes.
    scenarioName: textOf(input.scenario?.name, input.locale) || input.scenarioId,
    difficulty: input.campaign.difficulty,
    standardSet: '',
    heroCode: first?.code ?? '',
    heroName: first?.name ?? '',
    aspects: aspects.join(', '),
    otherHeroes: roster.slice(1).map((seat) => seat.name).join(', '),
    roster,
    players: Math.max(1, roster.length),
    won: input.won,
    elapsedMillis: input.elapsedMillis,
    notes: '',
    location: '',
    victoryPoints: input.victoryPoints,
    campaignRunId: input.runId,
    reportedToBgg: false,
    photos: '',
  };
}
