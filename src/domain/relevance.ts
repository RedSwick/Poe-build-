import type { GemInfo } from './types.js';
import type { TreeNodeInfo } from '../pob/bridge.js';

/**
 * Familles de dégâts mutuellement exclusives.
 *
 * Un nœud « increased Cold Damage » sur un build de feu ne vaut rien. Les
 * reconnaître permet de ne pas gaspiller le budget d'évaluations, sans pour
 * autant les interdire : certains builds convertissent d'un élément vers un
 * autre, et seul le moteur peut le dire.
 */
const ELEMENTS = ['fire', 'cold', 'lightning'] as const;

/** Mots-clés à chercher dans le texte d'un nœud, par tag de gemme. */
const TAG_KEYWORDS: Record<string, string[]> = {
  fire: ['fire', 'burning', 'ignite'],
  cold: ['cold', 'freeze', 'chill'],
  lightning: ['lightning', 'shock'],
  chaos: ['chaos', 'poison', 'wither'],
  physical: ['physical', 'impale', 'bleed'],
  spell: ['spell', 'cast speed'],
  attack: ['attack', 'accuracy', 'weapon'],
  melee: ['melee', 'strike'],
  projectile: ['projectile', 'pierce', 'fork', 'chain'],
  area: ['area', 'area of effect'],
  minion: ['minion', 'skeleton', 'zombie', 'golem', 'spectre'],
  duration: ['duration'],
  channelling: ['channelling', 'cast speed'],
  totem: ['totem'],
  trap: ['trap'],
  mine: ['mine'],
  curse: ['curse'],
  aura: ['aura', 'reservation'],
  bow: ['bow', 'projectile'],
  movement: ['movement speed'],
};

/** Mots-clés toujours pertinents, quel que soit l'archétype. */
const UNIVERSAL = [
  'maximum life',
  'maximum energy shield',
  'resistance',
  'armour',
  'evasion',
  'suppress',
  'block',
  'regenerate',
  'leech',
  'reservation',
  'mana',
];

/** Mots-clés de critique, pertinents seulement si le build vise le crit. */
const CRIT = ['critical strike', 'critical'];

export interface RelevanceProfile {
  /** Mots-clés recherchés dans le texte des nœuds. */
  keywords: string[];
  /** Éléments concurrents, dont la présence disqualifie presque toujours. */
  conflicting: string[];
  crit: boolean;
  minion: boolean;
}

/**
 * Déduit un profil de pertinence depuis la gemme principale.
 *
 * Les tags viennent de PoB, donc du jeu : `Volatile Dead` porte `fire`,
 * `spell` et `area`, `Flicker Strike` porte `attack`, `melee` et `strike`.
 * On n'invente aucune règle sur les compétences, on lit ce que le jeu dit.
 */
export function profileFor(
  mainGem: GemInfo,
  opts: { crit?: boolean } = {},
): RelevanceProfile {
  const tags = new Set(mainGem.tags);
  const keywords = new Set<string>(UNIVERSAL);

  for (const tag of tags) {
    for (const kw of TAG_KEYWORDS[tag] ?? []) keywords.add(kw);
  }

  // Les supports de minion portent le tag `minion` sans être des minions
  // eux-mêmes : c'est bien la compétence principale qui décide.
  const minion = tags.has('minion');
  if (minion) for (const kw of TAG_KEYWORDS.minion) keywords.add(kw);

  // Le crit est une orientation de build, pas une propriété de la gemme :
  // une même compétence se joue en crit ou non.
  const crit = opts.crit ?? false;
  if (crit) for (const kw of CRIT) keywords.add(kw);

  const own = ELEMENTS.filter((e) => tags.has(e));
  const conflicting = own.length > 0 ? ELEMENTS.filter((e) => !tags.has(e)) : [];

  return { keywords: [...keywords], conflicting, crit, minion };
}

/**
 * Note la pertinence apparente d'un nœud pour un profil.
 *
 * Cette note ne sert **qu'à ordonner** : rien n'est jamais écarté sur cette
 * base. Le gain réel reste mesuré par le moteur, qui seul connaît les
 * conversions, les interactions d'uniques et les cas particuliers.
 */
export function relevanceScore(node: TreeNodeInfo, profile: RelevanceProfile): number {
  const text = node.stats.join(' ').toLowerCase();
  if (text.length === 0) return 0;

  let s = 0;
  for (const kw of profile.keywords) {
    if (text.includes(kw)) s += 1;
  }

  // Un nœud dédié à un autre élément est presque toujours inutile. On le
  // relègue sans l'exclure : un build à conversion peut le rendre bon.
  for (const c of profile.conflicting) {
    if (text.includes(c)) s -= 2;
  }

  // Les dégâts de minion et ceux du joueur ne se mélangent pas : sur un
  // build d'invocation, un nœud de dégâts du joueur ne fait rien.
  if (profile.minion && !text.includes('minion')) {
    const playerDamage = /increased (spell|attack|projectile|area|melee|elemental) damage/.test(text);
    if (playerDamage) s -= 2;
  }

  return s;
}

/**
 * Ordonne les candidats par pertinence apparente puis par proximité.
 *
 * La proximité compte autant que la pertinence : un excellent nœud à
 * l'autre bout de l'arbre coûte les points qui auraient acheté trois bons
 * nœuds à côté. C'est ce qui évite de traverser l'arbre sans raison — le
 * coût réel reste tranché par le moteur, qui compte les points du chemin.
 */
export function orderByRelevance(
  nodes: TreeNodeInfo[],
  profile: RelevanceProfile,
): TreeNodeInfo[] {
  return [...nodes]
    .map((node) => ({
      node,
      score: relevanceScore(node, profile),
      dist: node.pathDist ?? 99,
    }))
    .sort((a, b) => b.score - a.score || a.dist - b.dist)
    .map((x) => x.node);
}
