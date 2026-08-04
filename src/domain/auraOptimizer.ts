import type { PobEngine } from '../pob/bridge.js';
import { toPobXml } from '../pob/buildXml.js';
import type { GemIndex } from '../data/gems.js';
import type { BuildDraft, GemInfo, SkillGroup } from './types.js';
import type { Goal } from './scoring-types.js';
import { score } from './goals.js';

/**
 * Emplacements où loger les auras.
 *
 * Les auras vivent dans leurs propres groupes de liens, distincts de la
 * compétence principale : ce ne sont pas des supports.
 */
export const AURA_SLOTS = ['Helmet', 'Gloves', 'Boots', 'Weapon 2'] as const;

export interface AuraOptimizeOptions {
  /** Nombre maximum d'auras retenues. */
  maxAuras: number;
  /**
   * Mana non réservée minimale à conserver, en pourcentage du total.
   *
   * Une aura de trop rend le personnage incapable de lancer sa compétence :
   * la réservation est une contrainte dure, pas un compromis.
   */
  minUnreservedManaPercent: number;
  gemLevel: number;
  gemQuality: number;
  onProgress?: (done: number, total: number, label: string) => void;
}

export const DEFAULT_AURA_OPTIONS: AuraOptimizeOptions = {
  maxAuras: 4,
  minUnreservedManaPercent: 8,
  gemLevel: 20,
  gemQuality: 20,
};

export interface ChosenAura {
  gem: GemInfo;
  gainPercent: number;
  /** Mana non réservée restante après cette aura. */
  manaLeft: number;
}

export interface AuraOptimizeResult {
  chosen: ChosenAura[];
  baselineStats: Record<string, number | boolean>;
  finalStats: Record<string, number | boolean>;
  evaluations: number;
  /** Auras écartées faute de mana, malgré un gain positif. */
  rejectedForReservation: string[];
}

/**
 * Sélectionne les auras et hérauts à faire tourner.
 *
 * C'est le levier défensif le plus puissant du jeu : Determination, Grace et
 * Discipline transforment les défenses d'un build bien plus qu'un notable.
 * Comme partout ailleurs, chaque candidate est réellement équipée et le build
 * recalculé — y compris sa réservation de mana, que PoB modélise.
 */
export async function optimizeAuras(
  engine: PobEngine,
  gemIndex: GemIndex,
  baseDraft: BuildDraft,
  goal: Goal,
  options: Partial<AuraOptimizeOptions> = {},
): Promise<AuraOptimizeResult> {
  const opts = { ...DEFAULT_AURA_OPTIONS, ...options };

  // Le tag « aura » est aussi porté par des compétences qui n'en sont pas
  // (mines à aura, compétences Vaal) : on les écarte, sinon l'optimiseur
  // gaspille des évaluations sur des candidates absurdes.
  const excluded = ['mine', 'trap', 'vaal', 'attack', 'curse'];
  const candidates = gemIndex.actives.filter(
    (g) =>
      (g.tags.includes('aura') || g.tags.includes('herald')) &&
      g.tags.includes('grants_active_skill') &&
      !excluded.some((x) => g.tags.includes(x)),
  );

  const groupsWith = (auras: GemInfo[]): SkillGroup[] => [
    ...baseDraft.groups,
    ...auras.map((a, i) => ({
      slot: AURA_SLOTS[i % AURA_SLOTS.length],
      main: {
        name: a.name,
        level: Math.min(opts.gemLevel, a.naturalMaxLevel ?? opts.gemLevel),
        quality: opts.gemQuality,
        skillId: a.grantedEffectId,
        gemId: a.gemId,
      },
      supports: [],
    })),
  ];

  const evaluate = async (auras: GemInfo[]) => {
    const { stats } = await engine.evaluate(
      toPobXml({ ...baseDraft, groups: groupsWith(auras), mainGroupIndex: 0 }),
    );
    return stats;
  };

  const num = (s: Record<string, number | boolean>, k: string) =>
    typeof s[k] === 'number' ? (s[k] as number) : 0;

  let evaluations = 0;
  const baselineStats = await evaluate([]);
  evaluations++;
  let currentScore = score(baselineStats, goal);
  let currentStats = baselineStats;

  const chosen: ChosenAura[] = [];
  const chosenGems: GemInfo[] = [];
  const rejectedForReservation: string[] = [];

  for (let round = 0; round < opts.maxAuras; round++) {
    let best: { gem: GemInfo; s: number; stats: Record<string, number | boolean> } | null = null;
    let done = 0;

    for (const cand of candidates) {
      if (chosenGems.some((g) => g.gemId === cand.gemId)) continue;

      const stats = await evaluate([...chosenGems, cand]);
      evaluations++;
      done++;
      opts.onProgress?.(done, candidates.length, `auras ${round + 1}/${opts.maxAuras}`);

      const mana = num(stats, 'Mana');
      const unreserved = num(stats, 'ManaUnreserved');
      // Une aura qui assèche la mana rend la compétence principale
      // inutilisable, quel que soit son apport défensif.
      if (mana > 0 && (unreserved / mana) * 100 < opts.minUnreservedManaPercent) {
        if (!rejectedForReservation.includes(cand.name)) rejectedForReservation.push(cand.name);
        continue;
      }

      const s = score(stats, goal);
      if (!best || s > best.s) best = { gem: cand, s, stats };
    }

    if (!best || best.s <= currentScore) break;

    chosen.push({
      gem: best.gem,
      gainPercent: currentScore > 0 ? ((best.s - currentScore) / currentScore) * 100 : 0,
      manaLeft: num(best.stats, 'ManaUnreserved'),
    });
    chosenGems.push(best.gem);
    currentScore = best.s;
    currentStats = best.stats;
  }

  return {
    chosen,
    baselineStats,
    finalStats: currentStats,
    evaluations,
    rejectedForReservation,
  };
}
