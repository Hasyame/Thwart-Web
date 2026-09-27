# Campaign rules and the current table

Status: accepted behavior, implemented and verified locally on 26 September 2026.
Owner decisions: 26 September 2026. Apply the supplied Rules Reference v1.8,
superseding v1.5, and correct the Age of Apocalypse campaign in both clients.
Use Arkham Cards' guided campaign journey as the presentation reference, with
Thwart's comic typography and accessible, reduced-motion-aware presentation.

## Rules and recorded choices

- Campaign difficulty and scenario difficulty are independent. A missing
  scenario choice retains the campaign's previous default. Standard and Expert
  encounter-set choices remain explicit and are preserved with the run.
- Setup order follows v1.8: scenario before campaign, then opening hand,
  mulligan and player setup. An opening ally counts toward hand size; expert
  AoA additionally requires a shared hero trait. The player chooses the ally.
- Four Horsemen are four simultaneous villains with independent damage and
  the logged random order. A/B faces follow scenario difficulty. The active
  marker changes only on a reported table action.
- Apocalypse starts at II, or III in expert. I remains an explicit easier
  variant. Regeneration heals the current stage and removes its printed HP
  numeral in threat, without automatically advancing the stage. Stage changes
  and the No Longer Worthy victory prerequisite are separate controls.
- En Sabah Nur's forms preserve damage within a stage. Advancing a stage
  resets damage. The Professor mission determines the campaign outcome even
  when the final villain was defeated.
- Expert healing is atomic, once per hero per attempt: known maximum health
  and three additional mission threat. Missing health data never becomes a
  sentinel HP value. Eliminated heroes have zero HP and earn no victory reward.
- Reward choices belong to individual heroes. Keep them outside the ordinary
  deck and its minimum-size calculation. Previously unrecorded choices require
  an explicit once-only selection; do not invent a historical choice.
- Mission inputs come from the physical table. Resource matching, ATK/THW
  totals, attack allocation and attempt counters can be calculated after those
  inputs. Unrevealed cards, choices, card responses and consequential damage
  remain explicit player actions. Card links support those actions.
- Gene Pool's extra initial threat is optional. Environment selection, mission
  progress and active markers are part of the saved table.

## Editable maxima

The owner clarified that "minimum" meant decreasing a maximum, not adding a
minimum floor. While the tracker is active, players can increase or decrease
each villain's maximum HP and each main-scheme track's maximum threat, including
simultaneous tracks. Values are positive integers for the whole table, after
player scaling. Starred values can be entered manually. Reset restores the
printed/scaled value, or the star when no number is printed.

Overrides affect only the current game. Preserve existing damage and threat
when changing a maximum. Save overrides with tracker progress and long breaks.
A new stage resets that stage's override; a form change keeps it. Reuse the
existing manual fields; no catalogue change or new Room column is required.
Copies of a main-scheme track share its limit, as they share its printed rule.

## Existing saves and presentation

Keep campaign logs append-only. Recognize the pinned original AoA template and
apply the correction when reading it; retain the stored snapshot and preserve
custom templates. Old sequential Horsemen/form tracker data requires explicit
review because missing simultaneous counts cannot be reconstructed.

The Web rules dialog opens over the current game and closes back to the same
table. Narrative text is an original summary with booklet page references,
not a bundled copy of the campaign comic. Both languages receive contextual
card links and v1.8 text corrections; card images can still show older printings.

## Verification scope

Regression coverage includes finale/undo, 1–4 players, both scenario modes,
form/stage transitions, healing/retry, elimination/rewards, mission calculations,
recognized/custom template upgrades and saved maximum overrides. Web checks,
test scripts, production build and mobile/desktop flows passed. Android unit
tests, lint and debug assembly passed in an isolated checkout preserving
unrelated work; emulator checks covered both languages and saved maxima.
Four optional Android tests lacked their external backup or catalogue-seed
prerequisites. No physical-device or production-release certification is implied.


## Campaign experience acceptance criteria (27 September 2026)

The owner reconfirmed these as requirements for the campaign journey, not optional
presentation ideas. A campaign guide should replace routine consultation of the
rulebook and campaign booklet. Describe physical setup in actionable detail, in
rules order, with contextual card images and readable localized card text. Avoid
acknowledgment checklists; use a resumable guided sequence and allow revisiting a
step without repeating draws or effects.

The application maintains the campaign log from relevant player answers. Reuse
known information instead of asking again. Automatically derive eligible draws,
removed cards, setup quantities, persistent damage, consequences, rewards and the
next scenario wherever the rules and recorded inputs determine them. Ask only for
physical-table outcomes or genuine player choices. Show the consequences before
confirming a result, and preserve the existing append-only log and undo semantics.

Story, setup, card references, rules, tracker, timer, outcome questions and the next
chapter belong to one coherent journey. Returning from a reference must preserve
the current step and table. Narrative reveals and visible campaign progress should
make continuing appealing, using the agreed comic visual language and respecting
reduced motion. Physical-table inputs must not be invented for automation.

