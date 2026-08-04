import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { PobEngine } from '../pob/bridge.js';
import { PROJECT_ROOT } from '../pob/bridge.js';

const CACHE_FILE = path.join(PROJECT_ROOT, '.cache', 'uniques.json');

export interface UniqueItem {
  name: string;
  base: string;
  /** Texte brut de l'objet, au format copier-coller du jeu. */
  raw: string;
  variants: number;
  /** Type PoB (body, amulet, ring…). */
  type: string;
}

/**
 * Correspondance entre les types d'uniques de PoB et les emplacements
 * d'équipement d'un build.
 *
 * Les armes et anneaux occupent plusieurs emplacements : on ne teste que le
 * premier, le second se déduit.
 */
export const TYPE_TO_SLOTS: Record<string, string[]> = {
  body: ['Body Armour'],
  helmet: ['Helmet'],
  gloves: ['Gloves'],
  boots: ['Boots'],
  belt: ['Belt'],
  amulet: ['Amulet'],
  ring: ['Ring 1', 'Ring 2'],
  shield: ['Weapon 2'],
  quiver: ['Weapon 2'],
  axe: ['Weapon 1'],
  mace: ['Weapon 1'],
  sword: ['Weapon 1'],
  dagger: ['Weapon 1'],
  claw: ['Weapon 1'],
  bow: ['Weapon 1'],
  staff: ['Weapon 1'],
  wand: ['Weapon 1'],
  sceptre: ['Weapon 1'],
  flask: ['Flask 1', 'Flask 2', 'Flask 3', 'Flask 4', 'Flask 5'],
};

/** Emplacements d'équipement, hors flasks et jewels. */
export const GEAR_SLOTS = [
  'Weapon 1',
  'Weapon 2',
  'Helmet',
  'Body Armour',
  'Gloves',
  'Boots',
  'Amulet',
  'Ring 1',
  'Ring 2',
  'Belt',
] as const;

/**
 * Sélectionne la variante actuelle d'un unique.
 *
 * Beaucoup d'uniques ont été retouchés au fil des ligues : PoB conserve
 * chaque version sous forme de variantes, la dernière étant celle en jeu.
 * Sans sélection explicite, on risquerait de calculer avec une version
 * obsolète de l'objet.
 */
export function withCurrentVariant(raw: string): string {
  const count = (raw.match(/^Variant:/gm) ?? []).length;
  if (count === 0) return raw;
  if (/^Selected Variant:/m.test(raw)) return raw;

  // La ligne se place juste après la dernière déclaration de variante.
  const lines = raw.split('\n');
  let lastVariant = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('Variant:')) lastVariant = i;
  }
  lines.splice(lastVariant + 1, 0, `Selected Variant: ${count}`);
  return lines.join('\n');
}

/**
 * Nettoie le nom de base d'un unique.
 *
 * PoB préfixe la ligne de base par un marqueur de variante quand l'objet a
 * changé de base au fil des ligues (`{variant:1,2}Clutching Talisman`) : ce
 * marqueur ne doit pas apparaître dans l'interface.
 */
export function cleanBase(base: string): string {
  return base.replace(/^\{variant:[^}]*\}/, '').trim();
}

export class UniqueIndex {
  private byType = new Map<string, UniqueItem[]>();

  constructor(public readonly all: UniqueItem[]) {
    for (const u of all) {
      const list = this.byType.get(u.type) ?? [];
      list.push(u);
      this.byType.set(u.type, list);
    }
  }

  /** Uniques équipables dans un emplacement donné. */
  forSlot(slot: string): UniqueItem[] {
    const out: UniqueItem[] = [];
    for (const [type, slots] of Object.entries(TYPE_TO_SLOTS)) {
      if (slots.includes(slot)) out.push(...(this.byType.get(type) ?? []));
    }
    return out;
  }

  find(name: string): UniqueItem | undefined {
    const q = name.trim().toLowerCase();
    return this.all.find((u) => u.name.toLowerCase() === q);
  }

  search(query: string, limit = 10): UniqueItem[] {
    const q = query.trim().toLowerCase();
    return this.all.filter((u) => u.name.toLowerCase().includes(q)).slice(0, limit);
  }
}

/** Charge l'index des uniques depuis PoB, avec cache disque. */
export async function loadUniqueIndex(
  engine: PobEngine,
  opts: { refresh?: boolean } = {},
): Promise<UniqueIndex> {
  if (!opts.refresh && existsSync(CACHE_FILE)) {
    try {
      const cached = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as UniqueItem[];
      if (Array.isArray(cached) && cached.length > 0) return new UniqueIndex(cached);
    } catch {
      // Cache illisible : on régénère plutôt que d'échouer.
    }
  }

  const res = await engine.uniques();
  const all: UniqueItem[] = [];
  for (const [type, list] of Object.entries(res.uniques)) {
    for (const u of list) {
      all.push({ ...u, type, base: cleanBase(u.base), raw: withCurrentVariant(u.raw) });
    }
  }

  mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(all), 'utf8');
  return new UniqueIndex(all);
}
