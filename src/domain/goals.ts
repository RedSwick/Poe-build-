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

/**
 * Dégâts totaux du build.
 *
 * `FullDPS` agrège TOUTES les sources : minions, compétences déclenchées,
 * totems, et compétences octroyées par un objet. C'est la seule mesure
 * correcte pour un build d'invocation ou de trigger — un Soulwrest dont les
 * dégâts viennent de phantasmes est mesuré à quasi zéro par `CombinedDPS`,
 * qui ne regarde que la compétence principale du joueur.
 */
export function totalDamage(stats: PobStatsLike): number {
  const full = num(stats, 'FullDPS');
  const combined = num(stats, 'CombinedDPS');
  const fallback = num(stats, 'TotalDPS') + num(stats, 'TotalDotDPS');
  return Math.max(full, combined, fallback);
}

/**
 * Pénalité de réservation de mana.
 *
 * Un build qui réserve trop n'a plus de quoi lancer sa compétence : PoB
 * calcule la mana non réservée, on s'en sert comme d'une contrainte. C'est
 * ce qui permet à l'optimiseur d'arbre de comprendre qu'il doit chercher de
 * l'efficacité de réservation quand une aura ne rentre pas.
 */
export function reservationFactor(stats: PobStatsLike): number {
  const mana = num(stats, 'Mana');
  if (mana <= 0) return 1;
  const ratio = num(stats, 'ManaUnreserved') / mana;
  if (ratio >= 0.15) return 1;
  // Décroissance douce plutôt que couperet : l'optimiseur a besoin d'un
  // gradient pour retrouver de la mana, pas d'un mur.
  return Math.max(0.05, 0.2 + ratio * 5.33);
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

/** Cap de résistance élémentaire par défaut dans Path of Exile. */
export const ELEMENTAL_RES_CAP = 75;

export const ELEMENTAL_RESISTANCES = ['FireResist', 'ColdResist', 'LightningResist'] as const;

export interface ResistanceStatus {
  fire: number;
  cold: number;
  lightning: number;
  chaos: number;
  /** Résistances élémentaires manquantes pour atteindre le cap. */
  elementalShortfall: number;
  capped: boolean;
}

export function resistanceStatus(stats: PobStatsLike): ResistanceStatus {
  const fire = num(stats, 'FireResist');
  const cold = num(stats, 'ColdResist');
  const lightning = num(stats, 'LightningResist');
  const chaos = num(stats, 'ChaosResist');
  const elementalShortfall =
    Math.max(0, ELEMENTAL_RES_CAP - fire) +
    Math.max(0, ELEMENTAL_RES_CAP - cold) +
    Math.max(0, ELEMENTAL_RES_CAP - lightning);
  return { fire, cold, lightning, chaos, elementalShortfall, capped: elementalShortfall === 0 };
}

/**
 * Facteur de pénalité tant que les résistances ne sont pas au cap.
 *
 * Règle non négociable du jeu : sous 75 % de résistance élémentaire, un
 * personnage meurt en endgame quels que soient ses dégâts. La pénalité est
 * donc appliquée au score entier, pas ajoutée comme un simple bonus — sans
 * ça l'optimiseur préfère toujours des dégâts à des résistances.
 *
 * La résistance au chaos n'a pas de cap obligatoire mais compte pour un
 * petit bonus : elle est le trou défensif le plus courant en fin de partie.
 */
export function resistanceFactor(stats: PobStatsLike): number {
  const res = resistanceStatus(stats);

  // Décroissance douce plutôt que couperet : un build à 70 % doit être noté
  // au-dessus d'un build à 20 %, sinon l'optimiseur n'a aucun gradient à
  // suivre pour combler l'écart.
  const elemental = 1 / (1 + res.elementalShortfall * 0.02);

  // Bonus progressif jusqu'à 75 % de chaos, sans jamais dominer l'élémentaire.
  const chaosProgress = Math.min(Math.max(res.chaos, -60), ELEMENTAL_RES_CAP);
  const chaos = 1 + ((chaosProgress + 60) / 135) * 0.15;

  return elemental * chaos;
}

/**
 * Note un build selon un objectif.
 *
 * Forme multiplicative : score = Π composante^poids. Un build qui double ses
 * dégâts en divisant sa survie par deux n'est pas récompensé, ce qui évite
 * les recommandations absurdes de type « glass cannon » quand l'objectif est
 * équilibré.
 *
 * Le tout est pondéré par l'état des résistances : tant qu'elles ne sont pas
 * au cap, tout le reste vaut moins.
 */
export function score(stats: PobStatsLike, goal: Goal, opts: { enforceResCap?: boolean } = {}): number {
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

  if (opts.enforceResCap !== false) {
    acc *= resistanceFactor(stats);
  }
  acc *= reservationFactor(stats);
  return acc;
}
