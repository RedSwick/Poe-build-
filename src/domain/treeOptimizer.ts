import type {
  PobEngine,
  TreeNodeInfo,
  TreeAllocResult,
  MasterySelection,
} from '../pob/bridge.js';
import type { Goal } from './scoring-types.js';
import { score } from './goals.js';
import { orderByRelevance, type RelevanceProfile } from './relevance.js';

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
  /** Inclure les masteries parmi les candidats. */
  includeMasteries: boolean;
  /**
   * Profil de pertinence déduit de la compétence principale.
   *
   * Sert uniquement à ordonner : sur un budget d'évaluations limité, tester
   * d'abord les nœuds plausibles change ce que l'optimiseur a le temps de
   * trouver. Rien n'est écarté sur cette base.
   */
  profile?: RelevanceProfile;
  onProgress?: (done: number, total: number, label: string) => void;
}

export const DEFAULT_TREE_OPTIONS: TreeOptimizeOptions = {
  budget: 111,
  ascBudget: 8,
  maxDist: 12,
  batch: 3,
  beam: 40,
  minGainPercent: 0.5,
  includeMasteries: true,
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
  /** Effet retenu lorsque le nœud est une mastery. */
  masteryEffect?: { id: number; stats: string[] };
}

/**
 * Candidat unifié : notable, keystone, ou couple (mastery, effet).
 *
 * Une mastery n'a de valeur que par l'effet choisi : chaque effet est donc
 * un candidat distinct, mis en concurrence avec les notables classiques.
 */
interface Candidate {
  node: TreeNodeInfo;
  mastery?: { nodeId: number; effect: { id: number; stats: string[] } };
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
  masterySelections: MasterySelection[];
  evaluations: number;
}

/**
 * Choisit les notables et mots-clés de l'arbre de passifs.
 *
 * Comme pour les gemmes, chaque candidat est réellement alloué et mesuré par
 * le moteur PoB — y compris le coût en points du chemin, que PoB calcule
 * lui-même.
 *
 * Le balayage passe par `calc_batch`, qui s'appuie sur le calculateur
 * incrémental de PoB : une passe de base par lot, puis un simple recalcul par
 * candidat. Le tri obtenu sert à classer, pas à conclure — le nœud retenu est
 * ensuite réellement alloué, ce qui laisse derrière lui un arbre exploitable.
 * L'algorithme alloue plusieurs nœuds par passe plutôt que de tout réévaluer
 * après chaque point dépensé.
 */
