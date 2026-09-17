import type { EncounterSetup, EncounterSide } from './encounter';
import { evaluate } from './campaign/conditions';
import { VILLAIN_DRAW_ID } from './campaign/deal';
import { loadTemplate } from './campaign/store';
import {
  EMPTY_STATE,
  textOf,
  type CampaignTemplate,
  type LocalizedText,
  type SetupStep,
  type TrackedSide,
} from './campaign/types';
import type { Locale } from './types';

/**
 * Fear No Evil's scenarios, played on their own.
 *
 * The box's five jobs pair with whichever of its five subordinates is drawn
 * at the table; the finale is Kingpin himself. None of it is on MarvelCDB,
 * so the scenarios come from the campaign template rather than the card
 * database, and a one-off game names its scenario with a code of this
 * shape rather than a card set:
 *
 *   fne_s1_musee                        a job, villain still to draw
 *   fne_s1_musee__fne_villain_electro   the job with its villain
 *   fne_s6_caid                         the finale, whose villain is fixed
 *
 * The same shape the versus scenarios use for their two halves, so a play,
 * a replay and the history carry it without a column of their own. Android
 * is the reference (`domain/play/FearNoEvil.kt`, `FearNoEvilBox.kt`), and a
 * game recorded on one client reads on the other.
 *
 * docs/spec/fear-no-evil-one-off.md
 */

export const FNE_TEMPLATE_ID = 'fne';

/** Every code of the family starts with this. */
export const FNE_PREFIX = 'fne_';

/** Between the job and the villain, as the versus scenarios do it. */
const SEPARATOR = '__';

export const isFne = (code: string | null | undefined): boolean =>
  code !== null && code !== undefined && code.startsWith(FNE_PREFIX);

/** The one-off code of a template scenario: `s1_musee` becomes `fne_s1_musee`. */
export const fneCodeOf = (scenarioId: string): string => FNE_PREFIX + scenarioId;

export const composeFne = (jobCode: string, villainId: string): string =>
  jobCode + SEPARATOR + villainId;

/**
 * The job's code and, when one has been drawn, the villain's id.
 *
 * Any other code comes back whole: the versus scenarios join their halves
 * with the same separator, and they are not jobs.
 */
export function splitFne(code: string): { readonly job: string; readonly villain: string | null } {
  const at = isFne(code) ? code.indexOf(SEPARATOR) : -1;
  return at < 0
    ? { job: code, villain: null }
    : { job: code.slice(0, at), villain: code.slice(at + SEPARATOR.length) };
}

/** The template's scenario id, `s1_musee`, from either form of the code. */
export const fneScenarioIdOf = (code: string): string =>
  splitFne(code).job.slice(FNE_PREFIX.length);

/** A job with no villain on it yet: the table still has to draw one. */
export function needsVillain(
  code: string | null | undefined,
  villainChoices: Readonly<Record<string, readonly string[]>>,
): boolean {
  if (code === null || code === undefined || !isFne(code) || splitFne(code).villain !== null) {
    return false;
  }
  return (villainChoices[code] ?? []).length > 0;
}

/** One of the box's scenarios, as a one-off game offers it. */
export interface FneScenario {
  /** The one-off code, `fne_s1_musee`. */
  readonly code: string;
  readonly name: string;
  /** True for a job, which pairs with a subordinate; false for the finale. */
  readonly needsVillain: boolean;
}

/** One of the box's subordinates. */
export interface FneVillain {
  readonly id: string;
  readonly name: string;
}

/** `{villain}` and `{card:x}`, the two things the template writes into its prose. */
const PLACEHOLDER = /\{(card:)?([A-Za-z0-9_]+)\}/g;

/**
 * Fear No Evil's box, read for a game outside the campaign.
 *
 * The box is on no card database, so everything a one-off game needs is
 * read from the campaign template: the jobs and the finale, the five
 * subordinates a job is played against, the numbers the tracker counts,
 * and the setup text of the briefing. Pure, so a test can read the bundled
 * template and check every answer. A port of Android's `FearNoEvilBox`.
 */
export class FearNoEvilBox {
  constructor(private readonly template: CampaignTemplate) {}

  get packCode(): string | null {
    return this.template.packCode ?? null;
  }

  /** Every scenario of the box, jobs and finale, in the template's order. */
  scenarios(locale: Locale): FneScenario[] {
    const fixed = new Set(Object.keys(this.template.tracker?.villains ?? {}));
    return (this.template.scenarios ?? []).map((scenario) => ({
      code: fneCodeOf(scenario.id),
      name: nonBlank(textOf(scenario.name, locale)) ?? scenario.id,
      // A scenario the tracker names a villain for is its own, as Kingpin
      // is; every other one is played against a subordinate.
      needsVillain: !fixed.has(scenario.id),
    }));
  }

  /** The subordinates a job can be played against. */
  villains(locale: Locale): FneVillain[] {
    return (this.template.villainPool ?? []).map((id) => ({ id, name: this.cardName(id, locale) }));
  }

  /**
   * Every code a one-off game can carry, with its name: each scenario on
   * its own, and each job with each subordinate, "Art Museum Heist :
   * Electro", as the versus scenarios name their two halves.
   */
  names(locale: Locale): Map<string, string> {
    const villains = this.villains(locale);
    const out = new Map<string, string>();
    for (const scenario of this.scenarios(locale)) {
      out.set(scenario.code, scenario.name);
      if (scenario.needsVillain) {
        for (const villain of villains) {
          out.set(composeFne(scenario.code, villain.id), `${scenario.name} : ${villain.name}`);
        }
      }
    }
    return out;
  }

