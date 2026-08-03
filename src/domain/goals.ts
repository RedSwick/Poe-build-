import type { Goal, GoalKind, PobStatsLike } from './scoring-types.js';

/**
 * Traduit un objectif utilisateur en pondérations de stats.
 *
 * Les exposants sont utilisés dans un score multiplicatif (voir `score()`),
 * ce qui rend la note insensible aux ordres de grandeur : 1 M de DPS et
 * 5 000 points de vie effective se comparent sans réglage manuel.
 */
export const GOALS: Record<GoalKind, Goal> = {
  damage: {
    kind: 'damage',
    weights: { dps: 1.0, ehp: 0.15 },
  },
  life: {
    kind: 'life',
    // « Plus de vie » vise le pool brut, pas la mitigation.
    weights: { dps: 0.15, lifePool: 1.0 },
  },
  tankiness: {
    kind: 'tankiness',
    // La tankiness prend en compte résistances, mitigation et recharge,
    // ce que l'EHP de PoB agrège déjà.
    weights: { dps: 0.15, ehp: 1.0 },
  },
  balanced: {
    kind: 'balanced',
    weights: { dps: 0.6, ehp: 0.6 },
  },
};

export function resolveGoal(kind: string): Goal {
  const g = GOALS[kind as GoalKind];
  if (!g) {
    throw new Error(
      `Objectif inconnu : « ${kind} ». Valeurs acceptées : ${Object.keys(GOALS).join(', ')}`,
    );
  }
  return g;
}

function num(stats: PobStatsLike, key: string): number {
  const v = stats[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Dégâts totaux, en incluant les dégâts sur la durée. */
export function totalDamage(stats: PobStatsLike): number {
  const combined = num(stats, 'CombinedDPS');
  if (combined > 0) return combined;
  return num(stats, 'TotalDPS') + num(stats, 'TotalDotDPS');
}

/** Pool de vie effectif : vie non réservée + bouclier d'énergie + ward. */
export function lifePool(stats: PobStatsLike): number {
  const life = num(stats, 'LifeUnreserved') || num(stats, 'Life');
  return life + num(stats, 'EnergyShield') + num(stats, 'Ward');
}

/** Survie globale telle que calculée par PoB (mitigation incluse). */
export function effectiveHp(stats: PobStatsLike): number {
  const ehp = num(stats, 'TotalEHP');
  return ehp > 0 ? ehp : lifePool(stats);
}

/**
 * Note un build selon un objectif.
 *
 * Forme multiplicative : score = Π composante^poids. Un build qui double ses
 * dégâts en divisant sa survie par deux n'est pas récompensé, ce qui évite
 * les recommandations absurdes de type « glass cannon » quand l'objectif est
 * équilibré.
 */
export function score(stats: PobStatsLike, goal: Goal): number {
  const parts: Record<string, number> = {
    dps: totalDamage(stats),
    ehp: effectiveHp(stats),
    lifePool: lifePool(stats),
  };

  let acc = 1;
  for (const [key, weight] of Object.entries(goal.weights)) {
    const value = parts[key] ?? 0;
    // Un build sans dégâts ou sans survie doit être écarté, pas noté 0
    // partout : on plancher à 1 pour garder la fonction exploitable.
    acc *= Math.pow(Math.max(value, 1), weight);
  }
  return acc;
}
