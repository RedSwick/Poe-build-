# PoE Build Architect

Optimiseur de builds **Path of Exile 1**, calé sur la ligue **3.29 « Curse of the
Allflame »**, bâti sur le **vrai moteur de calcul de Path of Building**.

Principe directeur : **ne rien recoder de ce qui existe déjà**. Aucune formule de
dégâts ou de défense n'est réimplémentée — c'est PoB qui calcule, on ne fait que
le piloter.

---

## Ce que ça fait aujourd'hui

À partir d'une gemme principale et d'un objectif, l'outil trouve les meilleures
**gemmes de support** et le meilleur **arbre de passifs**, en les mesurant
réellement : il construit le build, demande à PoB de le recalculer, et classe
les candidats par gain observé. Rien n'est deviné à partir du texte des gemmes
ou des nœuds.

```bash
npm run setup                 # installe LuaJIT, lua-utf8 et le dépôt PoB
npm install
npx tsx src/cli.ts optimize "Winter Orb" --goal damage --links 6
```

Sortie : setup de gemmes (principale + supports avec leur gain), emplacement,
arbre de passifs alloué avec le coût en points de chaque notable, **lien
pathofexile.com vers l'arbre**, statistiques avant/après, statistiques à
prioriser, alternatives envisagées.

Exemple réel (Winter Orb, Occultist, objectif équilibré) — l'outil retrouve
seul les nœuds qu'un joueur prendrait : `Void Beacon` (le notable signature de
l'Occultist pour le froid), `Elemental Overload` (correct pour une compétence
à faible crit), `Mind Over Matter`, `Frost Walker`, `Blast Radius`.

### Interface web

```bash
npx tsx src/cli.ts serve      # puis http://localhost:5173
```

Deux onglets : optimiser un build depuis une gemme principale, ou importer un
build existant pour l'auditer. La progression est diffusée en direct (une
optimisation complète dure plusieurs minutes). Langue commutable FR/EN/ES —
l'interface lit les mêmes fichiers de locale que la ligne de commande.

### Importer un build existant

```bash
npx tsx src/cli.ts import "<code PoB>"
npx tsx src/cli.ts import https://pobb.in/xxxxx
```

Décode le build, le recalcule avec le moteur 3.29 et rend un audit.

### Équipement et budget

```bash
npx tsx src/cli.ts gear "Winter Orb" --budget comfortable
npx tsx src/cli.ts gear "Winter Orb" --budget leagueStart --slots "Body Armour,Amulet,Belt"
```

Paliers : `leagueStart`, `comfortable`, `optimised`, `mirror`. Chaque unique
candidat est **réellement équipé** et le build recalculé, comme pour les gemmes
et l'arbre. 1322 uniques sont chargés depuis PoB.

> ⚠️ **Prix non vérifiés.** Le client poe.ninja est écrit d'après l'API publique
> documentée, mais **poe.ninja est bloqué (403) depuis l'environnement où ce
> code a été développé** : il n'a donc jamais tourné contre le vrai service.
> Sans prix, le palier de budget ne filtre rien et l'outil le dit explicitement
> au lieu de faire semblant. À valider sur ta machine.

> ⚠️ **Uniques seulement.** Un build réel s'appuie surtout sur des **rares** aux
> mods choisis, que l'outil ne sait pas encore générer. La recherche est aussi
> partielle : seuls les N premiers uniques par emplacement sont testés.

### Objets rares et liens de trade

```bash
npx tsx src/cli.ts rares "Winter Orb" --defence EnergyShield
```

Génère, emplacement par emplacement, l'objet rare à chercher pour **capper les
résistances**, et sort un **lien de recherche trade cliquable** pour chacun.

Résultat mesuré sur Winter Orb / Occultist, en partant d'un personnage nu :
résistances **-60/-60/-60 → 75/75/75**, chaos **-60 → +10**, l'audit passe en
`resCapped`.

Le pool de mods vient de PoB (4487 mods, 1106 bases) : préfixe/suffixe, niveau
d'objet requis, groupe d'exclusion, poids d'apparition par catégorie de base, et
surtout les `tradeHashes` — les identifiants de stats de l'API trade officielle.
**Aucun site de craft n'est scrapé** : Craft of Exile n'a pas d'API publique,
alors que PoB embarque la même donnée en local, déjà en 3.29 et sous licence MIT.

