import type { PobPool } from '../pob/pool.js';
import { toPobXml } from '../pob/buildXml.js';
import type { BuildDraft } from './types.js';
import type { Goal } from './scoring-types.js';
import { score, totalDamage, effectiveHp } from './goals.js';
import { optimizeTree, type TreeOptimizeOptions } from './treeOptimizer.js';

export interface AscendancyCandidate {
  className: string;
  classId: number;
  ascendancy: string;
  ascendClassId: number;
}

export interface AscendancyResult {
  candidate: AscendancyCandidate;
  score: number;
  dps: number;
  ehp: number;
  pointsUsed: number;
  ascPointsUsed: number;
  /** Nœuds d'ascendance retenus, qui expliquent le classement. */
  ascendancyNodes: string[];
  url: string;
  evaluations: number;
}

export interface AscendancySearchOptions {
  /** Restreindre à une classe. Sans quoi les sept classes sont essayées. */
  className?: string;
  /**
   * Budget de points d'arbre accordé à chaque candidat.
   *
   * Un budget court suffit à départager : ce qui distingue deux ascendances
   * se joue sur leurs propres nœuds et sur les premiers notables autour du
   * départ, pas sur la centième allocation.
   */
  treeBudget?: number;
  treeOptions?: Partial<TreeOptimizeOptions>;
  onProgress?: (done: number, total: number, label: string) => void;
}

/**
 * Cherche la meilleure ascendance pour une compétence et un objectif.
 *
 * Chaque ascendance est réellement jouée : on construit le personnage, on lui
 * fait choisir son arbre, et on lit le résultat. Rien ne présuppose que les
 * minions vont chez la Necromancer ou le critique chez l'Assassin — c'est
 * précisément ce qu'il faut pouvoir remettre en question, et c'est le seul
 * moyen de traiter une combinaison que personne n'a encore essayée.
 *
 * La classe compte autant que l'ascendance : le point de départ dans l'arbre
 * décide de ce qui est atteignable pour un budget donné.
 */
export async function searchAscendancy(
  pool: PobPool,
  baseDraft: BuildDraft,
  goal: Goal,
  options: AscendancySearchOptions = {},
): Promise<AscendancyResult[]> {
  const { classes } = await pool.classes();
  const wanted = options.className?.toLowerCase();

  const candidates: AscendancyCandidate[] = classes
    .filter((c) => !wanted || c.name.toLowerCase() === wanted)
    .flatMap((c) =>
      c.ascendancies.map((a) => ({
        className: c.name,
        classId: c.classId,
        ascendancy: a.name,
        ascendClassId: a.id,
      })),
    );

  const budget = options.treeBudget ?? 40;
  const results: AscendancyResult[] = [];
  let done = 0;

  // Séquentiel : `optimizeTree` sature déjà un moteur à lui seul, et chaque
  // candidat garde ainsi un moteur au cache chaud sur son propre XML.
  for (const candidate of candidates) {
    const draft: BuildDraft = {
      ...baseDraft,
      className: candidate.className,
      ascendancy: candidate.ascendancy,
      ascendClassId: candidate.ascendClassId,
    };
    const xml = toPobXml(draft);

    const tree = await optimizeTree(pool as never, xml, goal, {
      budget,
      ...options.treeOptions,
    });

    results.push({
      candidate,
      score: score(tree.finalStats, goal),
      dps: totalDamage(tree.finalStats),
      ehp: effectiveHp(tree.finalStats),
      pointsUsed: tree.pointsUsed,
      ascPointsUsed: tree.ascPointsUsed,
      ascendancyNodes: tree.chosen
        .filter((c) => c.node.ascendancy)
        .map((c) => c.node.name),
      url: tree.url,
      evaluations: tree.evaluations,
    });

    done++;
    options.onProgress?.(done, candidates.length, `${candidate.ascendancy}`);
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
