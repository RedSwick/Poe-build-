import type { PobEngine, TreeNodeInfo, TreeAllocResult } from '../pob/bridge.js';
import type { Goal } from './scoring-types.js';
import { score } from './goals.js';

export interface TreeOptimizeOptions {
  /** Points de passif disponibles (hors ascendance). */
  budget: number;
  /** Points d'ascendance disponibles. */
  ascBudget: number;
  /** Distance maximale d'un candidat pour être considéré à chaque passe. */
  maxDist: number;
  /** Nœuds alloués par passe de balayage. */
  batch: number;
  /** Candidats reconsidérés après la première passe complète. */
  beam: number;
  /**
   * Gain minimum, en pourcentage du score, pour qu'un nœud vaille ses points.
   *
   * Sans ce seuil, la sélection par gain/point finit par allouer des nœuds
   * quasi inutiles simplement parce qu'ils sont bon marché.
   */
  minGainPercent: number;
  onProgress?: (done: number, total: number, label: string) => void;
}

export const DEFAULT_TREE_OPTIONS: TreeOptimizeOptions = {
  budget: 111,
  ascBudget: 8,
  maxDist: 12,
  batch: 3,
  beam: 40,
  minGainPercent: 0.5,
};

/** Points de passif d'un personnage : 1 par niveau après le 1, plus les quêtes. */
export const QUEST_PASSIVE_POINTS = 22;
export function passivePointsForLevel(level: number): number {
  return Math.max(0, level - 1) + QUEST_PASSIVE_POINTS;
}

export interface ChosenNode {
  node: TreeNodeInfo;
  /** Points réellement consommés, chemin compris. */
  cost: number;
  gainPercent: number;
}

export interface TreeOptimizeResult {
  chosen: ChosenNode[];
  baselineStats: Record<string, number | boolean>;
  finalStats: Record<string, number | boolean>;
  pointsUsed: number;
  ascPointsUsed: number;
  /** Lien pathofexile.com vers l'arbre obtenu. */
  url: string;
  allocated: number[];
  evaluations: number;
}

/**
 * Choisit les notables et mots-clés de l'arbre de passifs.
 *
 * Comme pour les gemmes, chaque candidat est réellement alloué et mesuré par
 * le moteur PoB — y compris le coût en points du chemin, que PoB calcule
 * lui-même via `AllocNode`.
 *
 * Une évaluation d'arbre coûte environ dix fois une évaluation de gemme
 * (reconstruction complète des chemins). L'algorithme balaie donc les
 * candidats par passes et alloue plusieurs nœuds par passe, plutôt que de
 * tout réévaluer après chaque point dépensé.
 */
export async function optimizeTree(
  engine: PobEngine,
  baseXml: string,
  goal: Goal,
  options: Partial<TreeOptimizeOptions> = {},
): Promise<TreeOptimizeResult> {
  const opts = { ...DEFAULT_TREE_OPTIONS, ...options };

  const { candidates } = await engine.treeCandidates(baseXml);
  let evaluations = 0;

  const baseline = await engine.treeAlloc(baseXml, []);
  evaluations++;
  const baselineStats = baseline.stats;
  let currentScore = score(baselineStats, goal);
  let current: TreeAllocResult = baseline;

  const chosen: ChosenNode[] = [];
  const chosenIds: number[] = [];
  const rejected = new Set<number>();

  // Classement de la passe précédente, pour restreindre les suivantes.
  let lastRanking: Array<{ node: TreeNodeInfo; ratio: number }> = [];
  let firstPass = true;

  while (current.pointsUsed < opts.budget) {
    const remaining = opts.budget - current.pointsUsed;
    const remainingAsc = opts.ascBudget - current.ascPointsUsed;

    const pool = (
      firstPass
        ? candidates.filter((c) => (c.pathDist ?? Infinity) <= opts.maxDist)
        : lastRanking.slice(0, opts.beam).map((r) => r.node)
    ).filter((c) => {
      if (chosenIds.includes(c.id) || rejected.has(c.id)) return false;
      const dist = c.pathDist ?? Infinity;
      // Un nœud hors budget ne sert à rien : ni en points de passif, ni en
      // points d'ascendance qui ont leur propre réserve.
      if (c.ascendancy) return remainingAsc > 0;
      return dist <= remaining;
    });

    if (pool.length === 0) break;

    const ranking: Array<{ node: TreeNodeInfo; ratio: number; gain: number; cost: number; res: TreeAllocResult }> = [];
    let done = 0;

    for (const cand of pool) {
      const res = await engine.treeAlloc(baseXml, [...chosenIds, cand.id]);
      evaluations++;
      done++;
      opts.onProgress?.(done, pool.length, `arbre — ${current.pointsUsed}/${opts.budget} pts`);

      const cost = cand.ascendancy
        ? res.ascPointsUsed - current.ascPointsUsed
        : res.pointsUsed - current.pointsUsed;
      if (cost <= 0) continue;

      const s = score(res.stats, goal);
      const gain = s - currentScore;
      const gainPercent = currentScore > 0 ? (gain / currentScore) * 100 : 0;
      if (gain <= 0 || gainPercent < opts.minGainPercent) {
        // Inutile de le reproposer à chaque passe : un nœud sans intérêt
        // maintenant le restera, l'arbre ne fera que grandir autour.
        rejected.add(cand.id);
        continue;
      }
      ranking.push({ node: cand, ratio: gain / cost, gain, cost, res });
    }

    if (ranking.length === 0) break;
    ranking.sort((a, b) => b.ratio - a.ratio);
    lastRanking = ranking.map((r) => ({ node: r.node, ratio: r.ratio }));
    firstPass = false;

    // On alloue plusieurs nœuds par passe : réévaluer tout le pool après
    // chaque point dépensé serait exact mais bien trop lent.
    let allocatedThisPass = 0;
    for (const best of ranking) {
      if (allocatedThisPass >= opts.batch) break;
      if (current.pointsUsed + best.cost > opts.budget && !best.node.ascendancy) continue;

      const res = await engine.treeAlloc(baseXml, [...chosenIds, best.node.id]);
      evaluations++;
      const realCost = best.node.ascendancy
        ? res.ascPointsUsed - current.ascPointsUsed
        : res.pointsUsed - current.pointsUsed;
      const s = score(res.stats, goal);
      const realGainPercent = currentScore > 0 ? ((s - currentScore) / currentScore) * 100 : 0;
      if (realCost <= 0 || realGainPercent < opts.minGainPercent) continue;

      chosenIds.push(best.node.id);
      chosen.push({
        node: best.node,
        cost: realCost,
        gainPercent: realGainPercent,
      });
      currentScore = s;
      current = res;
      allocatedThisPass++;
    }

    if (allocatedThisPass === 0) break;

    // Les distances changent à mesure que l'arbre grandit : un notable
    // voisin d'un nœud fraîchement alloué devient bien moins cher.
    const refreshed = await engine.treeCandidates(
      baseXml.replace(/nodes="[^"]*"/, `nodes="${current.allocated.join(',')}"`),
    );
    evaluations++;
    for (const c of refreshed.candidates) {
      const known = candidates.find((k) => k.id === c.id);
      if (known) known.pathDist = c.pathDist;
    }
  }

  return {
    chosen,
    baselineStats,
    finalStats: current.stats,
    pointsUsed: current.pointsUsed,
    ascPointsUsed: current.ascPointsUsed,
    url: current.url,
    allocated: current.allocated,
    evaluations,
  };
}
