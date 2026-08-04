import type { ConfigInput } from './types.js';

/**
 * Conditions de combat utilisées pour le calcul.
 *
 * Deux builds ne sont comparables que sous la même configuration : passer de
 * « pas de boss » à « Uber Pinnacle » divise le DPS par près de sept sur un
 * même personnage. Sans réglage explicite, PoB retient « Pinnacle » —
 * raisonnable, mais il faut le dire plutôt que de le laisser implicite.
 */
export type EnemyKind = 'none' | 'boss' | 'pinnacle' | 'uber';

const ENEMY_VALUES: Record<EnemyKind, string> = {
  none: 'None',
  boss: 'Boss',
  pinnacle: 'Pinnacle',
  uber: 'Uber',
};

export interface CombatConfig {
  enemy: EnemyKind;
  /** Niveau de l'ennemi ; laissé au défaut de PoB si absent. */
  enemyLevel?: number;
  powerCharges: boolean;
  frenzyCharges: boolean;
  enduranceCharges: boolean;
  /** Force l'ennemi à être considéré comme maudit. */
  enemyCursed: boolean;
}

export const DEFAULT_COMBAT: CombatConfig = {
  // Même défaut que PoB, pour que nos chiffres restent comparables aux
  // siens et à ceux publiés par la communauté.
  enemy: 'pinnacle',
  powerCharges: false,
  frenzyCharges: false,
  enduranceCharges: false,
  enemyCursed: false,
};

/** Traduit la configuration en entrées `<Input>` du XML de PoB. */
export function toConfigInputs(cfg: CombatConfig): ConfigInput[] {
  const inputs: ConfigInput[] = [{ name: 'enemyIsBoss', value: ENEMY_VALUES[cfg.enemy] }];

  if (cfg.enemyLevel !== undefined) {
    inputs.push({ name: 'enemyLevel', value: cfg.enemyLevel });
  }
  // Les cases non cochées sont omises : PoB les traite comme fausses, et
  // écrire `false` ferait apparaître des options inutiles dans le build.
  if (cfg.powerCharges) inputs.push({ name: 'usePowerCharges', value: true });
  if (cfg.frenzyCharges) inputs.push({ name: 'useFrenzyCharges', value: true });
  if (cfg.enduranceCharges) inputs.push({ name: 'useEnduranceCharges', value: true });
  if (cfg.enemyCursed) inputs.push({ name: 'conditionEnemyCursed', value: true });

  return inputs;
}

export function parseEnemy(value: string | undefined): EnemyKind {
  const v = (value ?? '').toLowerCase();
  if (v === 'none' || v === 'aucun') return 'none';
  if (v === 'boss') return 'boss';
  if (v === 'uber') return 'uber';
  if (v === 'pinnacle' || v === '') return 'pinnacle';
  throw new Error(
    `Ennemi inconnu : « ${value} ». Valeurs acceptées : none, boss, pinnacle, uber.`,
  );
}

/** Résumé lisible, à afficher avec tout chiffre de DPS. */
export function describeCombat(cfg: CombatConfig): string {
  const charges = [
    cfg.powerCharges && 'pouvoir',
    cfg.frenzyCharges && 'frénésie',
    cfg.enduranceCharges && 'endurance',
  ].filter(Boolean);
  const parts = [`ennemi : ${cfg.enemy}`];
  if (cfg.enemyLevel !== undefined) parts.push(`niveau ${cfg.enemyLevel}`);
  if (charges.length > 0) parts.push(`charges ${charges.join('/')}`);
  if (cfg.enemyCursed) parts.push('maudit');
  return parts.join(' · ');
}