  /**
   * The tracker's numbers for a one-off game: the villain's stages for the
   * difficulty, and the scenario's main scheme. Nothing when the code
   * names a job without its villain, since there is nothing to count yet.
   */
  encounterSetup(code: string, players: number, expert: boolean, locale: Locale): EncounterSetup {
    const seats = Math.max(1, players);
    const tracker = this.template.tracker;
    if (tracker === undefined || tracker === null) {
      return { villain: [], scheme: [], players: seats };
    }
    const { villain } = splitFne(code);
    const scenarioId = fneScenarioIdOf(code);
    const wanted = expert ? 'expert' : 'standard';
    const forThisGame = (sides: readonly TrackedSide[] | undefined): readonly TrackedSide[] =>
      (sides ?? []).filter((side) => side.onlyOn == null || side.onlyOn.toLowerCase() === wanted);
    const stages = forThisGame(
      (villain === null ? undefined : tracker.villains?.[villain]) ?? tracker.villains?.[scenarioId],
    );
    const scheme = forThisGame(tracker.schemes?.[scenarioId]);
    // The tracker writes its names in French; the villain's is known in
    // both languages, so it is written in the reader's.
    const villainName = villain === null ? null : this.cardName(villain, locale);
    return {
      villain: stages.map((tracked) => ({
        ...side(tracked),
        ...(villainName === null ? {} : { name: villainName }),
      })),
      scheme: scheme.map((tracked) => ({ stage: tracked.stage ?? '', options: [side(tracked)] })),
      players: seats,
      schemeCopies: (tracker.perPlayerSchemes ?? []).includes(scenarioId) ? seats : 1,
    };
  }

  /**
   * The scenario's setup, as the campaign briefs it, for the game's own
   * briefing: the steps that hold for this difficulty and this villain,
   * with the villain's and the cards' names written in. The campaign's
   * pressure and its records are not part of a one-off game, so nothing
   * is added on top of what the cards print, and the step about the
   * job's environment card is left out: that card is the campaign's
   * pressure board, turned over between jobs, and a game on its own has
   * no use for it.
   */
  briefing(code: string, expert: boolean, locale: Locale): string[] {
    const { villain } = splitFne(code);
    const scenarioId = fneScenarioIdOf(code);
    const scenario = (this.template.scenarios ?? []).find((s) => s.id === scenarioId);
    if (scenario === undefined) {
      return [];
    }
    // A campaign state with only what a one-off game knows: the difficulty,
    // and the villain, as the draw the template reads.
    const state = {
      ...EMPTY_STATE,
      templateId: this.template.id,
      difficulty: expert ? 'expert' : 'standard',
      draws: villain === null ? {} : { [scenarioId]: { [VILLAIN_DRAW_ID]: [villain] } },
    };
    const context = { state, scenarioId };
    // The environment card shares the scenario's id, which is how the step
    // about it is told from the rest.
    const environment = `{card:${scenarioId}}`;
    const mentionsEnvironment = (text: LocalizedText | undefined): boolean =>
      [text?.en, text?.fr].some((t) => t !== null && t !== undefined && t.includes(environment));
    const fragments = this.template.setupFragments ?? {};
    return (scenario.preSetup ?? [])
      .flatMap((step): readonly SetupStep[] =>
        step.include != null ? (fragments[step.include] ?? []) : [step],
      )
      .filter((step) => step.draw == null && evaluate(step.when, context))
      .filter((step) => !mentionsEnvironment(step.text))
      .map((step) => this.fill(textOf(step.text, locale), villain, locale))
      .filter((line) => line !== '');
  }

  /** `{villain}` and `{card:x}` as names, in the reader's language. */
  private fill(text: string, villain: string | null, locale: Locale): string {
    return text
      .replace(PLACEHOLDER, (_match, cardPrefix: string | undefined, name: string) => {
        if (cardPrefix !== undefined) {
          return `"${this.cardName(name, locale)}"`;
        }
        if (name === VILLAIN_DRAW_ID && villain !== null) {
          return `"${this.cardName(villain, locale)}"`;
        }
        return '';
      })
      .replace(/ {2}/g, ' ')
      .trim();
  }

  /** A card the template names itself, since the database does not know it. */
  private cardName(id: string, locale: Locale): string {
    return nonBlank(textOf(this.template.localCardNames?.[id], locale)) ?? id;
  }
}

const nonBlank = (text: string): string | null => (text.trim() === '' ? null : text);

/** As the campaign counts it, with nothing carried over from earlier jobs. */
const side = (tracked: TrackedSide): EncounterSide => ({
  name: tracked.name,
  stage: tracked.stage ?? '',
  value: tracked.value == null ? null : Math.max(0, tracked.value),
  perPlayer: tracked.perPlayer ?? true,
  starred: tracked.starred === true,
  startingThreat: Math.max(0, tracked.startingThreat ?? 0),
  startingThreatPerPlayer: tracked.startingThreatPerPlayer ?? true,
  escalation: Math.max(0, tracked.escalation ?? 0),
  escalationPerPlayer: tracked.escalationPerPlayer === true,
  escalationVariable: tracked.escalationVariable === true,
});

let boxPromise: Promise<FearNoEvilBox | null> | null = null;

/**
 * The box as the bundled template describes it, fetched once and kept.
 *
 * Null when the template cannot be read — offline before it was ever
 * cached — and then the box's scenarios are simply not offered, which is
 * the same as not owning it.
 */
export function loadFneBox(): Promise<FearNoEvilBox | null> {
  boxPromise ??= loadTemplate(FNE_TEMPLATE_ID)
    .then((template) => new FearNoEvilBox(template))
    .catch(() => {
      boxPromise = null;
      return null;
    });
  return boxPromise;
}
