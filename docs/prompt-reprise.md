# Prompt de reprise

À coller tel quel au démarrage d'une nouvelle session Claude Code, dans le
dossier du projet. Il rassemble le brief d'origine, tout ce qui a été demandé
depuis, et l'état réel du dépôt.

---

Tu reprends **PoE Build Architect**, un optimiseur de builds Path of Exile 1
pour la ligue 3.29 « Curse of the Allflame », bâti sur le vrai moteur de calcul
de Path of Building.

**Commence par lire `README.md` et `docs/audit-3.29.md`.** Ils contiennent
l'état complet du projet, ce qui est vérifié, ce qui ne l'est pas, et ce qui
reste à faire. Ne me redemande pas ce qui y est déjà écrit.

## Règles non négociables

1. **NE RIEN RECODER QUI EXISTE DÉJÀ GRATUITEMENT.** Avant d'écrire la moindre
   logique, cherche activement s'il existe un projet libre qui fait le travail,
   et réutilise-le : fork, import de module, appel de bibliothèque, d'API ou de
   moteur. Lis le CODE, pas les README. Note la licence exacte de tout ce que
   tu intègres, et signale ce qui poserait problème en cas de distribution
   publique ou commerciale. Du GPL-3.0 embarqué interdit le closed source :
   dis-le avant d'intégrer, pas après.
2. **Ne réimplémente jamais une formule de dégâts ou de défense.** PoB calcule,
   on ne fait que le piloter. Si tu as besoin d'un chiffre, demande-le au
   moteur.
3. **Tout doit être calé sur la 3.29.** Si tu trouves une divergence entre une
   source ancienne et l'état réel du jeu, **signale-la-moi clairement** plutôt
   que d'utiliser la donnée obsolète en silence.
4. **Mesure, ne devine pas.** Chaque affirmation chiffrée doit venir d'une
   exécution réelle. Si tu n'as pas pu vérifier, dis-le au lieu de combler.
5. **i18n FR/EN/ES dès l'écriture**, fichiers de traduction séparés, aucun
   texte en dur dans le code.
6. **Architecture modulaire propre, sans sur-ingénierie prématurée.**

## Ce que le logiciel doit savoir faire

**Sortie finale attendue**, pour un build donné : quels liens dans quel objet,
gemme principale et gemmes de support, arbre de passifs, statistiques à viser
par emplacement, et l'ordre de priorité des stats. Je dois pouvoir demander
« plus de dégâts », « plus de vie », « plus de tankiness » et voir le résultat
changer.

**Importer un build existant** (lien pobb.in, code PoB, fichier local) et me
dire quoi améliorer, dans quel ordre.

**Résistances élémentaires cappées à 75 %** : c'est une contrainte dure, pas un
bonus. Le chaos aussi si c'est atteignable.

**Chercher, pas recopier.** C'est le point le plus important. Si le logiciel se
contente de reproduire des builds existants, autant prendre un PoB déjà fait.
Il doit **tester et découvrir** par la mesure. Exemple concret : sur Flicker
Strike, la vitesse d'attaque et le critique sont décisifs alors que la gemme ne
porte ni l'un ni l'autre dans ses tags. Une lecture des tags rate les deux.
La commande `sensitivity` résout ça — comprends comment avant d'y toucher.

**Demander un build par archétype** (« necro minion crit », « witch volatile
dead crit », flicker, spectral throw, winter orb…) et qu'il cherche la
meilleure ascendance et le meilleur arbre en testant un maximum de
combinaisons. Il doit tenir compte du point de départ dans l'arbre : ne pas
m'envoyer à l'opposé sauf si c'est réellement rentable.

**Les builds à empilement d'attributs** (force, dextérité, intelligence) et les
uniques qui convertissent un attribut en dégâts ou en vitesse doivent être
traités comme le reste : par la mesure, pas par des règles écrites à la main.

**Vérifier la configuration de combat** : boss pinnacle ou non, niveau et
résistances de l'ennemi, malédictions réellement appliquées, buffs, charges. Un
chiffre de DPS ne veut rien dire sans ces conditions.

**Interface visuelle, propre, simple à utiliser mais complète.**

## Apprendre de vrais builds

Je veux nourrir la machine avec beaucoup de PoB réels et variés. `corpus scan`
lit mon installation Path of Building locale ; `corpus add` prend des liens.
Le contrôle de version d'arbre est strict : seuls les builds en `3_29` entrent,
sauf `--any-version`.

## Audit du jeu à poursuivre

PoB embarque déjà en local, en 3.29 et sous MIT : 3 164 gemmes, 1 318 uniques,
4 310 mods explicites, 1 127 bases, 557 mods de cluster jewel, 834
enchantements, 105 essences, 268 spectres, les pantheons, les timeless jewels
et l'arbre complet. **Il n'y a presque rien à aller chercher dehors** — ce qui
manque n'est pas la donnée mais son exposition.

Reste à brancher, par ordre de valeur : cluster jewels, jewels normaux et
abyssaux, flasks, enchantements, essences et craft dirigé, pantheons, spectres,
timeless jewels.

## Ce que cet environnement débloque

La session précédente tournait dans un conteneur distant où **tous les domaines
PoE étaient bloqués** (403 au CONNECT sur poe.ninja, pathofexile.com, poewiki,
maxroll, pobb.in, reddit). Ici, sur ma machine, ils devraient être accessibles.
Trois choses en découlent :

1. **Corriger `src/trade/ninja.ts`**, qui vise une API morte. poe.ninja a migré
   vers `https://poe.ninja/poe1/api/economy/current/dense/overviews?league={league}&language=en`
   — une seule requête au lieu d'une quinzaine — et la forme des lignes a
   changé : `{name, variant?, chaos, graph}`, sans `divineValue`,
   `listingCount`, `links` ni `gemLevel`. La valeur en divine se dérive du prix
   en chaos du `Divine Orb` dans la même réponse. **Vérifie contre une vraie
   réponse avant de coder.**
2. **Utiliser `https://www.pathofexile.com/api/leagues`** (ni Cloudflare ni
   OAuth) pour connaître le nom exact de la ligue, au lieu de le coder en dur.
3. **Trancher les points laissés ouverts** dans `docs/audit-3.29.md` : le
   remaniement des sockets 3.29, et si Reliquarian et Luminary sont des ajouts
   de la 3.29.

Le pool de moteurs PoB prend `nproc - 1` processus : sur cette machine, les
recherches longues iront nettement plus vite qu'avant.

## Méthode de travail

Développe sur la branche `claude/poe1-build-architect-phase0-27u4tv`, commits
clairs, push quand c'est vérifié. Ne crée pas de pull request sans que je le
demande.

Quand tu affirmes un gain, montre la mesure. Quand une source te manque,
dis-le. Quand tu trouves que je me trompe, dis-le aussi — corrige-moi plutôt
que de suivre une idée fausse.

## Pour commencer

1. `npm install` puis `npm run setup` (installe LuaJIT, lua-utf8 et clone PoB,
   ~1,1 Go).
2. `npx tsx src/cli.ts corpus scan` — importe mes builds Path of Building
   locaux et dis-moi combien tu en trouves et lesquels sont écartés.
3. Puis propose-moi la suite en fonction de ce que le corpus révèle.
