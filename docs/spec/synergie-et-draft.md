# Synergie et draft — spécification commune Web / Android

Référence partagée entre Thwart Web (`web/`) et l'application Android
(`Hasyame/Thwart`). Les règles ci-dessous doivent donner exactement les mêmes
résultats des deux côtés, et les decks doivent circuler entre les deux via le
serveur sans perte. Texte de Benoît, recopié tel quel le 2026-09-17 ; les
décisions prises pendant la mise en œuvre sont ajoutées en fin de document,
datées.

Vocabulaire : identité = héros, affinité = aspect (Justice, Protection,
Agressivité, Commandement, 'Pool), basique = cartes neutres.

## Phase 1 : synergie entre le deck et l'identité

**Définition.** Certaines cartes d'affinité ou basiques portent une condition
de jeu liée aux traits de l'identité. Exemple : Rocket Raccoon (The Galaxy's
Most Wanted #19) indique « Jouez cette carte uniquement si votre identité a le
trait GARDIEN ». Adam Warlock (The Mad Titan's Shadow #31) a les traits Gardien
et Mystique, il peut donc la jouer. Magik (Age of Apocalypse #30) a les traits
Mystique et X-Men, elle ne peut que l'utiliser comme ressource. Une telle carte
reste légale dans un deck : la synergie est un avertissement, jamais un critère
de légalité.

**Données.**

- Extraire les traits de chaque identité depuis le fichier d'inventaire des
  identités (ou depuis les données de cartes s'il ne les contient pas encore,
  et dans ce cas l'enrichir). Stocker des clés de traits indépendantes de la
  langue (par exemple la clé anglaise normalisée `guardian`), l'affichage passe
  par la traduction.
- Une identité a au moins deux faces (héros et alter ego) dont les traits
  diffèrent souvent. Conserver les traits par face. Pour l'avertissement de
  construction, une carte est compatible si au moins une face de l'identité
  remplit la condition. Les identités à plusieurs formes héros prennent en
  compte toutes leurs faces.
- Pour les conditions des cartes, choisir la méthode la plus fiable et la plus
  performante. Recommandation : une passe de dérivation exécutée à l'import ou
  à la mise à jour des données (jamais à l'affichage) qui calcule un champ par
  carte, par exemple `synergy: { anyOfTraits: ["guardian"] }` ou `null` si la
  carte n'a pas de condition. La passe s'appuie sur le texte anglais
  (`real_text` s'il existe, sinon `text`), plus régulier que le français, où
  les traits sont normalement balisés `[[Trait]]` (à vérifier dans les données
  réelles). Gérer au minimum les formes « has the X trait » et « has the X or
  Y trait ».
- La passe doit produire un rapport (log ou test) listant toutes les cartes
  joueur contenant « Play only if » dont la condition n'a pas été reconnue,
  pour qu'aucun cas ne passe à la trappe. Les conditions qui ne portent pas
  sur les traits (forme héros, nom d'identité, Team-Up, etc.) sont hors
  périmètre pour l'instant : les lister dans le rapport, Benoît tranchera.
- Créer une fixture JSON de référence, strictement identique sur Web et
  Android, utilisée par les tests des deux côtés : Rocket Raccoon + Adam
  Warlock = compatible, Rocket Raccoon + Magik = incompatible, carte sans
  condition = compatible, plus quelques cas « X or Y » et un cas où seul
  l'alter ego (ou seul le héros) a le trait.

**Comportement.**

- Éditeur de deck : dès qu'une carte incompatible est ajoutée, afficher un
  avertissement non bloquant. FR : « Problème de synergie : la carte X (et Y,
  Z…) n'a pas de synergie avec l'identité ». EN : « Synergy issue: X (and Y,
  Z…) has no synergy with this identity ». La liste couvre toutes les cartes
  concernées et se met à jour en direct (l'avertissement disparaît quand on
  les retire).
- Ouverture d'un deck sauvegardé, importé ou synchronisé : même
  avertissement, recalculé à l'ouverture et jamais stocké dans le deck.
- Dans la liste des cartes disponibles de l'éditeur, une case à cocher
  « Masquer les cartes sans synergie avec l'identité » (EN « Hide cards without
  synergy with this identity »), décochée par défaut. À décider : mémoriser ce
  choix ou le réinitialiser à chaque ouverture.

## Phase 2 : mode draft

**Principe.** Draft à la manière de Magic: The Gathering, de 1 à 4 joueurs sur
le même appareil, chacun son tour. Toutes les identités et toutes les cartes
proviennent de la collection de l'utilisateur.

### Page 1, paramètres

- Nombre de joueurs : 1 à 4.
- Exclure les cartes sans synergie avec l'identité : oui ou non (non par
  défaut). Ce filtre réutilise la logique de la phase 1.
- Sélection des identités : « Aléatoire », « Aléatoire parmi 5 » ou « Au
  choix ».
- Nombre de cartes proposées à chaque choix (X) : bornes 2 à 10, valeur par
  défaut 3.

### Page 2, identités et affinités

En solo un seul passage, en multijoueur chaque joueur à son tour.

- Identité selon le mode : « Aléatoire » tire au sort une identité possédée.
  « Aléatoire parmi 5 » tire 5 identités possédées et le joueur en choisit
  une. « Au choix » affiche toutes les identités possédées. Deux joueurs ne
  peuvent pas avoir la même identité.
- Affinité : Justice, Protection, Agressivité, Commandement, 'Pool, plus un
  bouton « Aléatoire ». 'Pool n'est proposée (y compris dans le tirage
  aléatoire) que si le pack Deadpool est dans la collection.
- Les identités dont les règles de construction imposent leurs propres
  affinités (Adam Warlock, et à vérifier pour d'autres comme Spider-Woman) ne
  proposent pas de choix d'affinité et appliquent leur règle. Déduire ces
  règles des données (`deck_requirements`, `deck_options` ou équivalent) ou de
  la validation de deck existante plutôt que d'une liste en dur. Si une liste
  en dur est inévitable, la centraliser dans un seul fichier de configuration.
- Les cartes spécifiques à l'identité (cartes signature) sont ajoutées
  automatiquement et comptent dans le total. Obligation et némésis sont
  exclues comme en construction normale.
- Taille du deck : 40 à 50 cartes, par joueur. Nombre de choix de draft =
  taille demandée moins le nombre de cartes signature.
- Avant de lancer le draft, vérifier que le stock disponible permet
  d'atteindre les tailles demandées (en tenant compte des autres joueurs).
  Sinon, message explicite et proposition de réduire la taille.

### Page 3, draft

- Pool d'un joueur : cartes joueur de la collection appartenant à son ou ses
  affinités, plus les basiques. Jamais de cartes signature d'autres identités
  ni de cartes rencontre ou campagne. Filtre synergie appliqué si l'option est
  active.
- À chaque tour, X cartes tirées au hasard dans le pool du joueur actif. Il en
  choisit une, les autres retournent dans le pool. S'il reste moins de X
  cartes, proposer ce qui reste.
- Légalité garantie à chaque tirage : une carte n'est jamais proposée si
  l'ajouter rendait le deck illégal (limite d'exemplaires `deck_limit`, règles
  propres à l'identité comme un seul exemplaire par carte pour Adam Warlock,
  réimpressions comptées comme une même carte).
- Quantités possédées : un exemplaire physique ne peut être drafté qu'une
  seule fois, tous joueurs confondus, puisque la collection est partagée sur
  l'appareil. Le pool est donc un stock décrémenté à chaque choix, et les
  réimpressions présentes dans plusieurs packs possédés s'additionnent.
- Multijoueur : tour par tour (J1, J2, J3, J4, J1…). Un joueur qui a atteint
  sa taille est sauté. Un écran de transition « Au tour de Joueur N » permet
  de passer l'appareil sans voir le choix du précédent.
- Pour le joueur actif, afficher son identité, son affinité, sa progression
  (ex. 23/45) et un aperçu de ses cartes déjà choisies.
- Le tirage aléatoire est injectable (seed) pour rendre les tests
  déterministes.
- L'état du draft est sauvegardé localement pour reprendre après une
  fermeture, avec un bouton « Abandonner le draft » soumis à confirmation.

### Page 4, fin du draft

- Nom par défaut : `DRAFT-NOMIDENTITE-AFFINITE-01`, par exemple
  `DRAFT-SPIDERMAN-AGGRESSION-01`. Nom d'identité en majuscules, sans espaces,
  tirets, accents ni ponctuation. Affinité en code anglais stable, identique
  quelle que soit la langue : JUSTICE, PROTECTION, AGGRESSION, LEADERSHIP,
  POOL. Pour une identité sans choix d'affinité, valeur à proposer (par
  exemple le code de l'identité ou MULTI). Suffixe incrémenté si le nom existe
  déjà (02, 03…), y compris entre les decks d'un même draft.
- Chaque joueur, à son tour, peut modifier le nom ou garder celui par défaut.
  Le bouton « Fin du draft » sauvegarde tous les decks d'un coup.
- Avant sauvegarde, chaque deck repasse par la validation standard. Un deck
  illégal à ce stade est un bug : log détaillé, message clair à l'utilisateur,
  aucune sauvegarde silencieuse. Un deck contenant des cartes sans synergie
  (option désactivée) reste légal et affichera simplement l'avertissement de
  la phase 1.
- Les decks créés passent par le circuit normal de sauvegarde et déclenchent
  la synchronisation serveur pour apparaître dans les assets partagés du
  compte (mise en file si hors ligne, comportement habituel si aucun compte).
  Pas de nouveau champ obligatoire dans le modèle de deck. Un marqueur « issu
  d'un draft », s'il est utile, doit être optionnel et rétrocompatible, et
  soumis avant, car l'autre plateforme devra le gérer aussi.

## Spécificités Web

- Le draft est une page à part avec sa propre route (`/draft`), accessible
  depuis la navigation principale.
- Responsive (téléphone, tablette, bureau).
- Le draft fonctionne entièrement hors ligne. Son état est persisté dans le
  stockage local déjà utilisé par l'app (IndexedDB) et survit à un
  rechargement de page.
- Si la passe de dérivation `synergy` peut être faite une seule fois dans le
  pipeline de données partagé, c'est la meilleure garantie de cohérence avec
  Android. Sinon, la fixture commune fait foi.

## Décisions et constats (ajoutés pendant la mise en œuvre)

**2026-09-17, phase 1 (Web).**

- Il n'existe de fichier d'inventaire des identités sur aucune des deux
  plateformes : les identités sont dérivées des cartes (`type_code` `hero` /
  `alter_ego`, regroupées par `card_set_code`). Les traits par face sont lus
  sur `real_traits` (anglais, présent dans les deux langues) et normalisés en
  clés : minuscules, points supprimés, tirets conservés — `Guardian` →
  `guardian`, `S.H.I.E.L.D.` → `shield`, `X-Men` → `x-men`.
- La dérivation est faite à la récupération des données
  (`web/scripts/lib/synergy.mjs`, appelé par `fetch-cards.mjs`), jamais à
  l'affichage. Il n'y a pas de pipeline de données partagé avec Android (le
  serveur ne connaît pas les cartes) : **la fixture
  `web/scripts/fixtures/synergy.json` fait foi**, et Android porte les mêmes
  règles. Champ produit : `synergy: { anyOfTraits: [...] } | null` sur chaque
  carte et chaque ligne d'index, plus `traitKeys` sur les lignes d'index.
- Formes reconnues (89 cartes au 2026-09-17) : « Play only if your identity
  has the [[X]] trait », « Play only if you have the [[X]] trait », et
  « [[X]] or [[Y]] » (dont `[[S.H.I.E.L.D.]]`).
- Formes non reconnues, listées par le test `npm run test:synergy` et
  laissées hors périmètre en attendant décision (28 cartes) : « your hero has
  the [[X]] trait » (condition sur la face héros seule, 3 cartes), « you
  control a [[X]] card / character » (10), forme héros ou forme de Vision (6),
  « at least 14 printed hit points » (3), « side scheme in the victory
  display » (4), joueur nommé (1), « any player controls » (1), « at least 3
  characters with the trait » (1).
- Case « Masquer les cartes sans synergie » : **réinitialisée à chaque
  ouverture**, non mémorisée. C'est une aide de parcours, et mémorisée elle
  cacherait des cartes en silence au deck suivant.

**2026-09-17, phase 2 (Web).**

- Le moteur Web (`web/src/lib/draft/`) reprend l'Android (`domain/draft/`)
  fonction pour fonction : mêmes états, mêmes règles, mêmes noms. Les tirages
  sont déterministes par seed de chaque côté mais ne sont pas identiques
  entre plateformes (générateurs différents) — un draft ne voyage pas.
- **X par défaut : 5**, comme sur Android (la spec disait 3).
- Le draft tourne entièrement sur l'index de cartes : `quantity`,
  `deckLimit`, `duplicateOf`, `hidden`, `res` et `deckRules` y sont ajoutés
  à la construction, et `lib/draft/cards.ts` reconstitue la forme que le
  validateur lit. Un seul validateur, donc une seule règle de légalité.
- Nommage : `MULTI` pour les affinités imposées (Adam Warlock), les deux codes
  triés pour Spider-Woman (`DRAFT-SPIDERWOMAN-JUSTICE-PROTECTION-01`).
- Aucun marqueur « issu d'un draft » sur le deck : le nom suffit ; `tags`
  existe déjà si on en veut un plus tard.
- L'état du draft est une table Dexie locale (`drafts`), jamais synchronisée
  ni sauvegardée : un draft est une session de table sur un appareil.
- Les réimpressions sont comptées par nom dans la validation existante (les
  deux clients), et par `duplicate_of_code` dans le stock du draft.
- `player_side_scheme` est ajouté aux types de cartes constructibles (l'option
  de Cable) : la piscine de l'éditeur les propose aussi désormais.

**2026-09-18, paquets construits à l'avance (Web).**

Le tirage carte par carte est remplacé par des **paquets** (boosters),
comme à une table de draft. Moteur `web/src/lib/draft/engine.ts`
(`buildPacks`, `openPack`), état `packs` et `builds` dans `DraftState`,
test `npm run test:draft`. Android reste à aligner.

- Les paquets sont construits **avant le premier choix**, une fois toutes
  les identités validées : pour chaque joueur, un paquet de X cartes
  distinctes par carte qu'il lui reste à prendre, tiré de ce que son deck
  peut accepter à ce moment (affinités, basiques, options de l'identité,
  synergie si activée, limites d'exemplaires, équilibre des affinités).
- Un exemplaire physique n'est **dans un seul paquet** à la fois, tous
  joueurs confondus : le stock est décrémenté à la construction et
  ré-approvisionné quand un paquet est ouvert et ses cartes non prises
  reposées. Les paquets sont distribués tour par tour (un paquet pour
  chaque joueur, puis un autre), pour qu'un stock insuffisant soit partagé.
- Une carte que le deck ne peut contenir qu'une fois (unique, ou « max 1
  par deck » comme les ressources de base Force, Énergie, Génie) n'apparaît
  **qu'une fois dans l'ensemble des paquets d'une construction**, même si
  la collection en possède plusieurs exemplaires ; les autres exemplaires
  restent en stock.
- Si le stock ne suffit pas pour tous les paquets, on construit ceux qu'il
  permet ; quand un joueur a ouvert son dernier paquet et qu'il lui manque
  encore des cartes, **le stock restant est rebattu en nouveaux paquets**
  (les cartes reposées comprises) et le draft continue. Un joueur pour qui
  rien de légal ne reste après ce rebattage s'arrête là, deck court.
- À l'ouverture d'un paquet, une carte devenue illégale entre-temps (les
  paquets ont été faits avant les choix suivants) est reposée sans être
  montrée ; un paquet vidé ainsi est passé. Le choix rend les autres cartes
  du paquet au stock.
- La graine gouverne toujours tout : même seed, mêmes paquets. Un draft
  enregistré avant cette version n'a pas de paquets ; il les construit à sa
  prochaine ouverture depuis le stock tel quel.

