# Corpus de mécaniques PoE 1 — 3.29 « Curse of the Allflame »

Notes de recherche destinées à alimenter les règles de l'optimiseur.

> **Fiabilité des sources.** Le proxy réseau de l'environnement de développement
> bloque `pathofexile.com`, `poewiki.net`, `poedb.tw` et `maxroll.gg` (403). Une
> partie des points ci-dessous vient donc de résumés indexés et de sites
> revendeurs de currency, dont la fiabilité est faible et qui se recopient entre
> eux. Les valeurs chiffrées de gemmes **ne doivent pas être codées en dur**
> avant vérification sur les patch notes officiels.
>
> Niveaux de confiance : **[C1]** ≥ 3 sources concordantes · **[C2]** 1–2 sources
> secondaires, à revérifier.

---

## 1. Ce qui est vérifié directement dans les données du jeu

Ces points ne viennent pas du web mais du dépôt PoB installé, donc fiables :

- PoB Community Fork **v2.66.2**, changelog avec une section « 3.29 - Allflame ».
- Arbre chargé par le moteur : `treeVersion 3_29`.
- **870 gemmes** (607 actives, 263 supports).
- La gemme **Invert the Rules** existe bien (tags `support`, `exceptional`,
  `low_max_level`) — l'optimiseur la remonte comme très forte sur Winter Orb.

---

## 2. Sockets — refonte 3.29 **[C1]**

- Toute gemme entre dans **n'importe quel socket**, aucune pénalité de mismatch.
- Socket de couleur correspondante → **+10 % de qualité** à la gemme.
  Socket blanc : fonctionne partout, aucun bonus.
- **Les liens existent toujours** ; l'Orb of Fusing reroll toujours les liens.
- Les drops sortent avec des sockets **blancs par défaut**.
- **Chromatic Orb** force désormais un socket à devenir non-blanc ; devenu plus
  rare. Jeweller's / Orb of Binding ajoutent toujours des sockets, **blancs**.
- Recettes de bench « X sockets rouges/verts/bleus » supprimées, remplacées par
  « au moins 2 / 3 / 4 sockets non-blancs » **[C2]**.
- La **qualité d'objet** augmente la chance de sockets non-blancs à la
  génération — nouvelle utilité pour la qualité **[C2]**.

**Conséquence pour l'outil.** La couleur n'est plus une contrainte de
faisabilité : ne jamais rejeter un setup pour raison de couleur. Le matching
devient une optimisation de fin de build (+10 % qualité par gemme). L'outil
raisonne donc uniquement en **nombre de liens** — c'est le bon choix.

⚠️ **PoB n'a pas encore intégré cette refonte** dans `src/Classes/Item.lua`
(vérifié dans le code) : il assigne toujours des couleurs à l'ancienne.

---

## 3. Résistances — contraintes dures

| Règle | Valeur |
|---|---|
| Cap par défaut | **75 %** feu / froid / foudre |
| Hard cap absolu | 90 % |
| Pénalité de campagne | −30 % (Acte 5) puis −60 % (Acte 10) |
| Overcap cible mapping | **+25 à +30 %** |
| Overcap pour Uber / maps ele weakness | ≥ +30 %, idéalement +40 à +50 |