export async function optimizeTree(
  engine: PobEngine,
  baseXml: string,
  goal: Goal,
  options: Partial<TreeOptimizeOptions> = {},
): Promise<TreeOptimizeResult> {
  const opts = { ...DEFAULT_TREE_OPTIONS, ...options };

  const discovered = await engine.treeCandidates(baseXml);
  let evaluations = 0;

  // Notables et keystones d'un côté, chaque effet de mastery de l'autre :
  // tous mis en concurrence sur le même critère de gain par point.
  const candidates: Candidate[] = [
    ...discovered.candidates.map((node) => ({ node })),
    ...(opts.includeMasteries
      ? discovered.masteries.flatMap((m) =>
          m.effects.map((effect) => ({
            node: {
              id: m.id,
              name: m.name,
              type: 'Mastery' as const,
              pathDist: m.pathDist,
              alloc: m.alloc,
              stats: effect.stats,
            },
            mastery: { nodeId: m.id, effect },
          })),
        )
      : []),
  ];

  const baseline = await engine.treeAlloc(baseXml, []);
  evaluations++;
  const baselineStats = baseline.stats;
  let currentScore = score(baselineStats, goal);
  let current: TreeAllocResult = baseline;

  const chosen: ChosenNode[] = [];
  const chosenIds: number[] = [];
  const chosenMasteries: MasterySelection[] = [];
  const rejected = new Set<string>();

  const keyOf = (c: Candidate) =>
    c.mastery ? `m${c.mastery.nodeId}:${c.mastery.effect.id}` : `n${c.node.id}`;

  let lastRanking: Candidate[] = [];
  let firstPass = true;

  const allocWith = (c: Candidate) =>
    engine.treeAlloc(
      baseXml,
      c.mastery ? chosenIds : [...chosenIds, c.node.id],
      c.mastery
        ? [...chosenMasteries, [c.mastery.nodeId, c.mastery.effect.id] as MasterySelection]
        : chosenMasteries,
    );

  /**
   * XML de l'arbre courant, servant de base au lot d'une passe.
   *
   * Indispensable : les chemins que PoB pré-calcule le sont pour un arbre
   * donné. Mesurer tous les candidats contre le XML de départ ferait payer à
   * chacun un chemin qui a pu raccourcir depuis — un notable voisin d'un
   * nœud fraîchement pris devient bien moins cher.
   */
  const specXml = () => {
    const effects = chosenMasteries.map(([n, e]) => `{${n},${e}}`).join(',');
    const withNodes = baseXml.replace(
      /nodes="[^"]*"/,
      `nodes="${current.allocated.join(',')}"`,
    );
    // Un XML importé depuis PoB peut ne pas porter l'attribut du tout : sans
    // ce repli, les masteries déjà retenues disparaîtraient du lot.
    return /masteryEffects="/.test(withNodes)
      ? withNodes.replace(/masteryEffects="[^"]*"/, `masteryEffects="${effects}"`)
      : withNodes.replace(/<Spec /, `<Spec masteryEffects="${effects}" `);
  };

  /**
   * Balaie un lot de candidats via le calculateur incrémental.
   *
   * C'est la passe de tri : elle sert à classer, pas à décider. Le candidat
   * retenu est ensuite réellement alloué par `allocWith`, qui reconstruit le
   * build — les deux voies donnent les mêmes chiffres, mais seule la seconde
   * laisse un arbre exploitable derrière elle.
   */
  const scanBatch = async (pool: Candidate[]) => {
    const xml = specXml();
    // Une mastery ne compte que par l'effet retenu, mais son nœud doit être
    // alloué comme n'importe quel autre pour que l'effet s'applique.
    const candidates = pool.map((c) => ({
      addNodes: [c.mastery ? c.mastery.nodeId : c.node.id],
      masteries: c.mastery
        ? ([[c.mastery.nodeId, c.mastery.effect.id]] as MasterySelection[])
        : undefined,
    }));

    const out: Array<{ cand: Candidate; stats: Record<string, number | boolean>; cost: number }> = [];
    // Un lot trop gros bloque le moteur d'un seul tenant et prive la barre de
    // progression de tout signal.
    const CHUNK = 64;
    for (let i = 0; i < candidates.length; i += CHUNK) {
      const slice = candidates.slice(i, i + CHUNK);
      const res = await engine.calcBatch(xml, slice);
      evaluations += slice.length;
      slice.forEach((_, k) => {
        const r = res.results[k];
        if (r?.stats) out.push({ cand: pool[i + k], stats: r.stats, cost: r.cost ?? 0 });
      });
      opts.onProgress?.(
        Math.min(i + CHUNK, candidates.length),
        candidates.length,
        `arbre — ${current.pointsUsed}/${opts.budget} pts`,
      );
    }
    return out;
  };

  while (current.pointsUsed < opts.budget) {
    const remaining = opts.budget - current.pointsUsed;
    const remainingAsc = opts.ascBudget - current.ascPointsUsed;

    const ordered = firstPass && opts.profile
      ? orderByRelevance(candidates.map((c) => c.node), opts.profile)
          .map((n) => candidates.find((c) => c.node === n)!)
      : (firstPass ? candidates : lastRanking);

    const pool = ordered.filter((c) => {
      if (rejected.has(keyOf(c))) return false;
      // Une mastery déjà choisie ne peut pas recevoir un second effet.
      if (c.mastery && chosenMasteries.some(([n]) => n === c.mastery!.nodeId)) return false;
      if (!c.mastery && chosenIds.includes(c.node.id)) return false;

      const dist = c.node.pathDist ?? Infinity;
      if (c.node.ascendancy) return remainingAsc > 0;
      if (firstPass && dist > opts.maxDist) return false;
      return dist <= remaining;
    });

    if (pool.length === 0) break;

    const ranking: Array<{ cand: Candidate; ratio: number; gainPercent: number; cost: number }> = [];

    // Le lot part de l'arbre courant : le coût renvoyé est donc directement
    // celui du candidat, chemin compris.
    for (const { cand, stats, cost } of await scanBatch(pool)) {
      if (cost <= 0) continue;

      const s = score(stats, goal);
      const gainPercent = currentScore > 0 ? ((s - currentScore) / currentScore) * 100 : 0;
      if (s <= currentScore || gainPercent < opts.minGainPercent) {
        // Inutile de le reproposer : un nœud sans intérêt maintenant le
        // restera, l'arbre ne fera que grandir autour.
        rejected.add(keyOf(cand));
        continue;
      }
      ranking.push({ cand, ratio: (s - currentScore) / cost, gainPercent, cost });
    }

    if (ranking.length === 0) break;
    ranking.sort((a, b) => b.ratio - a.ratio);
    lastRanking = ranking.slice(0, opts.beam).map((r) => r.cand);
    firstPass = false;

    // Plusieurs nœuds par passe : réévaluer tout le pool après chaque point
    // dépensé serait exact mais bien trop lent.
    let allocatedThisPass = 0;
    for (const best of ranking) {
      if (allocatedThisPass >= opts.batch) break;
      if (!best.cand.node.ascendancy && current.pointsUsed + best.cost > opts.budget) continue;

      const res = await allocWith(best.cand);
      evaluations++;
      const realCost = best.cand.node.ascendancy
        ? res.ascPointsUsed - current.ascPointsUsed
        : res.pointsUsed - current.pointsUsed;
      const s = score(res.stats, goal);
      const realGainPercent = currentScore > 0 ? ((s - currentScore) / currentScore) * 100 : 0;
      if (realCost <= 0 || realGainPercent < opts.minGainPercent) continue;

      if (best.cand.mastery) {
        chosenMasteries.push([best.cand.mastery.nodeId, best.cand.mastery.effect.id]);
      } else {
        chosenIds.push(best.cand.node.id);
      }
      chosen.push({
        node: best.cand.node,
        cost: realCost,
        gainPercent: realGainPercent,
        masteryEffect: best.cand.mastery?.effect,
      });
      currentScore = s;
      current = res;
      allocatedThisPass++;
    }

    if (allocatedThisPass === 0) break;

    // Les distances changent à mesure que l'arbre grandit : un nœud voisin
    // d'un point fraîchement alloué devient bien moins cher.
    const refreshed = await engine.treeCandidates(
      baseXml.replace(/nodes="[^"]*"/, `nodes="${current.allocated.join(',')}"`),
    );
    evaluations++;
    const dist = new Map<number, number | undefined>();
    for (const c of refreshed.candidates) dist.set(c.id, c.pathDist);
    for (const m of refreshed.masteries) dist.set(m.id, m.pathDist);
    for (const c of candidates) {
      if (dist.has(c.node.id)) c.node.pathDist = dist.get(c.node.id);
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
    masterySelections: chosenMasteries,
    evaluations,
  };
}