These are acceptance criteria, not a declaration of full implementation. The local
Four Horsemen design preview now demonstrates detailed guided setup, contextual
cards, stable example draws, a local example register and timer. It is separate
from real campaign saves; complete next-chapter preparation and reward allocation
still require application integration. Existing client engines already provide
parts of the required event log, rules and tracker behavior; verify coverage per
campaign rather than counting explanatory prototype text as automation.

## Shared scenario interaction requirements (27 September 2026)

The owner explicitly extended the approved prototype interaction patterns to all
other scenarios. This is a shared Web/Android requirement, not a Four Horsemen
exception. Reuse common presentation and controls while keeping scenario-specific
setup, tracks, forms, phases, questions and consequences faithful to their rules.

- All card references, including outcome questions, summaries and tracker titles,
  open a contextual image and localized readable text. Keep two-way navigation
  between linked faces and return to the same game state when closing the preview.
- Optimize for touch. Use large explicit Yes/No choices for binary outcome answers,
  retain unanswered as a distinct state, show selection clearly, and separate
  summaries from the following action with adequate spacing.
- Use the relevant villain artwork as a blurred, darkened tracker background with
  legible foreground text and an accessible fallback when artwork is unavailable.
- Provide brief damage/healing feedback. Accumulate rapid same-direction changes
  per track, restarting the displayed burst after a pause or direction change.
  Show actual applied changes, preserve counter limits, and respect reduced motion.
- Provide a distinct long-pause action that saves the complete current table,
  preparation position, choices, timer and campaign context. Exclude time spent
  in that pause and resume explicitly without repeating draws or effects.
- Allow editing elapsed hours, minutes and seconds without changing the game or
  starting a paused timer. Durations exceeding 24 hours must not wrap around.
- Guide the player from story through preparation, play, result questions and
  the next chapter. Derive subsequent setup from the recorded answers.

Implementation status: the local Four Horsemen prototype demonstrates these
interactions. This extension records required scope; it does not assert that all
scenarios or either production client already implement the complete experience.


## Approved integration scope (27 September 2026, latest owner instruction)

The owner approved the prototype and then narrowed the implementation to the
reviewed Age of Apocalypse campaign and its five scenarios, on Web and Android.
This supersedes the earlier request to apply it to all other scenarios for the
current implementation. Leave other campaigns on their existing presentation.
The broader patterns above remain design references, not authorization to roll
them out to other campaign templates in this task.

## Integration and release verification (27 September 2026)

The real AoA campaign screens now use a six-part resumable preparation guide,
illustrated villain counters with cumulative HP feedback, explicit binary
outcome answers and an hours/minutes/seconds clock editor. They reuse the
audited campaign engine, card previews, mission calculator and persistent log.
The Web clock can be paused without leaving the table. Its long-break flow
preserves the edited time, damage and maximum overrides.

Web verification passed all test scripts, zero Svelte diagnostics and the
production build. Browser checks covered all five AoA scenarios, mobile
overflow, recovery, rules return, precise time editing and long breaks.
Red Skull retained its original briefing and tracker in a browser check.
Android unit tests, lint and debug assembly also passed; emulator checks
covered the illustrated tracker and precise clock dialog. A final touch-layout
adjustment is being verified separately before Android is delivered.

The owner authorized production publication of Web only. Android remains local.

## Compact AoA table (27 September 2026)

The campaign hub owns chapter progress; hide its repeated journey strip throughout
the AoA scenario, including preparation and results as reconfirmed by the owner.
Keep scenario artwork in the header, a tappable clock with a modal editor,
and a short Pause label. Setup explicitly places the scenario and villain HP
before the encounter deck. The opening ally choice precedes expert campaign
health and paid healing, matching the AoA booklet.

On phones, open a compact table showing the main scheme and all simultaneous
villains together. Keep 44px counter controls, timer, options and a single finish
action. Options return to the full rules, mission and saved-break controls.
Use darkened artwork for the scheme as well as villains. Rapid threat changes
accumulate just like HP changes. A zero-HP Horseman is Down until all are at zero;
only then is the defeated stamp appropriate.

Acceleration is an explicit persistent total adjusted with minus/plus one.
Starting the villain phase adds printed per-player growth plus this total once,
not once per player. It does not automate villain activations or encounter cards.
Optional encounter progress fields default to zero and survive local saved tables.
The Web implementation is limited to AoA presentation; other campaigns retain
existing controls. Android publication is not authorized for this update.

At a scheme threshold, show its specific consequence: review the next stage's
front-side instructions before advancing, or show a defeat stamp for a terminal
scheme. Apocalypse's villain-stage interruption remains a separate progression.
Do not automatically record a loss from a counter; accidental entries remain
correctable. Victory and defeat have equal neutral initial styling.
