import type { ItemMod, ItemBase } from '../data/itemMods.js';
import { maxRoll } from '../data/itemMods.js';
import { DEFAULT_LEAGUE } from './ninja.js';

/**
 * Construit un lien de recherche vers le site de trade officiel.
 *
 * Point important : c'est une **URL de site**, pas un appel d'API. Elle ouvre
 * la recherche pré-remplie dans le navigateur de l'utilisateur, qui est déjà
 * authentifié. On évite donc entièrement le POESESSID, Cloudflare et les
 * limites de débit de l'API — pour le coût d'un clic.
 *
 * Les identifiants de stats viennent des `tradeHashes` de PoB, qui sont
 * exactement ceux attendus par le site.
 */
export interface TradeSearchOptions {
  league?: string;
  /** Fraction de la valeur maximale exigée comme minimum (0.8 = 80 %). */
  minRollRatio?: number;
  online?: boolean;
  /** Type de base recherché, quand on veut l'imposer. */
  baseType?: string;
}

interface StatFilter {
  id: string;
  value?: { min?: number };
  disabled?: boolean;
}

export function buildTradeSearchUrl(
  mods: ItemMod[],
  base: ItemBase | null,
  opts: TradeSearchOptions = {},
): string {
  const league = opts.league ?? DEFAULT_LEAGUE;
  const ratio = opts.minRollRatio ?? 0.7;

  const filters: StatFilter[] = [];
  for (const mod of mods) {
    // Un mod sans hash de trade n'est pas recherchable : plutôt que de
    // fabriquer un identifiant, on l'omet simplement.
    const hash = mod.tradeHashes[0];
    if (hash === undefined) continue;

    const best = mod.stats.map((s) => maxRoll(s) ?? 0).sort((a, b) => b - a)[0];
    filters.push({
      id: `explicit.stat_${hash}`,
      value: best > 0 ? { min: Math.floor(best * ratio) } : undefined,
    });
  }

  const query: Record<string, unknown> = {
    query: {
      status: { option: opts.online === false ? 'any' : 'online' },
      stats: [{ type: 'and', filters }],
      ...(base || opts.baseType
        ? { filters: { type_filters: { filters: { category: undefined } } } }
        : {}),
    },
    sort: { price: 'asc' },
  };

  // Le site attend la requête encodée en JSON dans le paramètre `q`.
  const encoded = encodeURIComponent(JSON.stringify(query));
  return `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}?q=${encoded}`;
}

/**
 * Lien de recherche pour un objet unique nommé.
 *
 * Beaucoup plus simple : le site sait chercher un unique par son nom.
 */
export function buildUniqueSearchUrl(name: string, league: string = DEFAULT_LEAGUE): string {
  const query = {
    query: {
      status: { option: 'online' },
      name,
      stats: [{ type: 'and', filters: [] }],
    },
    sort: { price: 'asc' },
  };
  return `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}?q=${encodeURIComponent(
    JSON.stringify(query),
  )}`;
}
