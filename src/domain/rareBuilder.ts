import type { ItemMod, ItemBase, ModIndex } from '../data/itemMods.js';
import { MAX_PREFIXES, MAX_SUFFIXES, maxRoll, rollMax } from '../data/itemMods.js';
import type { PobStatsLike } from './scoring-types.js';
import { resistanceStatus, ELEMENTAL_RES_CAP } from './goals.js';

/** Besoin exprimé pour un objet à trouver ou à crafter. */
export interface StatNeed {
  /** Motif reconnaissant la ligne de mod recherchée. */
  pattern: RegExp;
  /** Priorité : les besoins les plus élevés sont servis en premier. */
  priority: number;
  label: string;
}

export interface RareTarget {
  slot: string;
  base: ItemBase;
  itemLevel: number;
  prefixes: ItemMod[];
  suffixes: ItemMod[];
  /** Texte de l'objet au format PoB, prêt à être équipé pour vérification. */
  raw: string;
}

/**
 * Traduit l'état d'un build en besoins d'affixes.
 *
 * Le manque de résistances passe avant tout : c'est la seule contrainte qui
 * rend un personnage injouable en endgame quels que soient ses dégâts. On
 * vise le cap **plus** un overcap, une map avec Elemental Weakness pouvant
 * retirer plusieurs dizaines de points.
 */
export function needsFromStats(stats: PobStatsLike, overcapTarget = 25): StatNeed[] {
  const res = resistanceStatus(stats);
  const target = ELEMENTAL_RES_CAP + overcapTarget;
  const needs: StatNeed[] = [];

  const add = (value: number, pattern: RegExp, label: string) => {
    if (value < ELEMENTAL_RES_CAP) {
      // Sous le cap : rien n'est plus urgent, le personnage est injouable.
      needs.push({ pattern, priority: 1000 + (ELEMENTAL_RES_CAP - value), label });
    } else if (value < target) {
      // Au cap mais sans marge : souhaitable, sans pour autant monopoliser
      // tous les affixes restants — la chaos et la vie doivent pouvoir passer.
      needs.push({ pattern, priority: 300, label });
    }
  };

  add(res.fire, /to Fire (and \w+ )?Resistance/i, 'résistance au feu');
  add(res.cold, /to Cold (and \w+ )?Resistance/i, 'résistance au froid');
  add(res.lightning, /to Lightning (and \w+ )?Resistance/i, 'résistance à la foudre');
  if (res.chaos < 0) {
    needs.push({ pattern: /to Chaos Resistance/i, priority: 500, label: 'résistance au chaos' });
  }

  // Le pool de vie vient après les résistances : une fois cappé, c'est lui
  // qui décide de la survie.
  needs.push({ pattern: /to maximum Life/i, priority: 400, label: 'vie maximum' });
  needs.push({ pattern: /to maximum Energy Shield/i, priority: 200, label: 'bouclier d\'énergie' });

  return needs.sort((a, b) => b.priority - a.priority);
}

function statMatches(mod: ItemMod, need: StatNeed): boolean {
  return mod.stats.some((s) => need.pattern.test(s));
}

/** Valeur totale apportée par un mod pour un besoin donné. */
function modValue(mod: ItemMod, need: StatNeed): number {
  return mod.stats
    .filter((s) => need.pattern.test(s))
    .reduce((sum, s) => sum + (maxRoll(s) ?? 0), 0);
}

/**
 * Construit un objet rare cible pour un emplacement.
 *
 * Ce n'est pas un simulateur de craft : on ne modélise ni les probabilités,
 * ni les currency. On décrit l'objet **à chercher sur le trade ou à viser en
 * craft**, en n'utilisant que des affixes qui peuvent réellement sortir sur
 * la base choisie, au niveau d'objet indiqué.
 */
export function buildRareTarget(
  index: ModIndex,
  slot: string,
  base: ItemBase,
  needs: StatNeed[],
  opts: { itemLevel?: number; name?: string } = {},
): RareTarget {
  const itemLevel = opts.itemLevel ?? 86;
  const pool = index.modsForBase(base, itemLevel);

  const prefixes: ItemMod[] = [];
  const suffixes: ItemMod[] = [];
  const usedGroups = new Set<string>();

  for (const need of needs) {
    const room = (t: 'Prefix' | 'Suffix') =>
      t === 'Prefix' ? prefixes.length < MAX_PREFIXES : suffixes.length < MAX_SUFFIXES;

    const candidates = pool
      .filter((m) => statMatches(m, need))
      .filter((m) => !m.group || !usedGroups.has(m.group))
      .filter((m) => room(m.type))
      // À besoin égal on prend le tier le plus haut : c'est la cible d'achat.
      .sort((a, b) => modValue(b, need) - modValue(a, need));

    const best = candidates[0];
    if (!best) continue;

    if (best.group) usedGroups.add(best.group);
    (best.type === 'Prefix' ? prefixes : suffixes).push(best);
  }

  const statLines = [...prefixes, ...suffixes].flatMap((m) => m.stats.map(rollMax));

  // Format de copier-coller du jeu, que PoB sait relire tel quel.
  const raw = [
    'Rarity: RARE',
    opts.name ?? `Cible ${slot}`,
    base.name,
    `Item Level: ${itemLevel}`,
    '--------',
    ...statLines,
  ].join('\n');

  return { slot, base, itemLevel, prefixes, suffixes, raw };
}

/** Choisit une base par défaut pour un emplacement, selon l'archétype visé. */
export function pickBase(
  index: ModIndex,
  type: string,
  prefer: 'EnergyShield' | 'Armour' | 'Evasion' | null,
  maxReqLevel = 100,
): ItemBase | undefined {
  const candidates = index
    .basesForType(type)
    .filter((b) => b.reqLevel <= maxReqLevel)
    // Les bases de haut niveau portent les meilleures valeurs de défense.
    .sort((a, b) => b.reqLevel - a.reqLevel);

  if (prefer) {
    // PoB écrit les sous-types en clair (« Energy Shield », « Armour/Evasion »)
    // et les combine par des barres obliques : une comparaison stricte
    // raterait toutes les bases hybrides.
    const wanted = prefer.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    const matching =
      candidates.find((b) => (b.subType ?? '').toLowerCase() === wanted) ??
      candidates.find((b) => (b.subType ?? '').toLowerCase().includes(wanted));
    if (matching) return matching;
  }
  return candidates[0];
}

/** Emplacement PoB → type de base correspondant. */
export const SLOT_TO_BASE_TYPE: Record<string, string> = {
  Helmet: 'Helmet',
  'Body Armour': 'Body Armour',
  Gloves: 'Gloves',
  Boots: 'Boots',
  Belt: 'Belt',
  Amulet: 'Amulet',
  'Ring 1': 'Ring',
  'Ring 2': 'Ring',
};