Pire cas cumulable : Elemental Weakness (jusqu'à −44 % avec qualité) + mod de
map (~−15 %) + Exposure (−25 %) ⇒ jusqu'à **−84 %**.

Un algorithme doit traiter `res ≥ 75 + overcap` comme **contrainte**, pas comme
objectif à maximiser : au-delà de 75 % effectif, la valeur marginale est nulle
hors malédiction. En revanche chaque **+1 % de max res** vaut ≈ +4 % d'EHP
élémentaire — ça, c'est un multiplicateur.

Sources de max res > 75 % : Purity of Fire/Ice/Lightning, Loreweave,
Saffell's Frame, flasks Ruby/Sapphire/Topaz (+5 %), Melding of the Flesh
(égalise les max res), Divine Flesh (+5 % max chaos).

**Chaos res** : cible pragmatique ≥ 0 % pour un build vie. **Non sourcé pour
3.29** — heuristique de ligues antérieures. Divine Flesh inverse la priorité
(50 % des dégâts élémentaires pris comme chaos) : la chaos res devient alors la
stat n°1.

**Hiérarchie défensive endgame** : cap + overcap → pool suffisant (anti
one-shot) → mitigation (armure / spell suppression / block / max res) →
évitement → récupération → immunités.

---

## 4. Archétypes défensifs et gros pools d'ES

- **Vie pure** : plafond ~5–7 k. Nécessite mitigation (armure, evasion,
  suppression) et sustain (leech instant, recoup, flasks).
- **CI / ES pur** : vie fixée à 1, immunité chaos totale. Interdit Petrified
  Blood, MoM sur vie, régénération de vie.
- **Hybride** : via Ghostwrithe (vie → ES, **nerfé 40 % → 35 % en 3.29**),
  Zealot's Oath (regen vie → ES).
- **Low Life** : Shavronne's Wrappings + réservations massives.

Atteindre **6 000–8 000+ ES** vient du cumul : bases ES pures sur tous les slots
× 600–800 % d'increases (gear + arbre) + flat ES (Discipline, abyss jewels,
Watcher's Eye) + ascendancy (Occultist *Vile Bastion*, Trickster *Ghost Dance*,
Guardian *Radiant Faith*) + masteries ES.

### ⚠️ Point à corriger : « increases to Armour appliquées à l'ES »

**Aucun node, mastery ou unique de PoE 1 en 3.29 ne fait s'appliquer les
increases d'Armour au pool d'Energy Shield.** Vérifié dans les données PoB et
confirmé par la recherche.

Ce qui existe réellement :
- Mastery *Armour and Energy Shield* : « Increases and Reductions to Armour also
  apply to Energy Shield **Recharge Rate** at 20 % of their value » — c'est la
  **vitesse de recharge**, pas le pool.
- Le mod complet « increases to Armour also apply to Energy Shield » existe en
  **Path of Exile 2**, pas en PoE 1 — confusion probable.

---

## 5. Masteries

Une **Mastery** par groupe de passifs ; dès qu'un passif du groupe est alloué,
on peut dépenser un point pour choisir **une seule** option parmi ~6, **une fois
par groupe**. C'est le meilleur rendement par point de l'arbre : certaines
options valent un notable entier ou un slot de gear.

Options les plus prises (données de ladder, ligue antérieure) :
- **Leech** — « 10 % of Leech is Instant » (vie, mana et ES).
- **Elemental** — « 25 % chance to treat enemy elemental resistance as inverted ».
- **Spell Suppression** — monter vers 100 % (= 50 % less spell damage).
- **Mana** — +12 % d'efficacité de réservation.
- **Life** — +50 vie plate, ou regen 2 % sur 1 s quand touché.
- **ES** — recharge non interrompue par les dégâts ; recharge démarrée par
  l'usage d'un skill.

L'outil gère les masteries : chaque **effet** est un candidat distinct mis en
concurrence avec les notables.

---

## 6. Keystones — quand c'est bon, quand c'est un piège

| Keystone | Bon si | Piège si |
|---|---|---|
| Chaos Inoculation | ES ≥ ~4 000 | ES faible, ou build dépendant de la regen de vie |
| Mind Over Matter | grosse mana + regen | mana réservée à ~90 % |
| Eldritch Battery | réservation lourde | combiné à CI (anti-synergie) |
| Elemental Overload | pas d'investissement crit | dès qu'on a du crit multi |
| Resolute Technique | attaques non-crit | besoin de crit ou d'ailments par crit |
| Acrobatics | evasion pure | build armour / ES |
| Iron Reflexes | Grace + scaling armure | — |
| Zealot's Oath | forte régen (Guardian, Chieftain) | peu de régen |
| Blood Magic | réservations à 100 % | combiné à MoM / ES |
| Divine Flesh | investissement chaos res massif | chaos res faible |
| **Unhallowed Rite** (rework 3.29) | channelling — *Spirit Infusion*, 5 stacks max : +30 % faster ES recharge start, +10 % more damage, +20 % more cost par stack | hors channelling |

