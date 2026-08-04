import type { PobEngine } from '../pob/bridge.js';
import { toPobXml } from '../pob/buildXml.js';
import type { GemIndex } from '../data/gems.js';
import type { BuildDraft, GemInfo, GemSocket, SupportEvaluation } from './types.js';
import type { Goal } from './scoring-types.js';
import { score } from './goals.js';
import { orderByPrior } from '../corpus/priors.js';

export interface OptimizeOptions {
  /** Nombre de liens du groupe (6 = gemme principale + 5 supports). */
  links: number;
  gemLevel: number;
  gemQuality: number;
  /** Nombre de candidats reconsidérés à chaque tour après le premier. */
  beamWidth: number;
  /**
   * Fréquences observées dans le corpus, pour ce type de compétence.
   *
   * Sert uniquement à ordonner les candidats : rien n'est écarté sur cette
   * base. Un corpus trop petit ne doit pas devenir un plafond de verre.
   */
  priorOrder?: Array<{ name: string; count: number }>;
  /**
   * Plafond de candidats testés à la première passe.
   *
   * C'est ce qui donne sa valeur à l'ordre issu du corpus : sans plafond,
   * on teste tout et l'ordre ne change que la progression affichée.
   */
  maxCandidates?: number;
  onProgress?: (done: number, total: number, label: string) => void;
}

export const DEFAULT_OPTIONS: OptimizeOptions = {
  links: 6,
  gemLevel: 20,
  gemQuality: 20,
  beamWidth: 25,
};

function toSocket(gem: GemInfo, level: number, quality: number): GemSocket {
  return {
    name: gem.name,
    level: Math.min(level, gem.naturalMaxLevel ?? level),
    quality,
    skillId: gem.grantedEffectId,
    gemId: gem.gemId,
    variantId: gem.variantId,
  };
}

export interface OptimizeResult {
  chosen: SupportEvaluation[];
  /** Supports évalués mais non retenus, classés par gain décroissant. */
  runnerUps: SupportEvaluation[];
  baselineScore: number;
  baselineStats: Record<string, number | boolean>;
  finalStats: Record<string, number | boolean>;
  evaluations: number;
}

/**
 * Choisit les meilleures gemmes de support pour une compétence donnée.
 *
 * Méthode : sélection gloutonne guidée par le moteur PoB. À chaque tour on
 * ajoute réellement le support candidat au build, on demande à PoB de
 * recalculer, et on garde celui qui améliore le plus le score.
 *
 * On ne devine rien à partir du texte des gemmes : les interactions
 * (« plus de dégâts si… », conversions, malus de coût) sont prises en compte
 * parce que c'est le moteur du jeu qui tranche.
 */
export async function optimizeSupports(
  engine: PobEngine,
  gemIndex: GemIndex,
  baseDraft: BuildDraft,
  mainGem: GemInfo,
  goal: Goal,
  options: Partial<OptimizeOptions> = {},
): Promise<OptimizeResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const slots = Math.max(0, opts.links - 1);

  const evaluate = async (supports: GemInfo[]) => {
    const draft: BuildDraft = {
      ...baseDraft,
      groups: [
        {
          slot: baseDraft.groups[0]?.slot ?? 'Body Armour',
          main: toSocket(mainGem, opts.gemLevel, opts.gemQuality),
          supports: supports.map((s) => toSocket(s, opts.gemLevel, opts.gemQuality)),
        },
      ],
      mainGroupIndex: 0,
    };
    const { stats } = await engine.evaluate(toPobXml(draft));
    return stats;
  };

  let evaluations = 0;

  const baselineStats = await evaluate([]);
  evaluations++;
  const baselineScore = score(baselineStats, goal);

  let candidates = gemIndex.compatibleSupports(mainGem);
  if (opts.priorOrder) {
    candidates = orderByPrior(candidates, (g) => g.name, opts.priorOrder);
  }
  if (opts.maxCandidates && opts.maxCandidates < candidates.length) {
    candidates = candidates.slice(0, opts.maxCandidates);
  }
  const chosen: GemInfo[] = [];
  const chosenEvals: SupportEvaluation[] = [];
  let currentScore = baselineScore;
  let currentStats = baselineStats;
  let lastRanking: SupportEvaluation[] = [];

  for (let round = 0; round < slots; round++) {
    // Au premier tour on balaie tous les supports compatibles ; ensuite on
    // ne reteste que les meilleurs, car un support faible seul le reste
    // presque toujours en combinaison.
    const pool =
      round === 0
        ? candidates
        : lastRanking
            .slice(0, opts.beamWidth)
            .map((e) => e.gem)
            .filter((g) => !chosen.some((c) => c.gemId === g.gemId));

    const ranking: SupportEvaluation[] = [];
    let done = 0;

    for (const candidate of pool) {
      if (chosen.some((c) => c.gemId === candidate.gemId)) continue;

      const stats = await evaluate([...chosen, candidate]);
      evaluations++;
      const s = score(stats, goal);

      ranking.push({
        gem: candidate,
        score: s,
        delta: s - currentScore,
        deltaPercent: currentScore > 0 ? ((s - currentScore) / currentScore) * 100 : 0,
        stats,
      });

      done++;
      opts.onProgress?.(done, pool.length, `lien ${round + 2}/${opts.links}`);
    }

    ranking.sort((a, b) => b.score - a.score);
    lastRanking = ranking;

    const best = ranking[0];
    // Un support qui n'apporte rien (incompatible, ou pénalisant pour
    // l'objectif visé) ne doit pas occuper un lien.
    if (!best || best.delta <= 0) break;

    chosen.push(best.gem);
    chosenEvals.push(best);
    currentScore = best.score;
    currentStats = best.stats;
  }

  const runnerUps = lastRanking
    .filter((e) => !chosen.some((c) => c.gemId === e.gem.gemId))
    .slice(0, 10);

  return {
    chosen: chosenEvals,
    runnerUps,
    baselineScore,
    baselineStats,
    finalStats: currentStats,
    evaluations,
  };
}