> **Les liens de trade sont des URL de site, pas des appels d'API.** Ils ouvrent
> la recherche pré-remplie dans ton navigateur, où tu es déjà connecté : ni
> POESESSID, ni Cloudflare, ni limite de débit. Leur structure n'a pas pu être
> testée en direct (pathofexile.com est bloqué depuis l'environnement de
> développement), mais les identifiants de stats viennent directement de PoB.

> **Ce n'est pas un simulateur de craft.** Aucune probabilité ni currency n'est
> modélisée. L'outil décrit l'objet à *chercher* ou à *viser*, en n'utilisant
> que des affixes pouvant réellement sortir sur cette base à ce niveau d'objet.

### Auras et co-optimisation

```bash
npx tsx src/cli.ts optimize "Winter Orb" --goal tankiness --auras --refine
```

`--auras` cherche les meilleures auras (Determination, Grace, Discipline,
Purity…) dans leurs propres groupes de liens, en respectant la **réservation
de mana** : PoB la modélise, et une aura de trop rend la compétence principale
inutilisable. L'outil affiche les auras écartées pour cette raison.

`--refine` relance une passe sur les gemmes de support **une fois l'arbre et
les auras en place**. Le meilleur support n'est pas le même sur un personnage
nu et sur un build monté : la seconde passe change effectivement le classement.

> **Pourquoi les gros builds atteignent 200-400k d'EHP :** ils font tourner
> Determination + Grace + Defiance Banner simultanément, ce qui n'est possible
> qu'avec beaucoup d'efficacité de réservation (Enlighten, masteries de mana,
> nœuds de Sovereignty). Sur un personnage nu, l'outil n'en fait passer que
> deux — et c'est correct : c'est la vraie contrainte du jeu.

### Compétences octroyées par un objet

Certains builds n'ont pas de gemme principale : leur dégât vient d'un unique.
Soulwrest déclenche « Summon Phantasm niveau 25 » — la compétence vient du
bâton, pas d'une gemme sertie.

PoB modélise ces compétences dans un groupe de liens portant un champ
`source` (`Item:1:Soulwrest, Ezomyte Staff`), et l'outil les expose désormais.
Vérifié : les gemmes de support serties agissent bien dessus (Minion Damage
fait passer le build de 184 à 281 de dégâts).

> **Correction importante :** ces builds étaient mesurés à **quasi zéro**
> auparavant. `CombinedDPS` ne regarde que la compétence du joueur — un build
> de minions ou de trigger y apparaît à 8 de DPS. Le score utilise maintenant
> **`FullDPS`**, qui agrège minions, compétences déclenchées et totems, avec
> l'option `includeInFullDPS` forcée sur tous les groupes actifs (les groupes
> créés par un objet naissent à `false`).

### Réservation de mana et déblocage des auras

Quand des auras sont écartées faute de mana, l'outil **relance l'arbre avec
ces auras posées**. Le score pénalise alors la mana insuffisante, si bien que
les nœuds de mana et de réservation deviennent les plus rentables :
l'optimiseur cherche de lui-même à débloquer l'aura au lieu de constater
qu'elle ne rentre pas.

Vérifié : la relance fait apparaître `Path of the Savant` et `Deep Wisdom`
(+20 mana) qui n'étaient pas retenus auparavant.

> Débloquer Determination ou Grace demande de l'**efficacité de réservation**
> (Sovereignty, Enlighten), pas seulement de la mana brute. Ces nœuds sont
> loin du départ : il faut augmenter `--tree-max-dist` pour que l'outil les
> atteigne.

### Conditions de combat

Un chiffre de DPS ne veut rien dire sans préciser contre quoi il est calculé.
Sur un même personnage, passer de « pas de boss » à Uber Pinnacle divise le
DPS par près de sept :

| Ennemi | DPS mesuré |
|---|---|
| aucun / boss standard | 1 816 |
| **Pinnacle** *(défaut PoB et le nôtre)* | 886 |
| Uber Pinnacle | 272 |

