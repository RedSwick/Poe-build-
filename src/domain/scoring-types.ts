export type PobStatsLike = Record<string, number | boolean>;

export type GoalKind = 'damage' | 'life' | 'tankiness' | 'balanced';

export interface Goal {
  kind: GoalKind;
  weights: Record<string, number>;
}
