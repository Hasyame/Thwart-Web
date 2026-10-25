import type { CampaignTemplate, SetupStep } from './types';

/** Narrow read-time repairs of shipped instructions. Custom prose and event ids stay intact.
 * Sources and timing decisions: docs/remaining-campaign-preparation-audit.md.
 */
export const REMAINING_CAMPAIGNS = ['gmw', 'mts', 'sm', 'mg', 'next', 'aos'] as const;
export function remainingRules(template: CampaignTemplate): CampaignTemplate {
  if (!(REMAINING_CAMPAIGNS as readonly string[]).includes(template.id)) return template;
  const id = template.id;
  return {...template, scenarios: template.scenarios?.map(scenario => {
    const sid = scenario.id;
    let steps = (scenario.campaignSetup ?? []).flatMap((original): SetupStep[] => {
      let step = original;
      const en = step.text?.en;
      const words = (en: string, fr: string): void => { step = {...step, text: {en, fr}}; };
      if (id === 'gmw') {
        if (en === 'Expert Campaign Only: set each hit point total to the value recorded last scenario') words('Expert campaign: restore each surviving player’s recorded hit points. A player eliminated during the previous victory may rejoin at printed hit points without paying a unit; update that player’s HP in the log instead of using the paid heal.', 'Campagne Experte : reprenez les PV enregistrés de chaque joueur survivant. Un joueur éliminé lors de la victoire précédente peut revenir avec ses PV imprimés sans payer de crédit ; mettez ses PV à jour dans le registre au lieu d’utiliser le soin payant.');
        if (step.action?.id === 'heal') step = {...step,action:{...step.action,effects:step.action.effects?.map(effect => effect.counter === 'hp' && effect.value === 999 ? {...effect,value:undefined,valueFrom:'heroCard.health' as const} : effect)}};
        if (sid === 's1_badoon' && en === 'Each player puts this support into play on their side' && step.cards?.[0] === '16142') return [];
        if (en === 'Additional Expert step — see the campaign book') words('Expert campaign: in player order, each player discards encounter cards until a minion is discarded, then puts it into play engaged with them.', 'Campagne Experte : dans l’ordre du tour, chaque joueur défausse des cartes Rencontre jusqu’à obtenir un sbire et le met en jeu engagé avec lui.');
        if (sid === 's1_badoon' && en === 'Reveal the side scheme' && !step.when) return [
          {...step, when: {difficulty:'standard'}}, {...step, cards:['16178b'], when:{difficulty:'expert'}},
        ];
        if (en?.includes('reverse side') && (step.cards?.[0]?.startsWith('1618') || step.cards?.[0] === '16179a')) step = {...step, cards: step.cards?.map(c => c.replace(/a$/, 'b'))};
        if (en === 'Expert Campaign Only: each player puts 1 card from hand faceup into The Collection') words('When setup ends, in player order, each player puts one card from their hand faceup into The Collection. Do not refill the hand.', 'Une fois toute la mise en place terminée, dans l’ordre du tour, chaque joueur place une carte de sa main face visible dans la Collection. Ne complétez pas la main.');
        if (en === 'Expert Campaign Only: discard the encounter deck until an attachment, then reveal it') words('Expert campaign: in player order, each player discards encounter cards until an attachment is discarded, then reveals it.', 'Campagne Experte : dans l’ordre du tour, chaque joueur défausse des cartes Rencontre jusqu’à obtenir un attachement, puis le révèle.');
        if (en === 'Reveal this side scheme and place this much threat per player on it') {
          // Revealing Pincer Maneuver is mandatory even when the additional amount is zero.
          step = {...step, compute: undefined};
          words('Find and reveal {card:16112}. After its printed threat and reveal effect, add max(0, 3 − recorded evasion counters) threat per player.', 'Cherchez et révélez {card:16112}. Après sa menace imprimée et son effet de révélation, ajoutez max(0, 3 − jetons Évasion enregistrés) menaces par joueur.');
        }
      }
      if (id === 'mts') {
        if (sid === 's2_tower_defense' && ['Put {card:21100} into play on its Stronghold side.','Attach {card:21101} to the main scheme {card:21099b}.','Each player searches for a copy of {card:21102} and puts it into play engaged with them.'].includes(en ?? '')) return []; // Scheme 2A already performs these.
      }
      if (id === 'sm') {
        if (step.cards?.[0] === '27174a' && !step.when) return [
          {...step, when:{scenarioDifficulty:'standard'}}, {...step, cards:['27174b'], when:{scenarioDifficulty:'expert'}},
        ];
        if (step.cards?.[0]?.startsWith('27174') && step.when?.difficulty) step = {...step, when:{...step.when, difficulty:undefined, scenarioDifficulty:step.when.difficulty}};
        if (en === 'Each player may take 1 additional mulligan during step 13 of setup.') words('During the mulligan step, each player may take one additional mulligan.', 'Lors des mulligans, chaque joueur peut effectuer un mulligan supplémentaire.');
      }
      if (id === 'mg') {
        if (en === 'An upgrade is dealt to each player from their own role.') words('Put the drawn role upgrade into play under its player’s control. Each player may add up to one event and one upgrade from their role’s aspects, provided those titles are absent from their deck; these additions do not count toward deck size.', 'Mettez l’amélioration de rôle tirée en jeu sous le contrôle de son joueur. Chaque joueur peut ajouter au maximum un événement et une amélioration des affinités de son rôle, si ces titres sont absents de son deck ; ces ajouts ne comptent pas dans la taille du deck.');
        if (en?.startsWith('The Brotherhood arrive in this order.') && step.when?.difficulty) step = {...step, when:{...step.when,difficulty:undefined,scenarioDifficulty:step.when.difficulty}};
        if (en === 'Place 1 damage on Robert Kelly.' || en === 'Place 2 damage on Robert Kelly.') {
          step = {...step, when:undefined};
          if (en.startsWith('Place 2')) return [];
          words('Optional difficulty adjustment: agree on Robert Kelly’s starting damage. The booklet suggests 1 in Standard or 2 in Expert scenario mode (0 in Skirmish, 3 in Heroic).', 'Ajustement facultatif : choisissez ensemble les dégâts de départ de Robert Kelly. Le livret conseille 1 en scénario Standard ou 2 en Expert (0 en Escarmouche, 3 en Héroïque).');
        }
        if (en === 'Place 1 card facedown under Operation Zero Tolerance.' || en === 'Place 2 cards facedown under Operation Zero Tolerance.') {
          step = {...step, when:undefined};
          if (en.startsWith('Place 2')) return [];
          words('Optional difficulty adjustment: place cards from the top of player decks facedown under Operation Zero Tolerance. Agree on the total: the booklet suggests 1 in Standard or 2 in Expert (0 in Skirmish, 3 in Heroic).', 'Ajustement facultatif : placez des cartes du dessus des decks des joueurs face cachée sous Opération Tolérance Zéro. Choisissez le total : le livret conseille 1 en Standard ou 2 en Expert (0 en Escarmouche, 3 en Héroïque).');
        }
        if (en === 'Shuffle these Future Past cards into the encounter deck. Shuffle the rest of the Future Past deck and set it aside.') step = {...step, when:undefined};
      }
      if (id === 'next') {
        if (en === 'Shuffle Black Tom Cassidy with 1 Creeping Willow and deal one to each player facedown. Shuffle the rest into the encounter deck.') words('Take Black Tom Cassidy and one Creeping Willow per player. Shuffle these cards together, deal one facedown to each player, then shuffle the remaining card into the encounter deck.', 'Prenez Black Tom Cassidy et un Saule Rampant par joueur. Mélangez ces cartes, distribuez-en une face cachée à chaque joueur, puis mélangez la carte restante dans le deck Rencontre.');
        if (en === 'Put Teleported Away into play, with 1 extra threat for each campaign environment in play.') words('Put Teleported Away into play with its printed threat. Add one threat per player for each campaign environment in play.', 'Mettez Téléporté Ailleurs en jeu avec sa menace imprimée. Ajoutez une menace par joueur pour chaque environnement de campagne en jeu.');
        if (en === "Place 1 threat on Stryfe's Grasp for each campaign environment in play.") words('Add one threat per player to Stryfe’s Grasp for each campaign environment in play.', 'Ajoutez une menace par joueur à Dans les Griffes de Stryfe pour chaque environnement de campagne en jeu.');
      }
      if (id === 'aos') {
        if (en?.startsWith('A board member reaching ') && step.when?.difficulty) step = {...step,when:{...step.when,difficulty:undefined,scenarioDifficulty:step.when.difficulty}};
        if (sid === 's5_baron_zemo' && en === 'Put the three Board Member environments into play, with the secrets they carried out of the last scenario.') words('Restore each Board Member’s recorded secret counters and betrayed side. Do not put a second copy into play.', 'Rétablissez les jetons Secret enregistrés et la face des membres ayant trahi. Ne mettez pas un deuxième exemplaire en jeu.');
        if (en === 'Prepare the evidence and the two envelopes, as the rulebook sets out.') words('Separate the nine evidence cards into three groups by their backs. Shuffle each group and place one unseen card from each in the A.I.M. envelope. Shuffle the six remaining cards together into the S.H.I.E.L.D. envelope, still unseen. Keep both envelopes for the whole campaign.', 'Séparez les neuf indices en trois groupes selon leur dos. Mélangez chaque groupe et glissez une carte de chacun dans l’enveloppe A.I.M., sans la regarder. Mélangez les six cartes restantes dans l’enveloppe S.H.I.E.L.D., toujours sans les regarder. Conservez les deux enveloppes pendant toute la campagne.');
        if (en === 'Place 3 extra lock counters on the top Holding Cell, then take off one for each Rescued Captive you got out last scenario.') words('On the top Holding Cell, add three lock counters per player, then remove one lock counter per player for each Rescued Captive recorded last scenario. Resolve any cell that becomes unlocked.', 'Sur la Cellule de Détention du dessus, ajoutez trois jetons Verrou par joueur, puis retirez un jeton Verrou par joueur pour chaque Captif Secouru enregistré au scénario précédent. Résolvez toute cellule ainsi déverrouillée.');
        if (en === 'Add 2 modular sets, each holding an Elite Thunderbolt minion.') return []; // Scheme 1A states the correct players+1 count.
      }
      return [step];
    });
    if (id === 'sm') {
      // Reputation track: all left-column setup effects, then all right-column effects.
      // White-box reward choices missing from a legacy log are resolved before their effects.
      const reputation = (s: SetupStep) => s.when?.counter === 'reputation' || s.when?.all?.some(c=>c.counter==='reputation');
      const at=steps.findIndex(reputation);
      if(at>=0){
        const rep=steps.filter(reputation);
        const left=(s:SetupStep)=>/shield|aspect|planning/.test(s.action?.id??'') || /S.H.I.E.L.D. Tech|additional mulligan|recorded card|Helicarrier|Symbiote Suit/.test(s.text?.en??'');
        const rewards=rep.filter(s=>s.action);
        const effects=rep.filter(s=>!s.action);
        steps=[...steps.slice(0,at),...rewards,...effects.filter(left),...effects.filter(s=>!left(s)),...steps.slice(at).filter(s=>!reputation(s))];
      }
    }
    // The Thanos damage penalty is applied after the optional heal, not erased by it.
    if (id === 'mts' && sid === 's3_thanos') {
      const damage = steps.filter(s => s.text?.en === 'Deal 3 damage to each identity: Avengers Tower was left damaged');
      steps = [...steps.filter(s => !damage.includes(s)), ...damage];
    }
    // Sabretooth: select roles/upgrades before preparing the Future Past reserve.
    if (id === 'mg' && sid === 's1_sabretooth') {
      const reserve = steps.find(s => s.text?.en === 'Shuffle the Future Past set and set it aside. This is the Future Past deck.');
      if (reserve) { steps = steps.filter(s => s !== reserve); const at = steps.findIndex(s => s.cards?.includes('32171a')); steps.splice(at < 0 ? steps.length : at,0,reserve); }
    }
    return {...scenario,campaignSetup:steps};
  })};
}
