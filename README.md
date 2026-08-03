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
  domain/treeOptimizer.ts Allocation de l'arbre de passifs, mesurée par le moteur
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
- **Les jewels, masteries et jewels de cluster ne sont pas encore gérés.**
- **Pas encore de trade ni de prix.** L'optimiseur propose volontiers des gemmes
  Awakened, sans notion de budget.
- La sélection des supports est **gloutonne** : elle mesure chaque candidat mais
  n'explore pas toutes les combinaisons.

## Suite

1. Équipement et modificateurs, puis intégration trade officielle + poe.ninja
2. Paliers de budget (league start → mirror tier)
3. Masteries et jewels dans l'optimisation d'arbre
4. Couche IA (langage naturel → requête structurée)
5. Interface web FR/EN/ES

## Licence

MIT. Voir l'inventaire ci-dessus pour les licences des composants réutilisés.
