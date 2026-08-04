import type { PriceIndex } from '../trade/ninja.js';

/**
 * Paliers de budget.
 *
 * Les plafonds sont exprimés en divine et convertis en chaos au taux du
 * moment : un seuil fixé en chaos deviendrait faux au fil de la ligue, le
 * taux chaos/divine bougeant en permanence.
 */
export type BudgetTier = 'leagueStart' | 'comfortable' | 'optimised' | 'mirror';

export const BUDGET_TIERS: Record<BudgetTier, { maxDivine: number | null }> = {
  // Début de ligue : ce qu'on ramasse ou s'achète pour quelques chaos.
  leagueStart: { maxDivine: 0.15 },
  // Confortable : un unique structurant est accessible.
  comfortable: { maxDivine: 3 },
  // Optimisé : les gros uniques, hors items de chasse.
  optimised: { maxDivine: 40 },
  // Mirror tier : aucune limite.
  mirror: { maxDivine: null },
};

export interface PriceFilter {
  /** Vrai si l'objet tient dans le budget. */
  affordable(name: string): boolean;
  /** Prix formaté, ou null si inconnu. */
  price(name: string): string | null;
  /** Vrai quand aucune donnée de prix n'est disponible. */
  readonly unavailable: boolean;
  readonly tier: BudgetTier;
}

/**
 * Construit un filtre de prix pour un palier donné.
 *
 * Quand les prix ne sont pas disponibles (poe.ninja injoignable, ligue sans
 * données), le filtre laisse tout passer plutôt que de tout rejeter : mieux
 * vaut une recommandation sans budget qu'aucune recommandation. L'appelant
 * est informé via `unavailable` et doit le dire à l'utilisateur.
 */
export function createPriceFilter(
  tier: BudgetTier,
  prices: PriceIndex | null,
): PriceFilter {
  const maxDivine = BUDGET_TIERS[tier].maxDivine;
  const unavailable = prices === null || prices.size === 0;

  const maxChaos =
    maxDivine === null || !prices || !prices.divineChaos
      ? null
      : maxDivine * prices.divineChaos;

  return {
    unavailable,
    tier,
    affordable(name: string): boolean {
      if (unavailable || maxChaos === null) return true;
      const line = prices!.get(name);
      // Un unique absent de poe.ninja est soit très rare, soit jamais vendu.
      // On l'écarte des petits budgets, où il serait de toute façon hors
      // de portée, et on le laisse passer au-delà.
      if (!line) return tier === 'mirror' || tier === 'optimised';
      return line.chaosValue <= maxChaos;
    },
    price(name: string): string | null {
      return prices?.format(name) ?? null;
    },
  };
}
