import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../pob/bridge.js';

const CACHE_DIR = path.join(PROJECT_ROOT, '.cache', 'ninja');
/** poe.ninja met ses réponses en cache ~5 min ; on respecte cet ordre de grandeur. */
const CACHE_TTL_MS = 10 * 60 * 1000;

const BASE = 'https://poe.ninja/api/data';
const USER_AGENT = 'poe-build-architect/0.1 (personal build tool)';

/**
 * Ligue par défaut.
 *
 * poe.ninja indexe par nom de ligue exact. Le nom de la ligue de défi 3.29
 * doit correspondre à celui utilisé par GGG, sans quoi l'API renvoie des
 * données vides plutôt qu'une erreur — d'où la vérification explicite dans
 * `fetchOverview`.
 */
export const DEFAULT_LEAGUE = process.env.PBA_LEAGUE ?? 'Curse of the Allflame';

export interface NinjaLine {
  name: string;
  /** Valeur en chaos. */
  chaosValue: number;
  /** Valeur en divine, quand poe.ninja la fournit. */
  divineValue?: number;
  /** Nombre d'annonces ayant servi au calcul : sous ~10, le prix est peu fiable. */
  listingCount?: number;
  variant?: string;
  links?: number;
  baseType?: string;
}

/** Types d'objets exposés par l'endpoint itemoverview. */
export type ItemOverviewType =
  | 'UniqueWeapon'
  | 'UniqueArmour'
  | 'UniqueAccessory'
  | 'UniqueFlask'
  | 'UniqueJewel'
  | 'SkillGem'
  | 'DivinationCard'
  | 'Fragment';

async function cachedFetch(url: string, cacheKey: string): Promise<any> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${cacheKey}.json`);

  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < CACHE_TTL_MS) {
    return JSON.parse(readFileSync(file, 'utf8'));
  }

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    // Un cache périmé vaut mieux que rien quand poe.ninja est indisponible.
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
    throw new Error(`poe.ninja a répondu ${res.status} pour ${url}`);
  }
  const body = await res.json();
  writeFileSync(file, JSON.stringify(body), 'utf8');
  return body;
}

export interface OverviewResult {
  lines: NinjaLine[];
  league: string;
  /** Vrai quand la ligue demandée ne renvoie aucune donnée. */
  empty: boolean;
}

/**
 * Récupère un tableau de prix.
 *
 * Les deux seuls endpoints publiquement documentés de poe.ninja sont
 * `itemoverview` et `currencyoverview` : tout le reste (builds, profils) est
 * interne et non supporté pour un usage tiers.
 */
export async function fetchOverview(
  type: ItemOverviewType,
  league: string = DEFAULT_LEAGUE,
): Promise<OverviewResult> {
  const url = `${BASE}/itemoverview?league=${encodeURIComponent(league)}&type=${type}`;
  const body = await cachedFetch(url, `item-${type}-${league}`.replace(/[^a-z0-9-]/gi, '_'));
  const lines: NinjaLine[] = (body?.lines ?? []).map((l: any) => ({
    name: l.name,
    chaosValue: l.chaosValue ?? 0,
    divineValue: l.divineValue,
    listingCount: l.listingCount,
    variant: l.variant,
    links: l.links,
    baseType: l.baseType,
  }));
  return { lines, league, empty: lines.length === 0 };
}

/** Taux de change chaos → divine, nécessaire pour afficher des prix lisibles. */
export async function fetchDivinePrice(league: string = DEFAULT_LEAGUE): Promise<number | null> {
  const url = `${BASE}/currencyoverview?league=${encodeURIComponent(league)}&type=Currency`;
  const body = await cachedFetch(url, `currency-${league}`.replace(/[^a-z0-9-]/gi, '_'));
  const divine = (body?.lines ?? []).find((l: any) => l.currencyTypeName === 'Divine Orb');
  return divine?.chaosEquivalent ?? null;
}

/** Index de prix d'uniques, tous types confondus. */
export class PriceIndex {
  private byName = new Map<string, NinjaLine>();

  constructor(
    lines: NinjaLine[],
    public readonly divineChaos: number | null,
    public readonly league: string,
  ) {
    for (const line of lines) {
      // Un même unique existe en plusieurs variantes et nombres de liens :
      // on retient la moins chère, qui correspond à l'entrée de gamme.
      const key = line.name.toLowerCase();
      const existing = this.byName.get(key);
      if (!existing || line.chaosValue < existing.chaosValue) {
        this.byName.set(key, line);
      }
    }
  }

  get(name: string): NinjaLine | undefined {
    return this.byName.get(name.trim().toLowerCase());
  }

  get size(): number {
    return this.byName.size;
  }

  /** Formate un prix en chaos ou en divine selon son ordre de grandeur. */
  format(name: string): string | null {
    const line = this.get(name);
    if (!line) return null;
    if (this.divineChaos && line.chaosValue >= this.divineChaos) {
      return `${(line.chaosValue / this.divineChaos).toFixed(1)} div`;
    }
    return `${Math.round(line.chaosValue)} c`;
  }
}

/** Construit un index de prix pour les uniques d'équipement. */
export async function loadPriceIndex(league: string = DEFAULT_LEAGUE): Promise<PriceIndex> {
  const types: ItemOverviewType[] = [
    'UniqueWeapon',
    'UniqueArmour',
    'UniqueAccessory',
    'UniqueFlask',
    'UniqueJewel',
  ];
  const results = await Promise.all(types.map((t) => fetchOverview(t, league).catch(() => null)));
  const lines = results.flatMap((r) => r?.lines ?? []);
  const divine = await fetchDivinePrice(league).catch(() => null);
  return new PriceIndex(lines, divine, league);
}
