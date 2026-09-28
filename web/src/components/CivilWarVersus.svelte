<script lang="ts">

  import {civilResult,civilBalanced,validCivilSave} from '../lib/civilWarBattle';

  import {onMount} from 'svelte';

  import type {Card,CardSet,Locale} from '../lib/types';

  import type {Strings} from '../lib/i18n';

  import {loadPackCards,cardImageUrl} from '../lib/data';

  import {CIVIL_WAR,civilSchemeRule,civilModules,isCivilLeader,type CivilLeader} from '../lib/civilWar';

  import {startOf,versusSetup,damaged,threatened,villainSideOf,villainHealth,schemeSideOf,schemeLimit,phaseThreatFor,withAcceleration,withManualSchemeLimit,villainDefeated,villainAdvanced,isFinalVillainStage,schemeComplete,schemeAdvanced,isFinalSchemeStage,type Encounter} from '../lib/encounter';

  import CivilWarGuide from './CivilWarGuide.svelte';

  import CardRef from './CardRef.svelte';

  import {cardHtml} from '../lib/cardText';

  interface Props {t:Strings;locale:Locale;sets:readonly CardSet[]}

  const {t,locale,sets}:Props=$props();

  const say=(a:string,b:string)=>locale==='fr'?a:b;

  type Side='registration'|'resistance';

  const sides:Side[]=['registration','resistance'];

  const opposite=(s:Side):Side=>s==='registration'?'resistance':'registration';

  const label=(s:Side)=>s==='registration'?say('Recensement','Registration'):say('Résistance','Resistance');

  interface Board {leader:CivilLeader;schemes:string[];modules:string[];heroes:string[];game:Encounter|null;choosing:number;reward:boolean;first:number;status:'none'|'win'|'loss';phaseThreatAdded:boolean}

  const fresh=(leader:CivilLeader):Board=>({leader,schemes:[...CIVIL_WAR[leader].schemes],modules:[...CIVIL_WAR[leader].modules],heroes:['',''],game:null,choosing:4,reward:false,first:1,status:'none',phaseThreatAdded:false});

  let boards=$state<Record<Side,Board>>({registration:fresh('captain_america_leader'),resistance:fresh('iron_man_leader')});

  let players=$state(1),expert=$state(false),phase=$state<'setup'|'guide'|'playing'|'result'>('setup'),turn=$state(0),round=$state(1);

  let guideTeam=$state<Side>('registration'),active=$state<Side>('registration');

  let seconds=$state(0);
  let timerDraft=$state('00:00:00'),timerDialog=$state.raw<HTMLDialogElement|null>(null);
  const clock=$derived([Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(x=>String(x).padStart(2,'0')).join(':'));
  const parsedTime=$derived(/^\d+:[0-5]\d:[0-5]\d$/.test(timerDraft)?timerDraft.split(':').reduce((a,x)=>a*60+Number(x),0):NaN);
  onMount(()=>{let last=Date.now();const tick=setInterval(()=>{const now=Date.now();if(phase==='playing'&&!paused){const elapsed=Math.floor((now-last)/1000);seconds+=elapsed;last+=elapsed*1000;}else last=now;},1000);return()=>clearInterval(tick);});
  let paused=$state(false),message=$state(''),hydrated=$state(false);

  let cards=$state.raw<readonly Card[]>([]),error=$state(false);

  let preview=$state<string[]>([]),pending=$state<(()=>void)|null>(null),dialog=$state.raw<HTMLDialogElement|null>(null);

  let resetDialog=$state.raw<HTMLDialogElement|null>(null);

  const key='thwart.civil-war.versus.v1';

  $effect(()=>{const language=locale;let cancel=false;void loadPackCards(language,'cw').then(value=>{if(!cancel){cards=value;error=false;}}).catch(()=>{if(!cancel)error=true;});return()=>{cancel=true;};});

  onMount(()=>{try{const saved=JSON.parse(localStorage.getItem(key)??'null');if(validCivilSave(saved)){

    seconds=Number.isSafeInteger(saved.seconds)&&saved.seconds>=0?saved.seconds:0;boards=saved.boards;players=saved.players;expert=saved.expert===true;phase=saved.phase;turn=Math.max(0,Math.min(3,saved.turn??0));round=Math.max(1,saved.round??1);active=sides.includes(saved.active)?saved.active:(turn%2===0?'registration':'resistance');guideTeam=sides.includes(saved.guideTeam)?saved.guideTeam:'registration';paused=phase==='playing';

  }}catch{message=say('La sauvegarde ne peut pas être lue.','The save cannot be read.');}hydrated=true;});

  $effect(()=>{const data={version:1,boards:$state.snapshot(boards),players,expert,phase,turn,round,seconds,active,guideTeam};if(hydrated)try{localStorage.setItem(key,JSON.stringify(data));}catch{message=say('Sauvegarde indisponible dans ce navigateur.','Saving is unavailable in this browser.');}});

  const names=(id:string)=>sets.find(s=>s.code===id)?.name??id;

  const card=(code:string)=>cards.find(c=>c.code===code);
  const art=(code:string|undefined)=>code?cardImageUrl(card(code)?.imagesrc):null;
  let burst=$state<{side:Side;kind:string;value:number;time:number}|null>(null);
  function adjust(kind:'hp'|'threat',amount:number){const g=boards[active].game;if(!g||paused)return;const before=kind==='hp'?-g.progress.damage:g.progress.threat;change(active,g=>kind==='hp'?damaged(g,-amount):threatened(g,amount));const after=boards[active].game!;const delta=(kind==='hp'?-after.progress.damage:after.progress.threat)-before;if(!delta)return;const now=Date.now();burst={side:active,kind,value:burst&&burst.side===active&&burst.kind===kind&&now-burst.time<1000&&Math.sign(burst.value)===Math.sign(delta)?burst.value+delta:delta,time:now};setTimeout(()=>{if(burst?.time===now)burst=null;},1400);}

  const leaders=(side:Side)=>Object.keys(CIVIL_WAR).filter((id):id is CivilLeader=>isCivilLeader(id)&&CIVIL_WAR[id].side===side);

  const identityChoices=$derived(sets.filter(set=>set.type==='hero'));

  const heroConflict=$derived(sides.some(side=>boards[side].heroes.slice(0,players).some(hero=>hero===boards[opposite(side)].leader.replace('_leader',''))));

  const ready=$derived(cards.length>0&&!heroConflict&&sides.every(side=>{

    const b=boards[side],camp=opposite(side);

    return b.heroes.slice(0,players).every(Boolean)&&new Set(b.heroes.slice(0,players)).size===players&&b.modules.length>=3&&b.modules.length<=4&&b.modules.every(id=>civilModules(camp).includes(id))&&b.schemes.every((id,i)=>cards.some(c=>c.code===id&&c.card_set_code===camp&&c.stage===`${i+1}B`));

  }));

  const balanced=$derived(civilBalanced(turn));

  const hasResult=$derived(sides.some(side=>boards[side].status!=='none'));

  const phaseTeam=$derived(turn%2===0?'registration':'resistance');

  const phaseLabel=$derived(`${turn<2?say('Phase Héros','Hero phase'):say('Phase Méchant','Villain phase')} · ${label(phaseTeam)}`);

  function choose(side:Side,leader:CivilLeader){const heroes=boards[side].heroes;boards[side]=fresh(leader);boards[side].heroes=heroes;}

  function toggleModule(side:Side,id:string){const b=boards[side];b.modules=b.modules.includes(id)?b.modules.filter(x=>x!==id):[...b.modules,id];}

  function start(){if(!ready)return;for(const side of sides){const b=boards[side];b.game=startOf(versusSetup(cards.filter(c=>c.card_set_code===b.leader),cards.filter(c=>b.schemes.includes(c.code)),players,expert));b.choosing=4*players;b.reward=false;b.first=1;b.status='none';b.phaseThreatAdded=false;}seconds=0;turn=0;round=1;active='registration';paused=false;phase='playing';}

  function change(side:Side,apply:(g:Encounter)=>Encounter){if(paused)return;const b=boards[side];if(b.game)b.game=apply(b.game);}

  function nextPhase(){if(paused)return;if(turn>=2&&players===2)boards[phaseTeam].first=boards[phaseTeam].first===1?2:1;turn=(turn+1)%4;if(turn===0)round++;active=turn%2===0?'registration':'resistance';if(turn>=2)boards[active].phaseThreatAdded=false;}

  function addPhaseThreat(){change(active,g=>threatened(g,phaseThreatFor(g)));boards[active].phaseThreatAdded=true;}

  function review(codes:string[],action?:()=>void){preview=codes;pending=action??null;dialog?.showModal();}

  function advanceLeader(side:Side){const g=boards[side].game!;review([g.setup.villain[g.progress.villainIndex+1]?.code??''],()=>change(side,villainAdvanced));}

  function advanceScheme(side:Side){const g=boards[side].game!;const code=g.setup.scheme[g.progress.schemeIndex+1]?.options[0]?.code??'';review([code.replace(/b$/,'a'),code],()=>change(side,schemeAdvanced));}

  function restart(){boards={registration:fresh('captain_america_leader'),resistance:fresh('iron_man_leader')};phase='setup';paused=false;turn=0;round=1;resetDialog?.close();}

  const winner=$derived(civilResult(boards.registration.status,boards.resistance.status));

  const result=$derived(winner==='both-lose'?say('Les deux équipes ont perdu','Both teams lose'):winner==='tie'?say('Égalité : départagez ci-dessous','Tie: apply the tiebreaks below'):winner?label(winner)+say(' gagne',' wins'):'');



</script>



{#if phase!=='playing'}<h1 class="comic-title">Civil War · {say('Compétitif','Competitive')}</h1>

<p>{say('Deux équipes, deux tables. Votre camp affronte le leader du camp opposé.','Two teams, two boards. Your side faces the opposing side’s leader.')}</p>{/if}

{#if message}<p role="status">{message}</p>{/if}

{#if error}<p role="alert">{say('Impossible de charger les cartes. Réessayez en rechargeant la page.','Cards could not load. Reload to try again.')}</p>

{:else if cards.length===0}<p>{t.loading}</p>

{:else if phase==='setup'}

  <div class="controls"><label>{say('Format','Format')} <select class="field" bind:value={players}><option value={1}>1 vs 1</option><option value={2}>2 vs 2</option></select></label><label>{say('Difficulté des deux tables','Both tables’ difficulty')} <select class="field" bind:value={expert}><option value={false}>Standard · I / II</option><option value={true}>Expert · III / IV</option></select></label></div>

  <div class="boards">{#each sides as side}

    {@const b=boards[side]}

    <section class="surface board"><h2>{label(side)}</h2>

      {#each Array(players) as _,i}<label class="field-group">{say('Héros','Hero')} {i+1}<select class="field" bind:value={b.heroes[i]}><option value="">{say('Choisir','Choose')}</option>{#each identityChoices as identity}<option value={identity.code}>{identity.name}</option>{/each}</select></label>{/each}

      <label class="field-group">{say('Leader ennemi affronté','Enemy leader faced')}<select class="field" value={b.leader} onchange={e=>choose(side,e.currentTarget.value as CivilLeader)}>{#each leaders(opposite(side)) as id}<option value={id}>{names(id)}</option>{/each}</select></label>

      <p class="muted">{say('Ce scénario est préparé par','This scenario is prepared by')} {label(opposite(side))}.</p>

      {#each [0,1] as stage}<label class="field-group">{say('Manigance','Scheme')} {stage+1}<select class="field" bind:value={b.schemes[stage]}>{#each cards.filter(c=>c.card_set_code===opposite(side)&&c.stage===`${stage+1}B`) as scheme}<option value={scheme.code}>{scheme.name}</option>{/each}</select></label>{/each}

      <fieldset><legend>{say('Sets modulaires : 3 ou 4','Modular sets: 3 or 4')} · {b.modules.length}</legend>{#each civilModules(opposite(side)) as id}<label class="module"><input type="checkbox" checked={b.modules.includes(id)} onchange={()=>toggleModule(side,id)}/>{names(id)}</label>{/each}</fieldset>

      <p>{say('Standard JcJ du camp du leader remplace Standard. Les quatre cartes de base du leader sont réservées à son équipe.','The leader’s side’s Standard PvP replaces Standard. Reserve the leader’s four basic cards for their team.')}</p>

    </section>

  {/each}</div>

  {#if heroConflict}<p role="alert">{say('Un héros ne peut pas avoir le même titre que le leader de sa propre équipe.','A hero cannot share a title with their own team’s leader.')}</p>{/if}

  <button class="btn btn--primary" disabled={!ready} onclick={()=>phase='guide'}>{say('Préparer les deux tables','Prepare both boards')}</button>

{:else if phase==='guide'}

  <div class="controls">{#each sides as side}<button class="btn" aria-pressed={guideTeam===side} onclick={()=>guideTeam=side}>{label(side)}</button>{/each}<button class="btn" onclick={()=>phase='setup'}>{say('Réglages','Settings')}</button></div>

  <CivilWarGuide {locale} {cards} leader={boards[guideTeam].leader} {players} {expert} competitive schemes={boards[guideTeam].schemes} modules={boards[guideTeam].modules} setName={names} storageKey={`${key}.guide.${guideTeam}.${boards[guideTeam].leader}.${expert}`} onReady={start}/>

{:else if phase==='playing'}

  <div class="phase surface"><button class="btn" onclick={()=>{timerDraft=clock;timerDialog?.showModal();}} aria-label={say('Modifier le temps de jeu','Edit elapsed time')}>{clock}</button><strong>{say('Round','Round')} {round} · {phaseLabel}</strong><div class="controls"><button class="btn" onclick={()=>paused=!paused}>{paused?say('Reprendre','Resume'):say('Pause · sauvegarder','Pause · save')}</button><button class="btn" disabled={paused||hasResult&&balanced} onclick={nextPhase}>{say('Phase terminée →','Phase complete →')}</button></div></div>

  <div class="controls">{#each sides as side}<button class="btn" aria-pressed={active===side} onclick={()=>active=side}>{label(side)} · {boards[side].status==='none'?'…':boards[side].status==='win'?say('victoire signalée','win reported'):say('défaite signalée','loss reported')}</button>{/each}</div>

  {@const b=boards[active]}{@const g=b.game}

  {#if g}

    {@const leader=villainSideOf(g)}{@const scheme=schemeSideOf(g)}{@const hp=villainHealth(g)}

    <section class="surface board table"><h2>{label(active)} · {say('Premier joueur','First player')} {b.first}</h2>

      <div class="vitals"><article class="illustrated" style:--art={art(leader?.code)?`url("${art(leader?.code)}")`:"none"}><CardRef code={leader?.code??''} name={`${leader?.name} · ${leader?.stage}`}/><p class="value">{hp===null?'?':Math.max(0,hp-g.progress.damage)} / {hp??'?'} {say('PV','HP')}</p><div class="controls"><button class="btn" disabled={paused} onclick={()=>adjust('hp',-1)}>−1 {say('PV','HP')}</button><button class="btn" disabled={paused} onclick={()=>adjust('hp',1)}>+1 {say('PV','HP')}</button></div>

      {#if villainDefeated(g)&&!isFinalVillainStage(g)}<button class="btn" disabled={paused} onclick={()=>advanceLeader(active)}>{say('Stade suivant','Next stage')} · {g.setup.villain[g.progress.villainIndex+1]?.stage}</button>{:else if villainDefeated(g)}<strong>{say('Leader vaincu : signalez le résultat ci-dessous','Leader defeated: report the result below')}</strong>{/if}</article>

      <article class="illustrated" style:--art={art(scheme?.code)?`url("${art(scheme?.code)}")`:"none"}><CardRef code={scheme?.code??''} name={`${scheme?.name} · ${scheme?.stage}`}/><p class="value">{g.progress.threat} / {schemeLimit(g)??'?'}</p><div class="controls"><button class="btn" disabled={paused} onclick={()=>adjust('threat',-1)}>−1</button><button class="btn" disabled={paused} onclick={()=>adjust('threat',1)}>+1</button><button class="btn" disabled={paused} onclick={()=>adjust('threat',5)}>+5</button></div>

      {#if schemeComplete(g)&&!isFinalSchemeStage(g)}<button class="btn" disabled={paused} onclick={()=>advanceScheme(active)}>{say('Manigance suivante','Next scheme')}</button>{:else if schemeComplete(g)}<strong>{say('Manigance achevée : signalez la défaite de cette équipe','Scheme completed: report this team’s loss')}</strong>{/if}</article></div>

      {#if burst&&burst.side===active}<p class="burst" role="status">{burst.value>0?'+':''}{burst.value} {burst.kind==='hp'?say('PV','HP'):say('menaces','threat')}</p>{/if}
      <div class="controls"><button class="btn btn--primary" disabled={paused||turn<2||phaseTeam!==active||b.phaseThreatAdded} onclick={addPhaseThreat}>{say('Ajouter la menace de début de phase','Add start-of-phase threat')} · +{phaseThreatFor(g)}</button><span>{say('Accélération totale','Total acceleration')} {g.progress.accelerationTokens??0}</span><button class="btn" disabled={paused} onclick={()=>change(active,g=>withAcceleration(g,'accelerationTokens',Math.max(0,(g.progress.accelerationTokens??0)-1)))}>−1</button><button class="btn" disabled={paused} onclick={()=>change(active,g=>withAcceleration(g,'accelerationTokens',(g.progress.accelerationTokens??0)+1))}>+1</button></div>

      <div class="controls"><CardRef code={opposite(active)==='registration'?'56128a':'56206a'} name={say('Choisir son Camp','Choosing Sides')}/><strong>{b.choosing}</strong><button class="btn" disabled={paused||b.reward} onclick={()=>b.choosing=Math.max(0,b.choosing-1)}>−1</button><button class="btn" disabled={paused||b.reward} onclick={()=>b.choosing++}>+1</button>{#if b.choosing===0&&!b.reward}<button class="btn" disabled={paused} onclick={()=>review([opposite(active)==='registration'?'56128a':'56206a',opposite(active)==='registration'?'56128b':'56206b'],()=>{b.reward=true;})}>{say('Résoudre et retourner','Resolve and flip')}</button>{/if}{#if b.reward}<button class="btn" onclick={()=>review([opposite(active)==='registration'?'56128b':'56206b'])}>{say('Récompenses : lire la face B','Rewards: read side B')}</button>{/if}</div>

      <details><summary>{say('Règles et réglages','Rules and settings')}</summary><p>{say('Les boutons ne résolvent que les compteurs. Résolvez activations, boost, états et cartes sur la table. Les résultats ci-dessous restent corrigeables.','Buttons only adjust counters. Resolve activations, boosts, statuses and cards at the table. Results below remain correctable.')}</p><label>{say('Seuil de menace actuel','Current threat limit')} <input class="field" type="number" min="1" value={schemeLimit(g)??1} onchange={e=>change(active,g=>withManualSchemeLimit(g,Number(e.currentTarget.value)))}/></label><CivilWarGuide {locale} {cards} leader={b.leader} {players} {expert} competitive schemes={b.schemes} modules={b.modules} setName={names} storageKey={`${key}.rules.${active}`}/></details>

      <label class="field-group">{say('Résultat signalé pour cette équipe','Reported result for this team')}<select class="field" bind:value={b.status} disabled={paused}><option value="none">{say('Partie en cours / corriger','Ongoing / correct')}</option><option value="win">{say('Leader ennemi vaincu','Enemy leader defeated')}</option><option value="loss">{say('Manigance 2B achevée ou tous nos héros éliminés','Scheme 2B completed or all our heroes eliminated')}</option></select></label>

    </section>

  {/if}

  {#if hasResult}<p role="status">{say('Terminez la phase correspondante de Résistance avant de confirmer. Un leader vaincu reste sur la table jusque-là.','Finish Resistance’s matching phase before confirming. A defeated leader stays on the table until then.')}</p><button class="btn btn--primary" disabled={!balanced||paused} onclick={()=>phase='result'}>{say('Les deux phases sont terminées : confirmer le résultat','Both matching phases are finished: confirm result')}</button>{/if}

{:else}

  <section class="surface board"><h2>{result}</h2>{#if boards.registration.status==='win'&&boards.resistance.status==='win'}<ol>{#each t.versusTiebreaks as rule}<li>{rule}</li>{/each}</ol>{/if}<button class="btn" onclick={()=>phase='playing'}>{say('Corriger / revenir à la table','Correct / return to the table')}</button></section>

{/if}

<button class="btn" onclick={()=>resetDialog?.showModal()}>{say('Nouvelle partie','New game')}</button>

<dialog bind:this={dialog}><h2>{say('À résoudre avant de continuer','Resolve before continuing')}</h2>{#each preview as code}{@const c=card(code)}{#if c}<h3><CardRef {code} name={`${c.name}${c.stage?' · '+c.stage:''}`}/></h3><p>{civilSchemeRule(locale,c.code,players)}</p><div class="card-text">{@html cardHtml(c.text??'')}</div>{/if}{/each}<div class="controls"><button class="btn" onclick={()=>dialog?.close()}>{say('Revenir à la partie','Return to the game')}</button>{#if pending}<button class="btn btn--primary" onclick={()=>{pending?.();pending=null;dialog?.close();}}>{say('Effets résolus · continuer','Effects resolved · continue')}</button>{/if}</div></dialog>

<dialog bind:this={timerDialog}><h2>{say('Temps de jeu','Elapsed time')}</h2><label>{say('Heures:minutes:secondes','Hours:minutes:seconds')}<input class="field" type="text" inputmode="text" bind:value={timerDraft}/></label><div class="controls"><button class="btn" onclick={()=>timerDialog?.close()}>{say('Annuler','Cancel')}</button><button class="btn" disabled={!Number.isSafeInteger(parsedTime)||parsedTime<0} onclick={()=>{seconds=parsedTime;timerDialog?.close();}}>{say('Enregistrer','Save')}</button></div></dialog>
<dialog bind:this={resetDialog}><h2>{say('Remplacer cette partie ?','Replace this game?')}</h2><p>{say('La table sauvegardée sera remplacée.','The saved table will be replaced.')}</p><div class="controls"><button class="btn" onclick={()=>resetDialog?.close()}>{say('Annuler','Cancel')}</button><button class="btn" onclick={restart}>{say('Nouvelle partie','New game')}</button></div></dialog>

<style>
  .illustrated{position:relative;isolation:isolate;overflow:hidden;background:#191922;color:#fff}
  .illustrated::before{content:'';position:absolute;inset:-5px;z-index:-2;background-image:var(--art);background-size:cover;background-position:center 30%;filter:blur(2px)}
  .illustrated::after{content:'';position:absolute;inset:0;z-index:-1;background:linear-gradient(120deg,#10121be8,#10121baa)}
  .illustrated :global(.ref){color:#fff}.illustrated .btn{background:var(--surface-1);color:var(--text)}
  .phase{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:center}.phase strong{font-size:14px}.phase>.controls{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr}.phase .btn{padding:8px}
  .burst{margin:0;font-weight:900;color:var(--accent);font-size:var(--text-xl)}


  h1{margin-block:24px}h2{font-size:var(--text-lg)}.boards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:16px}.board,.phase{padding:16px;margin-block:16px}.board{display:grid;gap:14px}.controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.module{display:flex;align-items:center;gap:10px;min-height:44px}.vitals{display:grid;grid-template-columns:1fr 1fr;gap:12px}.vitals .controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.vitals .controls .btn{padding:8px 2px}.vitals article{min-width:0;padding:12px;border:1px solid var(--border)}.value{font-size:clamp(20px,5vw,28px);font-weight:900;margin-block:12px}.card-text{white-space:pre-line;line-height:1.6;margin-block:16px}button,select,summary{min-height:44px}button{white-space:normal}dialog{max-width:min(680px,calc(100vw - 24px));max-height:85dvh;overflow:auto;background:var(--surface-1);color:var(--text);padding:24px;border:2px solid var(--border)}dialog::backdrop{background:#000a}[aria-pressed=true]{border-color:var(--accent);background:var(--surface-1)}summary{align-content:center}fieldset{border:1px solid var(--border);padding:12px}.field{max-width:100%}

</style>
