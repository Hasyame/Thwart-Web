# Campaigns — what a template may say, and what the web makes of it

The campaign templates are the Android app's (`app/src/main/assets/campaigns/`
in Hasyame/Thwart) and the web fetches them at build time (`npm run
campaigns`), so a campaign corrected on the phone reads the same here on the
next build. The vocabulary is `web/src/lib/campaign/types.ts`, field for field
as the app declares it; the fold is `web/src/lib/campaign/engine.ts`. This
document records the rules that are not obvious from either, and the reading
of a campaign book that settled them. Android is the master of the template.

**Status.** Written 2026-09-12, when the web was brought to Android 1.51.0
(commit 494c166, "Fear No Evil, checked against the English rulebook").

---

## 1. Next steps

An outcome's `next` is a guarded list read in order; the first step whose
`when` holds is the one taken, and a step with no `when` always holds. A step
says one of four things:

| Step | Meaning |
|---|---|
| `goto: <scenarioId>` | That scenario is current next. The same id as the one just played is a replay. |
| `choose: true` | Nothing is current; the players pick from what is still choosable. |
| `end: true` | The campaign is over, as a finish. |
| `lose: true` | The campaign is over, as a defeat: `campaignLost` and `finished` are both set, and nothing is awaited. |

`lose` exists because Fear No Evil's finale on Expert can run out of
environments to sacrifice (§3.3); before it, the only way a campaign could be
lost was `losesWhenScenarioFails` or conceding. A `lose` step behind a guard
that does not hold is skipped like any other. A list that matches nothing
leaves the scenario current, which is what a template with no `next` at all
means.

## 2. Defeats

A defeat is filed like a victory — a `scenario_result` with `victory: false` —
and resolved by the scenario's `onDefeat`: its prompts are asked, its effects
applied, its `next` taken. The defeat page then offers:

- **Retry**, always: the same scenario, clock from zero, nothing appended.
- **Continue**, when the campaign says what moving on costs (`onContinue`,
  applied on a `continued` event) *or* when moving on costs nothing and the
  next step is the players' choice (`choose: true`). A defeat that leads
  somewhere by `goto` needs no button: the campaign has already moved.

When continuing settles nothing — no `onContinue`, a `choose` next — the page
says so under the button: the scenario is not failed, it stays open, against
the same villain. The word "continue" on a defeat page otherwise reads as
giving the scenario up.

Every effect on a defeat is applied as on a victory, including
`setHeroCounter ... from: "hpPerHero"`, capped at the hero's printed health
where the counter says `maxFrom: "heroCard.health"`. The web reads printed
health from the card database when the run opens; until the cards arrive the
fold runs uncapped and re-runs once they do.

## 3. Fear No Evil (`fne`)

The English rulebook (FFG mc60, 2026) is the reference; the template's
English titles are its.

### 3.1 A lost scenario is not a failed one

Rulebook p.8: losing a scenario does not automatically cause it to fail, and it
may be attempted again. The five scenarios' `onDefeat` therefore carries no
`onContinue` and no Failed flag: the scenario stays choosable, against the same
Underling (the villain assignment is kept once made), and its environment goes
on neither face. What fails a scenario is **three pressure marks** —
`failedWhen: pressure ≥ 3 or echoue.<scenario>` — and on Standard a defeat
adds none. On Expert a defeat adds one mark (`addCounter`, capped at 3), so
three Expert defeats fail the job; a failed job is off the list and the
campaign goes on (`losesWhenScenarioFails: false`).

### 3.2 The recommended villain order

The book's list is Hammerhead, Bullseye, Electro, then "Purple Man or Typhoid
Mary": one line for two villains. Under the recommended order the app takes
the first three in order and, while both of the last two are still
unassigned, draws between them; the one not drawn is the fifth. Any other
answer to the order question draws at random throughout.

### 3.3 The Kingpin defeat

On Standard, a defeat against Kingpin is simply replayed (`goto: s6_caid`).

On Expert, the defeat asks, for each environment on its Completed face,
whether to flip it to Failed (`flip_<scenario>` booleans, each shown only while
`acheve.<scenario>` holds). A flip clears `acheve.<scenario>`, sets
`echoue.<scenario>`, and the finale is replayed. With no Completed environment
left to flip, the next defeat takes the `lose` step: the campaign is lost. So
on Expert a table has at most five Kingpin defeats to give before the sixth
ends the campaign; a Completed count that Kingpin's own setup reads
(`compute: { flagSet: "acheve" }`) goes down with each sacrifice.

### 3.4 Not played again from the history

A campaign's scenario is logged as a play under the campaign's own scenario
id (`s1_musee`), not a card set. The history offers no "play again" on it: a
campaign's scenario is played again from its own campaign. It may still be
starred. The ratings, which do need to know which card set such a play was,
resolve it through the run's template (`web/src/lib/ratings.ts`
`campaignLayoutOf`).

---

## 4. Tests

- `npm run test:engine` — the fold on a hand-built template: `end`, `lose`, a
  guarded `lose` that does not hold, a `choose` defeat that leaves the table
  choosing and a `continued` that applies nothing.
- `npm run test:fne` — the shipped Fear No Evil template played through, the
  way the phone's `FearNoEvilCampaignTest` does: §3.1 on both difficulties,
  §3.3 flip by flip to the lost campaign, the defeat's questions while their
  `when` holds, hit points carried over from a defeat and capped.
- `npm run test:deal` — §3.2 over ten seeded campaigns.
- `npm run test:replay`, `npm run test:ratings` — §3.4.
