# Audit des données 3.29

Ce document répond à une question : **sur quoi le logiciel s'appuie-t-il, et
qu'est-ce qui est réellement vérifié ?** Chaque ligne porte son niveau de
confiance et sa source. Ce qui n'a pas pu être vérifié est dit comme tel plutôt
que comblé de mémoire.

Date de l'audit : 4 août 2026. PoB Community Fork au commit `50d2236` (3 août
2026), arbre `3_29`.

---

## Accès réseau : ce qui est ouvert, ce qui ne l'est pas

L'environnement de développement passe par un proxy d'egress à politique
d'entreprise. Vérifié en interrogeant `$HTTPS_PROXY/__agentproxy/status` :

| Domaine | État | Détail |
|---|---|---|
| `github.com`, `api.github.com` | ✅ **ouvert** | clonage et API vérifiés |
| `poe.ninja` | ❌ bloqué | `connect_rejected` — 403 au CONNECT |
| `pathofexile.com` | ❌ bloqué | idem, y compris l'API trade et le forum |
| `poewiki.net` | ❌ bloqué | idem |
| `maxroll.gg`, `pobb.in`, `reddit.com` | ❌ bloqués | idem |

Conséquence directe, et elle est structurante :

- **La donnée de jeu ne vient pas du web.** Elle vient du dépôt PoB cloné en
  local, qui est à jour en 3.29 et sous licence MIT. C'est de toute façon la
  meilleure source : c'est celle qui sert aux calculs.
- **GitHub étant ouvert**, tout l'outillage libre reste atteignable et
  clonable — c'est là que passe la règle « ne rien recoder ».
- **Le méta reste hors de portée** : popularité des builds, prix, ce que les
  joueurs jouent réellement. Le client poe.ninja existe dans le code mais
  **n'a jamais tourné contre le vrai service**. À valider hors de cet
  environnement.

La recherche web (moteur de recherche) fonctionne et donne titres et résumés,
mais **pas le contenu des pages** de ces domaines. Les patch notes officiels
n'ont donc pas pu être lus ligne à ligne.

---

## Ce que PoB embarque, et que nous n'avons pas à chercher ailleurs

Compté directement dans `vendor/PathOfBuilding/src/Data` :

| Donnée | Volume | Fichier |
|---|---|---|
| Gemmes (actives + supports) | **3 164** | `Skills/*.lua` |
| Objets uniques | **1 318** | `Uniques/*.lua` |
| Mods explicites | **4 310** | `ModExplicit.lua` |
| Mods eldritch | **4 086** | `ModEldritch.lua` |
| Mods de synthèse | **1 344** | `ModSynthesis.lua` |
| Bases d'objets | **1 127** | `Bases/*.lua` |
| Enchantements | **834** | `Enchantment*.lua` |
| Mods de jewel abyssal | **721** | `ModJewelAbyss.lua` |
| Tatouages | **727** | `TattooPassives.lua` |
| Mods de cluster jewel | **557** | `ModJewelCluster.lua` |
| Mods de jewel | **425** | `ModJewel.lua` |
| Mods corrompus | **371** | `ModCorrupted.lua` |
| Spectres | **268** | `Spectres.lua` |
| Mods veiled | **258** | `ModVeiled.lua` |
| Mods de flask | **246** | `ModFlask.lua` |
| Mods de delve | **186** | `ModDelve.lua` |
| Essences | **105** | `Essence.lua` |
| Minions | **64** | `Minions.lua` |

Plus, non compté à l'unité : `ClusterJewels.lua`, `Pantheons.lua`,
`BeastCraft.lua`, `Rares.lua`, `TimelessJewelData/` (jewels de Legion),
`TradeSiteStats.lua` (2,6 Mo d'identifiants de stats de l'API trade), et
l'arbre complet `TreeData/3_29/tree.lua` (16 Mo).

**Conclusion de l'audit : il n'y a presque rien à aller chercher dehors.**
Ce qui manque au logiciel n'est pas la donnée, c'est de l'exposer et de s'en
servir. Voir « Reste à brancher » plus bas.

---

## Classes et ascendances (vérifié)

Lu dans l'arbre 3.29 chargé par PoB via l'action `classes` : **7 classes,
21 ascendances**.

| Classe | Str/Dex/Int | Ascendances |
|---|---|---|
| Scion | 20/20/20 | Ascendant, Reliquarian, Luminary |
| Marauder | 32/14/14 | Juggernaut, Berserker, Chieftain |
| Ranger | 14/32/14 | **Warden**, Deadeye, Pathfinder |
| Witch | 14/14/32 | Occultist, Elementalist, Necromancer |
| Duelist | 23/23/14 | Slayer, Gladiator, Champion |
| Templar | 23/14/23 | Inquisitor, Hierophant, Guardian |
| Shadow | 14/23/23 | Assassin, Trickster, Saboteur |

