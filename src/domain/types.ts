/** Une gemme placée dans un groupe de liens. */
export interface GemSocket {
  name: string;
  level: number;
  quality: number;
  skillId?: string;
  gemId?: string;
  variantId?: string;
}

/**
 * Un groupe de liens : une gemme principale et ses supports, dans un
 * emplacement d'équipement donné.
 *
 * Depuis la 3.29 les sockets n'ont plus de contrainte de couleur, donc un
 * groupe est simplement caractérisé par son nombre de liens.
 */
export interface SkillGroup {
  slot: string;
  main: GemSocket;
  supports: GemSocket[];
}

export interface ItemDraft {
  slot: string;
  /** Texte de l'item au format PoB (identique au copier-coller du jeu). */
  raw: string;
}

export interface ConfigInput {
  name: string;
  value: string | number | boolean;
}

/** Description complète d'un build, sérialisable vers le XML de PoB. */
export interface BuildDraft {
  className: string;
  ascendancy: string;
  ascendClassId?: number;
  level: number;
  groups: SkillGroup[];
  mainGroupIndex?: number;
  treeNodes?: number[];
  /** Effets de mastery retenus, sous forme [nœud, effet]. */
  masteryEffects?: Array<[nodeId: number, effectId: number]>;
  treeVersion?: string;
  bandit?: string;
  items?: ItemDraft[];
  config?: ConfigInput[];
}

/** Gemme telle qu'exportée par le moteur PoB. */
export interface GemInfo {
  gemId: string;
  name: string;
  baseTypeName: string;
  variantId?: string;
  grantedEffectId?: string;
  support: boolean;
  naturalMaxLevel?: number;
  reqStr?: number;
  reqDex?: number;
  reqInt?: number;
  tags: string[];
  skillTypes: number[];
  supportSkillTypes: number[];
  description?: string;
}

/**
 * Objectif d'optimisation exprimé par l'utilisateur.
 *
 * `damage` maximise les dégâts, `life` la vie/ES effectifs, `tankiness`
 * la survie globale (EHP), `balanced` un compromis.
 */
export type GoalKind = 'damage' | 'life' | 'tankiness' | 'balanced';

export interface Goal {
  kind: GoalKind;
  /** Pondérations par stat, utilisées pour scorer un build. */
  weights: Record<string, number>;
}

/** Contribution mesurée d'une gemme de support au score. */
export interface SupportEvaluation {
  gem: GemInfo;
  score: number;
  delta: number;
  deltaPercent: number;
  stats: Record<string, number | boolean>;
}

export interface StatPriority {
  stat: string;
  /** Gain de score pour une unité de stat ajoutée, normalisé. */
  weight: number;
  reason: string;
}