```bash
npx tsx src/cli.ts optimize "Winter Orb" --enemy uber --power-charges
npx tsx src/cli.ts gear "Winter Orb" --enemy boss --frenzy-charges --enemy-cursed
```

Options : `--enemy none|boss|pinnacle|uber`, `--enemy-level`,
`--power-charges`, `--frenzy-charges`, `--endurance-charges`,
`--enemy-cursed`. Le réglage retenu est affiché à chaque exécution.

> **Charges et effets « par charge maximum ».** Activer les charges change le
> crit du joueur, mais pas les effets libellés *per Maximum Power Charge you
> have* (Ancient Skull par exemple) : ceux-là comptent le maximum, pas les
> charges actives. C'est vérifié, pas supposé.

### Corpus de builds réels

```bash
npx tsx src/cli.ts corpus add -f mes-builds.txt   # un lien par ligne
npx tsx src/cli.ts corpus validate                # nos calculs vs ceux de l'auteur
npx tsx src/cli.ts corpus stats "Winter Orb"      # a priori de recherche
```

#### Importer en masse depuis ton installation Path of Building

```bash
npx tsx src/cli.ts corpus scan                    # détecte l'installation PoB
npx tsx src/cli.ts corpus scan "C:/Users/toi/Documents/Path of Building/Builds"
```

C'est la source de builds réels la plus riche et la plus immédiate : **aucun
réseau**. PoB écrit un `.xml` par build, déjà décodé, exactement au format
qu'on sait lire. Une installation un peu utilisée en contient des dizaines —
tous ceux que tu as importés ou fabriqués depuis le début.

Les emplacements usuels sont détectés seuls (Windows, OneDrive, Steam, Linux,
macOS, Wine). Le parcours est récursif : les sous-dossiers de rangement de PoB
sont suivis.

**Sous WSL**, le projet tourne côté Linux alors que Path of Building est
installé côté Windows : le dossier personnel de l'un ne mène pas à celui de
l'autre. La détection énumère donc aussi `/mnt/c/Users/*/Documents/…` et
`/mnt/d/…`, sans quoi elle ne trouverait jamais rien sur la configuration la
plus courante.

**Le contrôle de version est strict par défaut.** Un export PoB n'a pas de
champ « ligue », mais il porte la version de l'arbre, qui change à chaque
extension. Tout build qui n'est pas en `3_29` est écarté et signalé —
`--any-version` pour les garder quand même.

Vérifié sur une installation de test contenant deux builds 3.29, un build 3.25
et un fichier quelconque : `2 ajoutés · 0 mis à jour · 1 écartés · 1 illisibles`.

Voir `corpus/README.md`.

### Chercher la meilleure ascendance

```bash
npx tsx src/cli.ts ascendancy "Raise Zombie" --goal damage --tree-budget 40
npx tsx src/cli.ts ascendancy "Volatile Dead" --goal balanced --class Witch
```

Les **21 ascendances** des 7 classes sont réellement jouées : personnage
construit, arbre choisi, résultat mesuré. Rien ne présuppose que les minions
vont chez la Necromancer — c'est justement ce qu'il faut pouvoir remettre en
question, et le seul moyen de traiter une combinaison que personne n'a
essayée. La classe compte autant que l'ascendance : le point de départ décide
de ce qui est atteignable pour un budget donné.

La liste des ascendances est lue dans l'arbre chargé par PoB, jamais figée
dans le code — elle reste juste d'une ligue à l'autre.

> ⚠️ **Le budget de points change le classement.** Sur un budget court, une
> ascendance à bonus plats l'emporte sur une ascendance dont la puissance se
> compose avec l'investissement. Un classement obtenu à 35 points ne vaut pas
> pour un personnage niveau 95 équipé.

### Vitesse de recherche

L'optimiseur d'arbre passe par `calc_batch`, qui s'appuie sur le calculateur
incrémental de PoB (`GetMiscCalculator`) — celui qui alimente ses propres
infobulles « ce nœud vaudrait tant ». Une passe de base par lot, puis un
simple recalcul par candidat, au lieu de recharger le XML du build à chaque
fois. Mesuré sur un arbre de 30 points : **6 min 08 s → 22 s**, même résultat.

