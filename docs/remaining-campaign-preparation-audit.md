# Remaining campaign preparation audit

Reviewed 2026-10-25. Scope: the Web guides for the 30 scenarios in Galaxy’s
Most Wanted, The Mad Titan’s Shadow, Sinister Motives, Mutant Genesis,
Next Evolution and Agents of S.H.I.E.L.D. This does not migrate Android data,
rewrite saved campaign events, or change the production API.

## Sources and precedence

Use Rules Reference 1.8, page 51 (setup order) and pages 66–67 (campaign errata),
then the relevant campaign booklet and initial scheme/villain cards. Scenario
difficulty and campaign difficulty are independent. A card’s “expert mode” follows
scenario difficulty; “Expert Campaign Only” follows campaign difficulty.

Booklets reviewed, with printed scenario pages:

| Booklet | Scenario pages | Source |
| --- | --- | --- |
| Galaxy’s Most Wanted | 8, 10, 12, 14, 18 | [FFG PDF](https://images-cdn.fantasyflightgames.com/filer_public/dd/86/dd86a2b4-4501-4435-8504-c4ac9df25a99/mc16_galaxys_most_wanted_rules_website-compressed.pdf) |
| The Mad Titan’s Shadow | 6, 10, 16, 20, 24 | [FFG PDF](https://images-cdn.fantasyflightgames.com/filer_public/a7/e4/a7e4f10e-286f-4a8a-b90d-feb052a286a2/mc21_the_mad_titans_shadow_rulebook-compressed.pdf) |
| Sinister Motives | 9, 11, 13, 15, 17; reputation chart 22–23 | [FFG PDF](https://images-cdn.fantasyflightgames.com/filer_public/77/cc/77cc5a70-52d8-4542-8588-aba3d6aa07bd/mc27_sinister_motives_rules_v5-compressed.pdf) |
| Mutant Genesis | 7, 9, 12, 15, 18 | [FFG PDF](https://images-cdn.fantasyflightgames.com/filer_public/2c/52/2c52bcb0-4e21-4bf8-8052-b2ef41266737/mc32_mutant_genesis_rulebook_v5-compressed.pdf) |
| Next Evolution | 9, 11, 14, 16, 18 | [FFG PDF](https://images-cdn.fantasyflightgames.com/filer_public/73/e2/73e23a2b-3f2a-4173-8fee-cf0073ab11c8/mc40_next_evolution_rulebook-web.pdf) |
| Agents of S.H.I.E.L.D. | 9, 11, 13, 15, 18; evidence 5–6 | [FFG PDF](https://images-cdn.fantasyflightgames.com/filer_public/79/12/7912adc3-2461-4ea2-8606-4715880b8d1d/mc50_rulebook-web.pdf) |

The FFG CDN returned intermittent 503 responses. The publisher booklets were
also read from the Hall of Heroes mirrors: [GMW](https://hallofheroeslcg.com/wp-content/uploads/2021/07/mc16_galaxys_most_wanted_rules_website-compressed.pdf),
[MTS](https://hallofheroeslcg.com/wp-content/uploads/2021/08/mad-titans-shadow-insert-compressed.pdf),
[SM](https://hallofheroeslcg.com/wp-content/uploads/2022/04/sm.pdf),
[MG](https://hallofheroeslcg.com/wp-content/uploads/2022/10/mutant-genesis-rulebook.pdf),
[Next](https://hallofheroeslcg.com/wp-content/uploads/2023/08/mc40_next_evolution_rulebook-compressed.pdf),
[AOS](https://hallofheroeslcg.com/wp-content/uploads/2025/03/mc50_rulebook.pdf).
The MTS scan requires visual reading; the other booklets have extractable text.
PDFs, extracted text and rendered source pages remain outside the repository.

Card text is resolved at runtime from the existing card catalogue. No card text
dump is committed here. French catalogue entries that remain untranslated retain
their source language; the guide’s added instructions are bilingual.

## Shared order

1. Prepare identities, starting health, first player, obligations, nemesis sets,
   tokens and player decks. Show retained deck cards and previews of cards needed
   later. A preview never performs a campaign action or random draw.
2. Gather the selected villain stages, main schemes and encounter sets. Reserve
   special decks. Set villain health before constructing the encounter deck.
3. Resolve encounter Setup keywords and scenario setup: initial A side, initial
   B side and its When Revealed, then starting villain setup/reveal. Reuse the
   recorded random selection instead of asking for another shuffle/draw.
4. Apply campaign setup in booklet order, including additions to decks that the
   booklet explicitly places here. Shuffle as directed. Do not prematurely draw
   the opening hand to accommodate those additions.
5. Draw **up to** hand size, counting cards already in hand; resolve mulligans,
   explicit after-mulligan campaign effects, then player Setup abilities.
6. Apply explicit end-of-setup effects without refilling the hand again.

Later scheme/villain stages are not resolved during initial preparation, except
where an initial stage immediately advances (Mansion Attack and Mister Sinister).
Setup-only cards do not acquire an invented “threshold X”. Printed per-player
quantities and initial threat are calculated for the actual player count.

## Scenario checklist and corrections

| Campaign / scenario | Preparation reviewed and resulting behavior |
| --- | --- |
| GMW / Drang | Shared Milano comes from the main scheme once, not once per player. Campaign challenge A/B follows campaign difficulty. Expert campaign minion discard/reveal remains a setup instruction. |
| GMW / Infiltrate the Museum | Reserve the Collection space. Reveal the matching campaign challenge. RR erratum: put a hand card into the Collection **after all setup**, with no refill. |
| GMW / Escape the Museum | Reserve Ship Command. Apply recorded Collection cards at campaign setup. Expert attachment search/reveal happens once per player in player order. |
| GMW / Nebula | Initial ship/evasion procedure precedes recorded artifact consequences. Expert challenge uses its reverse. Retained Market cards are identified during player preparation. |
| GMW / Ronan | Kree Supremacy remains optional (RR erratum). Pincer Maneuver is revealed even when additional evasion-based threat is zero; printed threat and Hinder are separate from that additional amount. |
| MTS / Ebony Maw | Initial scheme and starting villain effects, campaign allies/cards and expert health remain separate; only the starting villain stage is revealed. |
| MTS / Tower Defense | Both villains and schemes start together. Tower, Focused Defense and Besieger minions are installed by 2A only once. Starting stage follows scenario difficulty. |
| MTS / Thanos | Prepare separate Infinity Stone deck and attach Gauntlet before initial scheme resolution. Tower damage penalty follows the optional campaign heal, so healing does not erase it. |
| MTS / Hela | Mystic A/B is the starting face; Wounded is not another starting stage. Initial realm and campaign ally/deck consequences stay in their respective phases. |
| MTS / Loki | Reuse recorded Loki; attach Gauntlet and build Stone deck before scheme reveal. Preserve the booklet’s per-player Norn Stone reward instruction. |
| SM / Sandman | Public Outcry face follows scenario difficulty; campaign deck rewards and City Streets/initial scheme effects are not conflated. |
| SM / Venom | Use first scheme and starting villain only. Reputation setup applies left column top-to-bottom before right column top-to-bottom. |
| SM / Mysterio | Initial illusion preparation is taken from the scheme before campaign effects and opening hand. Retained Tech/Aspect cards are visible in player preparation. |
| SM / Sinister Six | Gather all six villains; the initial scheme selects players + 1. Reputation additional mulligan is deferred to the actual mulligan step (RR erratum). |
| SM / Venom Goblin | Resolve setup card and three simultaneous schemes; give each its own starting threat/threshold rather than treating the setup reverse as a numbered threat stage. |
| MG / Sabretooth | Role choices/upgrades precede Future Past reserve and campaign side scheme. Robert Kelly’s suggested starting damage is an optional adjustment, not mandatory campaign damage. |
| MG / Project Wideawake | Initial scheme establishes Operation Zero Tolerance. Its extra starting cards are an optional difficulty adjustment. Role upgrade enters play; permitted role deck additions are explicit. |
| MG / Master Mold | Rescued/left-behind allies, role upgrades and recorded Future Past cards remain conditional. Reserve the rest of Future Past even when no cards have been recorded. |
| MG / Mansion Attack | Reuse recorded Brotherhood order with scenario A/B faces. Gather four 2A cards; initial 1B immediately advances to a random 2A/2B. Two defeats in Standard, three in Expert. |
| MG / Magneto | Initial scheme/reveal precedes role, captured-ally and Future Past consequences; future main schemes are only gathered, not resolved. |
| Next / Morlock Siege | Hope is excluded from player decks. Prepare Routed’s scenario face, Hide! and Morlocks. Reuse recorded Marauder order with correct A/B faces. |
| Next / On the Run | Remove previously routed villains before the captor draw; keep same-name minions until the selected captor’s setup removes its own minion. Attach Hope’s Captor once. |
| Next / Juggernaut | Campaign deal uses Black Tom **plus one Creeping Willow per player**, deals one to each player and shuffles the remaining card into the encounter deck. |
| Next / Mister Sinister | Reserve all three experiment sets; ignore their attachment Setup keywords. Resolve selected 2A/2B before villain II. Teleported Away adds one threat **per player per campaign environment**. |
| Next / Stryfe | Recorded Hope damage remains a choice between her damage and scheme threat. Environment-based extra threat is **per player**. Saved hand cards count toward opening hand size. |
| AOS / Black Widow | Evidence is sorted by back, one unseen card from each group enters A.I.M., remaining six enter S.H.I.E.L.D. Prepare Board and Interference separately from scenario effects. |
| AOS / Batroc | Apply alert/captive history, restore Board secrets, and resolve earned evidence only after mulligans. Board betrayal threshold follows scenario difficulty. |
| AOS / M.O.D.O.K. | Build four-cell deck with only top cell in play and 2 × players starting locks. Campaign adds 3 × players, then removes rescued-captives × players. Resolve unlocked cells. |
| AOS / Thunderbolts | Gather players + 1 qualifying modular sets, not a fixed two. Reserve Elite Thunderbolts before shuffling the remaining encounter cards. |
| AOS / Baron Zemo | Keep existing evidence envelopes. Scheme installs Board once; campaign restores recorded secrets/turned sides. Accusation details are not preparation actions. Evidence resolves after mulligans. |

## Persistence and boundaries

`remainingRules.ts` narrowly corrects recognized shipped prose and conditions
when reading the expanded snapshot. Unrecognized custom prose is retained.
Repairs are idempotent; saved snapshots and event histories are not rewritten.
Action and draw ids remain stable. The GMW paid-heal sentinel is replaced with
printed hero health; the guide separately explains free rejoining after elimination.

`remainingPreparation.ts` routes each campaign instruction into one phase.
Inventory previews only show references and explanatory text. Printed card
effects and counts come from `schemeSetup.ts`; player choices and physical card
resolution remain explicit. This is a preparation audit, not an automatic game
engine or a re-adjudication of historical victories/rewards. Existing tracker
automation is not expanded by this change.

## Regression coverage

`test:remaining-preparation` covers all 30 scenarios, 1–4 players, independently
selected scenario/campaign difficulties and FR/EN catalogues. It checks snapshot
immutability, idempotent repairs, passive inventory previews, missing-threshold
handling, per-player Hinder, late Collection/evidence timing, reputation order,
Thanos damage after healing, selected Sinister experiment before villain II,
M.O.D.O.K. lock scaling and retained custom instructions. Existing preparation,
engine, tracker, migration and release tests remain required before publication.

Local browser verification used disposable, signed-out profiles with API calls
blocked: all six guide pages in each of the 30 scenarios, alternating FR/EN,
Standard/Expert and light/dark at 390 × 844. Navigation preserved stored draws,
the start shortcut remained visible, and no horizontal overflow or page errors
were observed. Representative light and dark screenshots were inspected outside
the repository. Type checking reports zero errors and warnings; production build
and the complete 46-script Web test suite are the publication gates.