---

## 7. Uniques structurants

| Unique | Effet structurant | Ordre de prix |
|---|---|---|
| **Mageblood** | 4 flasks utilitaires permanents à effet max, sans charges | ~175 div **[C2]** |
| **Headhunter** | vole les mods des rares tués (60 s) | 200–300 div **[C2]** |
| **Progenesis** | 25 % des dégâts pris sur la durée | 50–150 div |
| **Ashes of the Stars** | +qualité et +1 niveau de gemmes | 30–80 div |
| **Original Sin** | conversion totale en chaos | 100+ div |
| **Melding of the Flesh** | égalise les max res | 10–40 div |
| **Ghostwrithe** | vie → ES, **nerfé en 3.29** | low–mid |
| **Shavronne's Wrappings** | habilite le Low Life | mid |
| **Spinesnatch** *(nouveau 3.29)* | hache 2M, 6 sockets abyssaux | chase |
| **Subsume the Source** *(nouveau 3.29)* | amplifie les abyss jewels | chase |

**Vestigial Uniques** *(nouveau 3.29)* : Legion reworké, incubateurs supprimés.
Les *Enshrouded Items* + 5 *Enshrouding Crystals* transforment un unique en un
autre unique du même slot avec un implicite vestigial — nouvelle dimension
d'optimisation par slot **[C2]**.

---

## 8. Flasks

5 slots. Vie/mana consomment des charges ; les utilitaires donnent des buffs
temporaires. Mods clés : *of the Iron Skin*, *of Reflexes*, increased effect,
increased duration, immunités.

- **Enkindling Orb** : effet fortement augmenté mais plus de gain de charges →
  bossing ou Mageblood.
- **Instilling Orb** : déclenchement automatique conditionnel → gère l'uptime.
- Setup Mageblood standard : Granite + Jade + Quicksilver + Bismuth, avec
  Diamond ou Ruby en substitution.

**Aucun changement de flask spécifique à 3.29 identifié.**

---

## 9. Minions — règles de scaling

**Les minions sont des entités séparées** et utilisent **leurs propres** stats.
N'ont **aucun effet** sur eux : le « increased Spell Damage » du joueur, son
crit, ses charges, ses conversions, ses attack/cast speed, ses flasks.

Comptent uniquement :
- les modificateurs libellés **« Minion(s) »** (arbre, jewels, gear) ;
- les **auras / buffs qui affectent les alliés** (Hatred, Anger, Wrath, Pride…) ;
- les **supports liés à la gemme de summon** ;
- les **malus appliqués à l'ennemi** par le joueur (Elemental Weakness, Despair,
  exposure, Wither).

Le **niveau de gemme** est le principal scaler de vie et de dégâts de base des
minions → +gem level est disproportionnellement fort sur ces builds.

Changements 3.29 :
- **[C1]** Tous les minions hors Spectres **ne s'arrêtent plus pendant leurs
  attaques** → vrai gain de DPS, invisible dans le tooltip.
- **[C1]** Vie de plusieurs monstres réduite **en tant que Spectres**.
- **[C1]** **Minion Pact Support supprimé**, remplacé par **Communion Support**
  qui ne peut plus modifier les skills de minions.

---

## 10. Qualité et niveaux de gemmes

