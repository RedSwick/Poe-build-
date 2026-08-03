import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { PobEngine } from '../pob/bridge.js';
import { PROJECT_ROOT } from '../pob/bridge.js';
import type { GemInfo } from '../domain/types.js';

const CACHE_DIR = path.join(PROJECT_ROOT, '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'gems.json');

/**
 * Index des gemmes du jeu.
 *
 * Les données proviennent du moteur PoB lui-même (`data.gems`), jamais d'un
 * scraping ni d'une copie figée : elles suivent donc la ligue supportée par
 * le fork installé dans vendor/.
 */
export class GemIndex {
  private byLowerName = new Map<string, GemInfo>();

  constructor(public readonly all: GemInfo[]) {
    for (const gem of all) {
      this.byLowerName.set(gem.name.toLowerCase(), gem);
      if (gem.baseTypeName) {
        this.byLowerName.set(gem.baseTypeName.toLowerCase(), gem);
      }
    }
  }

  /** Gemmes actives (non-support). */
  get actives(): GemInfo[] {
    return this.all.filter((g) => !g.support);
  }

  /** Gemmes de support. */
  get supports(): GemInfo[] {
    return this.all.filter((g) => g.support);
  }

  find(name: string): GemInfo | undefined {
    return this.byLowerName.get(name.trim().toLowerCase());
  }

  /**
   * Recherche tolérante, pour que l'utilisateur puisse taper « winter orb »
   * ou « winterorb » sans connaître le nom exact.
   */
  search(query: string, limit = 8): GemInfo[] {
    const q = query.trim().toLowerCase().replace(/\s+/g, '');
    if (!q) return [];
    const scored: Array<{ gem: GemInfo; rank: number }> = [];
    for (const gem of this.all) {
      const name = gem.name.toLowerCase().replace(/\s+/g, '');
      if (name === q) scored.push({ gem, rank: 0 });
      else if (name.startsWith(q)) scored.push({ gem, rank: 1 });
      else if (name.includes(q)) scored.push({ gem, rank: 2 });
    }
    scored.sort((a, b) => a.rank - b.rank || a.gem.name.localeCompare(b.gem.name));
    return scored.slice(0, limit).map((s) => s.gem);
  }

  /**
   * Supports potentiellement compatibles avec une gemme active.
   *
   * On croise les types de compétence supportés par le support avec ceux de
   * la compétence active. C'est un présélecteur : le gain réel est ensuite
   * mesuré par le moteur, seul juge de la compatibilité effective.
   */
  compatibleSupports(active: GemInfo): GemInfo[] {
    const activeTypes = new Set(active.skillTypes);
    if (activeTypes.size === 0) return this.supports;

    return this.supports.filter((s) => {
      if (s.supportSkillTypes.length === 0) return true;
      return s.supportSkillTypes.some((t) => activeTypes.has(t));
    });
  }
}

/** Charge l'index des gemmes, en le mettant en cache sur disque. */
export async function loadGemIndex(
  engine: PobEngine,
  opts: { refresh?: boolean } = {},
): Promise<GemIndex> {
  if (!opts.refresh && existsSync(CACHE_FILE)) {
    try {
      const cached = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as GemInfo[];
      if (Array.isArray(cached) && cached.length > 0) return new GemIndex(cached);
    } catch {
      // Cache illisible : on le régénère plutôt que d'échouer.
    }
  }

  const { gems } = await engine.gems<GemInfo>();

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(gems), 'utf8');
  return new GemIndex(gems);
}
