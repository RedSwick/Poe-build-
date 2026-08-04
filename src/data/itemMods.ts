import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { PobEngine } from '../pob/bridge.js';
import { PROJECT_ROOT } from '../pob/bridge.js';

const CACHE_FILE = path.join(PROJECT_ROOT, '.cache', 'itemmods.json');

export interface ItemMod {
  id: string;
  type: 'Prefix' | 'Suffix';
  affix: string;
  /** Lignes de statistiques, avec leur plage : « +(24-29)% to Fire Resistance ». */
  stats: string[];
  /** Niveau d'objet minimum pour que le mod puisse apparaître. */
  level: number;
  /** Deux mods du même groupe ne coexistent jamais sur un objet. */
  group?: string;
  /** Poids d'apparition par catégorie de base ; absent = ne peut pas sortir. */
  weights: Record<string, number>;
  tags: string[];
  /** Identifiants de stats de l'API trade officielle. */
  tradeHashes: number[];
}

export interface ItemBase {
  name: string;
  type: string;
  subType?: string;
  tags: string[];
  reqLevel: number;
  socketLimit?: number;
}

/** Nombre maximum d'affixes sur un objet rare. */
export const MAX_PREFIXES = 3;
export const MAX_SUFFIXES = 3;

export class ModIndex {
  constructor(
    public readonly mods: ItemMod[],
    public readonly bases: ItemBase[],
  ) {}

  /** Bases correspondant à un type d'emplacement PoB. */
  basesForType(type: string): ItemBase[] {
    return this.bases.filter((b) => b.type === type);
  }

  /**
   * Mods pouvant apparaître sur une base donnée.
   *
   * Un mod ne sort que si l'une des catégories de la base a un poids non nul
   * dans sa table de poids, et si le niveau d'objet le permet.
   */
  modsForBase(base: ItemBase, itemLevel = 86): ItemMod[] {
    return this.mods.filter(
      (m) => m.level <= itemLevel && base.tags.some((tag) => (m.weights[tag] ?? 0) > 0),
    );
  }
}

/**
 * Lit la valeur haute d'une plage de mod.
 *
 * « +(24-29)% to Fire Resistance » → 29. On vise le haut de plage pour
 * décrire une cible d'achat ou de craft : c'est ce qu'on cherche sur le
 * trade, pas une valeur moyenne.
 */
export function maxRoll(stat: string): number | null {
  const range = stat.match(/\((\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\)/);
  if (range) return Number(range[2]);
  const flat = stat.match(/([+-]?\d+(?:\.\d+)?)/);
  return flat ? Number(flat[1]) : null;
}

/** Remplace les plages d'un mod par leur valeur haute, prêt à équiper. */
export function rollMax(stat: string): string {
  return stat.replace(/\((\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\)/g, (_, __, hi) => hi);
}

export async function loadModIndex(
  engine: PobEngine,
  opts: { refresh?: boolean } = {},
): Promise<ModIndex> {
  if (!opts.refresh && existsSync(CACHE_FILE)) {
    try {
      const c = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
      if (c?.mods?.length) return new ModIndex(c.mods, c.bases);
    } catch {
      // Cache illisible : on régénère.
    }
  }
  const res = await engine.itemMods();
  mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(res), 'utf8');
  return new ModIndex(res.mods, res.bases);
}