- Qualité max **20 %** (Gemcutter's) ; Vaal Orb sur 20/20 peut donner **niveau
  21** ou **qualité 23 %**.
- **Awakened** : niveau max 5. **Exceptional** (Empower/Enlighten/Enhance) :
  niveau max 4.
- **Nouveauté 3.29** : le +10 % de qualité du socket assorti s'ajoute pendant
  que la gemme est équipée — une 20 % devient effectivement 30 %
  **[C1 sur le principe, C2 sur le cumul exact]**.
- Aucun autre changement 3.29 identifié sur la qualité.

---

## 11. Mécaniques d'anciennes ligues, état en 3.29

| Mécanique | Apport | Statut 3.29 |
|---|---|---|
| Delve | fossiles, resonators, Aul's Uprising | inchangé |
| Betrayal | Aisling T4, Hillock qualité 30 %, veiled mods | inchangé |
| Harvest | reforge ciblés, lifeforce | **Synthesise supprimé** |
| Essences | mod garanti déterministe | inchangé |
| Fossiles | — | **Fractured Fossil modifié** |
| Beasts | imprints, split | **modifié** (Talismans reworkés) |
| Heist | uniques exclusifs, gemmes alt-quality | inchangé |
| Expedition | logbooks, currency exotique | inchangé |
| Sanctum | relics, uniques denses | inchangé |
| Delirium | cluster jewels, Simulacrum | inchangé |
| Legion | — | **refondu** (Enshrouding Crystals, Vestigial Uniques) |
| Abyss | abyss jewels, Stygian Vise | **refondu** + pinnacle et Abyssal Bloodline (3.29.1) |
| Ritual | achat déterministe via Tribute | inchangé |
| Breach | breachstones, rings | **nerfé** |
| Mercenaries | — | **passé en core en 3.29** |

---

## 12. Autres changements 3.29 notables

- Axe majeur du patch : **casters self-cast** (temps d'incantation, coûts de
  mana). Winter Orb, Crackling Lance et Lightning Tendrils buffés **[C2]**.
- Toutes les sources de *reduced Cost of Skills* de l'arbre converties en
  **Cost Efficiency** **[C1]**. Nouveaux clusters *Arcane Conservation* et
  *Contemplative Meditation* **[C2]**.
- Nerfs : Spell Totem, Ballista, mines, Archmage, Hierophant, Breach,
  life-stacking **[C2]**.
- Nouvelle ascendancy Scion **Luminary** (mercenaires permanents) **[C1]** ;
  **Reliquarian** refondue **[C2]**.
- Nouveau jewel **Reclaimed Malignance** : remplace des notables d'ascendancy —
  les notables d'ascendancy ne sont donc plus figés **[C2]**.

---

## À faire avant de coder des valeurs en dur

1. Récupérer les patch notes officiels 3.29.0 / 3.29.1 depuis un environnement
   sans blocage proxy — seule source faisant autorité pour les chiffres.
2. Confirmer les cibles de chaos res pour 3.29.
3. Vérifier en jeu le cumul exact du +10 % de qualité de socket.

---

## 13. Builds multi-groupes et chaînes de déclenchement

Cas mesuré : Soulwrest / Necromancer, chaîne
`Cyclone (canalisé) → Cast while Channelling → Desecrate → cadavres →
déclencheur du bâton → Phantasmes → projectiles physiques`,
plus Stone Golem, Carrion Golem, Animate Guardian et l'aura Pride.

### Ce que PoB modélise correctement

Chargé tel quel, le moteur reconnaît **7 groupes de liens** et résout la
chaîne sans aide :

| Groupe | Emplacement | Source | Compétence active |
|---|---|---|---|
| 2 | Body Armour | gemme | Cyclone **et Desecrate** (la chaîne CWC est résolue) |
| 3 | Helmet | gemme | Summon Stone Golem `[minion]` |
| 4 | Gloves | gemme | Summon Carrion Golem `[minion]` |
| 5 | Boots | gemme | Animate Guardian `[minion]` |
| 6 | — | gemme | Pride |
| 7 | Weapon 1 | **ITEM** | Triggered Summon Phantasm `[minion]` |

Le moteur n'est donc pas le facteur limitant : il sait faire.

### Ce que l'outil ne sait pas exprimer

En sérialisant les supports de minion dans un groupe séparé du groupe créé
par l'objet, PoB résout ce groupe vers une compétence parasite
(`Signal Prey`, octroyée par le support Predator) au lieu de simplement
soutenir les phantasmes. Le build calculé n'est donc pas celui joué.

Conséquences, toutes non résolues à ce jour :

1. **Pas de moyen de désigner la compétence d'un objet comme compétence
   principale.** `optimize` part toujours d'une gemme nommée.
2. **Pas de moyen de rattacher des supports au groupe d'un objet.** Il
   faudrait socketer les gemmes dans l'objet, pas créer un groupe voisin.
3. **Un seul groupe optimisé.** Les golems, l'Animate Guardian, les auras et
   la chaîne de déclenchement ne sont jamais proposés ni ajustés.
4. **Les règles de scaling des minions ne sont pas appliquées** : l'outil
   peut proposer des supports qui n'affectent pas les minions (§9).

### Ordre de grandeur observé

Sur ce montage, sans arbre alloué, sans jewels et sans équipement orienté
minion : **1969 de FullDPS** et **896 d'EHP**. Un build de fin de partie se
compte en millions de DPS et en centaines de milliers d'EHP.

L'écart ne vient pas du moteur mais de tout ce que l'outil ne pose pas
encore : points d'arbre en nombre suffisant et clusters éloignés, ascendancy
complète, jewels, niveaux de gemme, et couches défensives (armure massive,
Determination, résistances maximales, Mind over Matter).

**Conclusion : la voie viable est de partir d'un build importé** plutôt que
de reconstruire un build depuis une gemme nommée. L'import préserve la
structure réelle — objets, groupes, chaînes de déclenchement — et l'outil
n'a plus qu'à proposer des améliorations mesurées par-dessus.

---

## 14. Cas d'étude : pourquoi juger un support sur son texte est faux

Build réel mesuré (Soulwrest / Necromancer, niveau 67, 90 passifs).

### Le piège

Le groupe de liens des phantasmes contient **Increased Critical Damage**. Sur
un build de minions, ce support paraît gâché : les minions critent rarement
sans investissement dédié, et un optimiseur qui raisonne sur le texte des
gemmes le remplacerait par du dégât de minion supplémentaire.

Ce serait une erreur. Le casque du build est **Ancient Skull** :

> Minions have **50% increased Critical Strike Chance per Maximum Power
> Charge you have**

Avec trois charges de pouvoir, les minions gagnent +150 % de chance de
critique. Le support est donc un choix délibéré et correct.

**Règle à retenir :** la valeur d'un support dépend des objets équipés, pas
de son libellé. Seule la mesure par le moteur tranche — c'est la raison
d'être de l'approche retenue dans tout ce projet.

### Deuxième piège : attribuer un effet à la mauvaise source

Le joueur attribuait son gros pool d'ES à une mastery « les increases
d'armure s'appliquent à l'ES ». Vérification faite, cette mastery ne touche
que la **vitesse de recharge**, à 20 % de la valeur.

La véritable source est le keystone **Divine Shield** :

> Cannot Recover Energy Shield to above **Armour**
> 3% of Physical Damage prevented from Hits Recently is Regenerated as
> Energy Shield per second

L'ES récupérable est plafonné par l'armure : monter l'armure lève le
plafond. L'effet perçu est le bon, la source ne l'était pas. S'y ajoutent
**Zealot's Oath** (la régénération de vie va sur l'ES) et trois pièces en
`increased Armour and Energy Shield`, qui montent les deux ensemble.

### Mesure obtenue

Reconstruction avec quatre pièces d'équipement réelles, sans l'arbre exact
ni les bijoux : **5 352 de FullDPS**, **3 549 d'EHP**, 1 389 d'ES,
1 864 d'armure, et une **mana non réservée négative** (-113) faute d'avoir
reproduit l'efficacité de réservation de l'arbre.

Ce dernier point illustre la contrainte de réservation : le build tourne
à la limite, et toute aura supplémentaire exigera d'abord de l'efficacité
de réservation, pas de la mana brute.

### Ce que l'outil doit en tirer

1. Ne jamais écarter un support sans l'avoir mesuré **dans le build complet**,
   objets compris.
2. Les synergies objet → support → minion ne sont lisibles que par le moteur.
3. Un build importé est une meilleure base qu'un build reconstruit : la
   reconstruction perd l'arbre, les bijoux et les réglages de configuration.