Piège à connaître si tu touches à ça : `override.addNodes` ajoute exactement
les nœuds fournis, **sans** emprunter le chemin qui y mène, là où `AllocNode`
alloue le chemin entier. Un optimiseur qui raisonne en points dépensés a
besoin de la seconde sémantique — d'où le dépliage de `node.path`. Sans lui,
31 candidats sur 40 renvoyaient la valeur de base.

### Découvrir à quoi un build répond

Le corpus apprend ce que les autres jouent déjà. Ça ne suffit pas : recopier
un PoB existant, autant prendre le PoB directement. La commande `sensitivity`
mesure le build lui-même, sans rien présupposer de la compétence.

```bash
npx tsx src/cli.ts sensitivity "Flicker Strike" --class Shadow --ascendancy Assassin \
  --goal damage --weapon "$(cat ma-griffe.txt)" --pairs
```

Chaque statistique est **réellement appliquée** au build puis recalculée par
PoB. Deux choses rendent la mesure utile :

- **Les couples** (`--pairs`). Certaines stats ne valent rien séparément. Un
  couple n'est retenu que s'il fait mieux que le produit de ses parties.
- **Deux doses** (`--scale`, 6 par défaut, budget partagé entre les sondes
  d'un couple). Une dose dit le gain marginal, le budget plein dit ce que
  l'axe vaut réellement investi. L'écart entre les deux est le verdict :
  `linéaire`, `à seuil`, `sature`, `sans effet`.

C'est ce qui rattrape le piège du critique. Sur Flicker Strike, la gemme ne
porte ni le tag crit ni le tag vitesse d'attaque, et le crit mesuré à une dose
ne rend que **+1,4 %** — du bruit. Investi, le couple chance + multiplicateur
rend **+49,9 %**, soit une accélération de **×3,0** : l'axe n'existe pas au
marginal, il n'existe qu'investi. La vitesse d'attaque, elle, ressort
franchement et **linéairement** (10 %/dose, sans seuil). Deux stats absentes
des tags de la gemme, deux raisons différentes de les prendre — trouvées par
la mesure, pas par une règle écrite à la main.

Une section dédiée liste les axes qu'un classement par gain brut enterre :
*« ce qu'une mesure stat par stat aurait raté »*.

### Règles non négociables

Le cap de résistances à 75 % n'est pas un bonus mais une **contrainte** : tant
qu'il n'est pas atteint, le score entier est pénalisé. Concrètement
l'optimiseur va chercher `Sentinel` (+10 % toutes résistances) avant des
notables de dégâts, ce qu'il ne faisait pas sans cette règle. L'audit signale
aussi un overcap insuffisant (< 25 %), car une map Elemental Weakness fait
retomber sous le cap.

### Arbre de passifs

```bash
# Budget de points (par défaut : niveau - 1 + 22 points de quête)
npx tsx src/cli.ts optimize "Winter Orb" --tree-budget 60

# Régler la recherche : distance max des candidats, nœuds par passe, seuil de gain
npx tsx src/cli.ts optimize "Winter Orb" --tree-max-dist 10 --tree-batch 3 --tree-min-gain 0.5

# Isoler une étape
npx tsx src/cli.ts optimize "Winter Orb" --no-supports   # arbre seul
npx tsx src/cli.ts optimize "Winter Orb" --no-tree       # gemmes seules
```

L'arbre est optimisé **après** les gemmes, avec le setup retenu : le gain d'un
notable dépend des supports en place. Le pathfinding et le coût en points sont
calculés par PoB (`AllocNode`), pas réimplémentés.

> **Comment lire le gain d'un notable :** il mesure l'écart entre l'arbre avant
> et après, *chemin compris*. Un nœud à faible gain peut donc en tirer une part
> des petits passifs traversés pour l'atteindre — ce n'est pas uniquement
> l'effet de ses propres statistiques.

```bash
npx tsx src/cli.ts optimize "Detonate Dead" --goal balanced --locale es
npx tsx src/cli.ts search "winter"      # recherche de gemme
npx tsx src/cli.ts doctor               # vérifie l'installation
npx tsx src/cli.ts optimize "Winter Orb" --json   # sortie machine
```

Langues : **français** (défaut), anglais, espagnol — `src/i18n/locales/*.json`,
aucun texte en dur dans le code.

---

## Audit des données 3.29

Un audit complet — ce sur quoi le logiciel s'appuie, ce qui est vérifié, ce
qui ne l'est pas, et ce qui reste à brancher — est dans
[`docs/audit-3.29.md`](docs/audit-3.29.md).

Résumé : PoB embarque en local **3 164 gemmes, 1 318 uniques, 4 310 mods
explicites, 1 127 bases, 557 mods de cluster jewel, 834 enchantements,
105 essences, 268 spectres**, l'arbre 3.29 complet et les identifiants de
stats de l'API trade. **Il n'y a presque rien à aller chercher dehors** — ce
qui manque au logiciel n'est pas la donnée, c'est de l'exposer.

## Vérifications 3.29 (Phase 0)

| Point | Résultat |
|---|---|
| Ligue 3.29 « Curse of the Allflame » réelle | ✅ confirmé (lancée le 24/07/2026, patch 3.29.1 le 30/07) |
| PoB Community Fork à jour 3.29 | ✅ v2.66.2, section « 3.29 - Allflame » au changelog |
| Arbre de passifs 3.29 chargé par le moteur | ✅ `treeVersion 3_29` vérifié à l'exécution |
| Données de gemmes 3.29 | ✅ 870 gemmes (607 actives, 263 supports) lues depuis PoB |
| Refonte des sockets 3.29 en jeu | ✅ confirmée (sockets universels, +10 % qualité si couleur) |
| Refonte des sockets **dans le moteur PoB** | ⚠️ **pas encore reflétée** — voir ci-dessous |

### ⚠️ Divergence connue : sockets

En 3.29, GGG a supprimé les contraintes de couleur de socket (toute gemme entre
partout, +10 % de qualité si la couleur correspond). **Le code de PoB
(`src/Classes/Item.lua`) assigne encore des couleurs de socket à l'ancienne.**
Les données 3.29 (gemmes, arbre, uniques) sont bien à jour, mais cette mécanique
précise ne l'est pas.

Conséquence : tant que PoB n'a pas patché ça, ne pas s'appuyer sur ce moteur pour
la logique de couleurs de socket. Le présent outil raisonne uniquement en **nombre
de liens**, ce qui n'est pas affecté.

---

## Architecture

```
src/
  pob/engine.lua      Pont Lua : PoB headless piloté en JSON sur stdin/stdout
  pob/bridge.ts       Processus LuaJIT persistant, protocole de requêtes
  pob/buildXml.ts     Sérialisation d'un build vers le XML de PoB
  data/gems.ts        Index des gemmes, extrait de PoB (jamais scrapé)
  domain/goals.ts     Objectifs → pondérations, fonction de score
  domain/optimizer.ts     Sélection gloutonne des supports, mesurée par le moteur
  domain/treeOptimizer.ts Arbre de passifs et masteries, mesurés par le moteur
  domain/audit.ts         Règles dures : cap de résistances, overcap, pools
  domain/gearOptimizer.ts Choix d'uniques par emplacement, mesuré par le moteur
  domain/auraOptimizer.ts Auras, sous contrainte de réservation de mana
  domain/budget.ts        Paliers de budget adossés aux prix
  domain/config.ts        Conditions de combat (boss, charges, malédiction)
  pob/pool.ts             Moteurs PoB en parallèle
  corpus/                 Builds de référence : validation et a priori
  data/uniques.ts         Index des uniques PoB, variante actuelle sélectionnée
  data/itemMods.ts        Pool de mods et bases d'objets, extraits de PoB
  domain/rareBuilder.ts   Objets rares cibles, priorité au cap de résistances
  trade/searchLink.ts     Liens de recherche vers le site de trade officiel
  trade/ninja.ts          Client poe.ninja (prix) — non vérifié, voir plus haut
  pob/importCode.ts       Décodage d'un code PoB / lien pastebin / pobb.in
  server/                 Interface web (SSE) + fichiers statiques
  report/render.ts    Rapport terminal + sortie JSON
  i18n/               FR / EN / ES
```

Le moteur tourne dans **un processus persistant** : l'initialisation de PoB coûte
plusieurs secondes, et une optimisation enchaîne 300+ évaluations.

**Stack : TypeScript / Node 22.** Choisi parce que le moteur reste en Lua (piloté
en sous-processus, aucun binding fragile), que la future interface web partagera
le code métier, et que les briques réutilisables de l'écosystème PoE
(awakened-poe-trade) sont en TypeScript.

---

## Inventaire de la réutilisation (Phase 0)

| Projet | Licence | Décision |
|---|---|---|
| **PathOfBuilding Community Fork** | MIT | **Réutilisé tel quel** — moteur de calcul, données de jeu, `HeadlessWrapper.lua` |
| `ianderse/pob-mcp` | — | Référence pour le protocole stdio (PR #9505 non mergée) |
| `alecrivet/poe-optimizer` | MIT déclarée, **pas de fichier LICENSE** | Principe repris (subprocess → HeadlessWrapper), code non importé |
| `SnosMe/awakened-poe-trade` | MIT | À forker pour le parser d'item et le rate-limiter (Phase suivante) |
| `cboyd421-max/poe2-forge` | **Aucune licence** | Référence de proxy trade uniquement — ne pas copier de code |
| `HivemindOverlord/poe2-mcp` | MIT | Patron d'architecture seulement (données PoE2, inutilisables ici) |

### Si le projet devient public ou commercial

- **PoB est en MIT** : réutilisation commerciale possible, attribution requise.
  Ses dépendances embarquées sont MIT/BSD/Apache/ISC ; seul `base64.lua` est LGPL.
- `poe2-forge` **n'a aucune licence** → tout code copié de là serait un problème.
  Rien n'en a été repris.
- L'API trade officielle est utilisée par rétro-ingénierie communautaire, hors du
  périmètre documenté par GGG (clause 7i des CGU). Toléré depuis des années pour
  un usage perso, à réévaluer avant toute distribution large.

---

## Limites actuelles (assumées)

- **Pas encore d'équipement.** L'arbre et les gemmes sont bien calculés, mais le
  personnage est nu : les valeurs absolues restent donc basses, et ce sont les
  **écarts** qui font foi, pas le DPS affiché.
- **Les objectifs `life` et `tankiness` ne discriminent pas au niveau des liens**
  de compétence : aucune gemme de support ne modifie les défenses. L'outil
  l'affiche explicitement au lieu de faire semblant. En revanche ils sont bien
  pris en compte par l'optimisation d'arbre.
- **L'arbre est optimisé glouton, par passes.** Une évaluation d'arbre coûte
  environ dix fois une évaluation de gemme (PoB reconstruit tous les chemins),
  donc plusieurs nœuds sont alloués par balayage plutôt qu'un seul. Le résultat
  est bon mais pas prouvé optimal, et un budget complet (111 points) prend
  plusieurs minutes.
- **Les jewels et jewels de cluster ne sont pas encore gérés** (les masteries,
  elles, le sont).
- **Pas d'équipement, donc pas de résistances réelles.** L'audit et la
  contrainte de cap fonctionnent, mais sur un personnage nu tout est à -60 % :
  ils prennent leur sens sur un build importé ou une fois le gear intégré.
- **Prix jamais testés en conditions réelles** (poe.ninja bloqué ici). Le code
  est là, la vérification reste à faire.
- **Pas de recherche sur le trade officiel.** L'API demande un POESESSID et
  passe derrière Cloudflare ; rien n'est encore implémenté de ce côté.
- **L'optimiseur d'équipement ne propose que des uniques.** Les rares sont
  générés séparément (`rares`), pas encore intégrés à la boucle d'optimisation.
- **Pas de simulation de craft** : ni probabilités, ni coût en currency, ni
  ordre des étapes.
- **Liens de trade non testés en direct** (pathofexile.com bloqué ici).
- La sélection des supports est **gloutonne** : elle mesure chaque candidat mais
  n'explore pas toutes les combinaisons.

## Suite

1. Vérifier poe.ninja et les liens de trade hors environnement bloqué
2. Intégrer les rares à la boucle d'optimisation, aux côtés des uniques
3. Jewels et cluster jewels
4. Suggestions de craft (currency, base, ordre des étapes)
5. Couche IA (langage naturel → requête structurée)

## Licence

MIT. Voir l'inventaire ci-dessus pour les licences des composants réutilisés.
