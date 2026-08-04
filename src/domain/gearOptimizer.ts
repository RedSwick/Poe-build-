import type { PobEngine } from '../pob/bridge.js';
import { toPobXml } from '../pob/buildXml.js';
import type { UniqueIndex, UniqueItem } from '../data/uniques.js';
import { GEAR_SLOTS } from '../data/uniques.js';
import type { BuildDraft, ItemDraft } from './types.js';
import type { Goal } from './scoring-types.js';
import { score, resistanceStatus } from './goals.js';
import type { PriceFilter } from './budget.js';

export interface GearOptimizeOptions {
  /** Emplacements à remplir, dans l'ordre. */
  slots: readonly string[];
  /** Candidats évalués par emplacement (les uniques sont nombreux). */
  maxCandidatesPerSlot: number;
  minGainPercent: number;
  /** Filtre de budget : écarte les uniques hors du palier visé. */
  priceFilter?: PriceFilter;
  onProgress?: (done: number, total: number, label: string) => void;
}

export const DEFAULT_GEAR_OPTIONS: GearOptimizeOptions = {
  slots: GEAR_SLOTS,
  maxCandidatesPerSlot: 60,
  minGainPercent: 0.5,
};

export interface ChosenItem {
  slot: string;
  item: UniqueItem;
  gainPercent: number;
  /** Prix formaté, quand poe.ninja est joignable. */
  price?: string | null;
  /** Résistances élémentaires apportées, pour expliquer le choix. */
  resContribution: number;
}

export interface GearOptimizeResult {
  chosen: ChosenItem[];
  baselineStats: Record<string, number | boolean>;
  finalStats: Record<string, number | boolean>;
  evaluations: number;
  /** Emplacements laissés vides faute de gain. */
  emptySlots: string[];
}

/**
 * Choisit un objet unique par emplacement.
 *
 * Même principe que pour les gemmes et l'arbre : chaque candidat est
 * réellement équipé et le build recalculé par PoB. Aucune heuristique sur le
 * texte des mods — les interactions (conversions, keystones portés par un
 * unique, conditions) sont prises en compte parce que c'est le moteur du jeu
 * qui tranche.
 *
 * Limite assumée : seuls les uniques sont proposés. Un build réel s'appuie
 * surtout sur des rares aux mods choisis, que cet outil ne sait pas encore
 * générer.
 */
export async function optimizeGear(
  engine: PobEngine,
  uniques: UniqueIndex,
  baseDraft: BuildDraft,
  goal: Goal,
  options: Partial<GearOptimizeOptions> = {},
): Promise<GearOptimizeResult> {
  const opts = { ...DEFAULT_GEAR_OPTIONS, ...options };

  const equipped: ItemDraft[] = [...(baseDraft.items ?? [])];
  const evaluate = async (items: ItemDraft[]) => {
    const { stats } = await engine.evaluate(toPobXml({ ...baseDraft, items }));
    return stats;
  };

  let evaluations = 0;
  const baselineStats = await evaluate(equipped);
  evaluations++;
  let currentScore = score(baselineStats, goal);
  let currentStats = baselineStats;

  const chosen: ChosenItem[] = [];
  const emptySlots: string[] = [];

  for (const slot of opts.slots) {
    if (equipped.some((i) => i.slot === slot)) continue;

    // Le filtre de budget s'applique AVANT de tronquer la liste, sinon on
    // écarterait des uniques abordables au profit d'inabordables.
    const pool = uniques
      .forSlot(slot)
      .filter((u) => !opts.priceFilter || opts.priceFilter.affordable(u.name))
      .slice(0, opts.maxCandidatesPerSlot);
    if (pool.length === 0) {
      emptySlots.push(slot);
      continue;
    }

    let best: { item: UniqueItem; s: number; stats: Record<string, number | boolean> } | null = null;
    let done = 0;

    for (const candidate of pool) {
      const trial = [...equipped, { slot, raw: candidate.raw }];
      let stats: Record<string, number | boolean>;
      try {
        stats = await evaluate(trial);
      } catch {
        // Un unique que PoB refuse de parser ne doit pas interrompre la
        // recherche : on l'écarte et on continue.
        done++;
        continue;
      }
      evaluations++;
      done++;
      opts.onProgress?.(done, pool.length, `équipement — ${slot}`);

      const s = score(stats, goal);
      if (!best || s > best.s) best = { item: candidate, s, stats };
    }

    const gainPercent = best && currentScore > 0 ? ((best.s - currentScore) / currentScore) * 100 : 0;
    if (!best || gainPercent < opts.minGainPercent) {
      emptySlots.push(slot);
      continue;
    }

    const before = resistanceStatus(currentStats);
    const after = resistanceStatus(best.stats);
    chosen.push({
      slot,
      item: best.item,
      gainPercent,
      price: opts.priceFilter?.price(best.item.name) ?? null,
      resContribution:
        after.fire - before.fire + (after.cold - before.cold) + (after.lightning - before.lightning),
    });
    equipped.push({ slot, raw: best.item.raw });
    currentScore = best.s;
    currentStats = best.stats;
  }

  return {
    chosen,
    baselineStats,
    finalStats: currentStats,
    evaluations,
    emptySlots,
  };
}