### ⚠️ Piège vérifié : identifiant interne ≠ nom affiché

Dans `tree.lua`, l'ascendance des Ranger porte `id = "Raider"` mais
`name = "Warden"`. GGG conserve l'identifiant d'origine quand une ascendance
est renommée. **Lire `id` ferait afficher un nom mort.** Le code lit `name` et
conserve `id` séparément sous `internalId`.

Le même écart peut exister ailleurs : ne jamais afficher un `id` d'arbre.

### Non vérifié

Reliquarian et Luminary sont **présentes dans l'arbre 3.29 avec de vrais
nœuds** (36 et 18 respectivement, contre 50 pour Ascendant) — ça, c'est
mesuré. En revanche, **savoir si elles sont des ajouts de la 3.29 ou
antérieures n'a pas pu être vérifié**, les patch notes et le wiki étant
bloqués. Ne pas l'affirmer.

---

## Sockets 3.29 : divergence toujours ouverte

Le remaniement des couleurs de socket est annoncé par toutes les sources
secondaires (« toute gemme dans n'importe quel socket, +10 % de qualité si la
couleur correspond »). Mais `Item.lua` de PoB **continue d'assigner des
contraintes de couleur à l'ancienne**.

Statut : **divergence non résolue**. Deux lectures possibles — PoB n'a pas
répercuté le changement, ou les sources secondaires exagèrent la portée du
remaniement. Le texte officiel n'ayant pas pu être lu, la question reste
ouverte. Le logiciel ne s'appuie sur aucune contrainte de couleur pour ses
recommandations, donc il n'en dépend pas ; l'interface le signale.

---

## Uniques à scaling d'attribut (vérifié)

Extraits de la base PoB : **43 uniques** font dépendre une statistique d'un
attribut. Les plus structurants pour un build à empilement :

| Unique | Effet |
|---|---|
| The Iron Fortress | Le bonus de dégâts de la Force donne 3 % de dégâts physiques de mêlée par 10 Force |
| Pillar of the Caged God | 16 % dégâts d'arme physiques / 10 Force · vitesse d'attaque / 10 Dex · zone / 20 Int |
| Hand of Wisdom and Action | Dégâts de foudre / 10 Int · 1 % vitesse d'attaque / 25 Dex |
| Replica Alberon's Warpath | 1 à 80 dégâts de chaos aux attaques par 80 Force |
| Shaper's Touch | Précision / 2 Int · vie / 4 Dex · ES / 10 Force · dégâts de mêlée / 10 Dex |
| Mask of the Stitched Demon | +1 vie max par 2 Intelligence |
| Fractal Thoughts | Dégâts élémentaires / 10 Dex · +2 vie / 10 Int |
| Iron Commander / Replica | Totems de balliste supplémentaires par 200 Dex / Force |
| Transcendent Flesh / Mind / Spirit | Réduction physique, multi de critique, mouvement selon les attributs alloués dans le rayon |

Ces uniques ne sont pas codés en dur : ils sont dans la base PoB, et la
commande `sensitivity` les détecte par la mesure. Vérifié sur Sunder — passer
d'une plaque rare à The Iron Fortress fait monter la valeur de la Force de
+95,5 % à +130,5 %.

---

## Reste à brancher

Par ordre de valeur, sur la base de l'audit ci-dessus. Tout est **déjà présent
en local** : c'est de l'exposition, pas de la collecte.

1. **Cluster jewels** (`ClusterJewels.lua` + 557 mods). Structurants pour la
   puissance d'un build, complètement absents du logiciel aujourd'hui.
2. **Jewels normaux et abyssaux** (425 + 721 mods).
3. **Flasks** (246 mods). Couche offensive et défensive entière, ignorée.
4. **Enchantements** (834), dont les enchants de casque, souvent décisifs.
5. **Essences** (105) et `BeastCraft` pour les suggestions de craft dirigé.
6. **Pantheons** — couche défensive gratuite, jamais proposée.
7. **Spectres** (268) — pour les builds d'invocation.
8. **Timeless jewels** (`TimelessJewelData/`) — transforment des pans entiers
   d'arbre.

---

## Ce qui reste non vérifiable ici

- Prix et méta (poe.ninja bloqué) — le client existe, jamais exécuté en réel.
- Structure des liens de recherche trade (pathofexile.com bloqué) — les
  identifiants de stats viennent de PoB, la forme de l'URL n'est pas testée.
- Texte exact des patch notes 3.29.0 / 3.29.1.
- Popularité réelle des builds, donc tout classement « ce que les gens
  jouent ». Le corpus est alimenté à la main, et c'est le seul moyen ici.
