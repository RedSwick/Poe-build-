import type { PobPool } from '../pob/pool.js';
import { toPobXml } from '../pob/buildXml.js';
import type { BuildDraft } from './types.js';
import type { Goal } from './scoring-types.js';
import { score, totalDamage, effectiveHp } from './goals.js';

/**
 * Sonde injectée dans le build pour mesurer sa réponse à une statistique.
 *
 * L'intérêt est de ne rien présupposer : on n'a pas besoin de savoir que la
 * vitesse d'attaque compte pour Flicker Strike, ni que les dégâts de sort ne
 * font rien sur un build de minions. On applique la stat, on recalcule, et
 * l'écart répond.
 */
export interface Probe {
  /** Clé i18n du libellé (`probe.*`). */
  key: string;
  /** Texte de modificateur, au format que PoB sait lire. */
  mod: string;
  /** Famille, pour regrouper l'affichage. */
  group: 'offense' | 'defense' | 'utility';
}

/**
 * Sondes par défaut.
 *
 * Volontairement génériques et de magnitude comparable, pour que les écarts
 * mesurés soient lisibles les uns par rapport aux autres. Ce ne sont pas des
 * recommandations : la plupart ne serviront à rien sur un build donné, et
 * c'est précisément ce que la mesure doit révéler.
 */
export const DEFAULT_PROBES: Probe[] = [
  { key: 'attackSpeed', mod: '10% increased Attack Speed', group: 'offense' },
  { key: 'castSpeed', mod: '10% increased Cast Speed', group: 'offense' },
  { key: 'critChance', mod: '50% increased Critical Strike Chance', group: 'offense' },
  { key: 'critMulti', mod: '+30% to Critical Strike Multiplier', group: 'offense' },
  { key: 'spellDamage', mod: '25% increased Spell Damage', group: 'offense' },
  { key: 'attackDamage', mod: '25% increased Attack Damage', group: 'offense' },
  { key: 'eleDamage', mod: '25% increased Elemental Damage', group: 'offense' },
  { key: 'fireDamage', mod: '25% increased Fire Damage', group: 'offense' },
  { key: 'coldDamage', mod: '25% increased Cold Damage', group: 'offense' },
  { key: 'lightningDamage', mod: '25% increased Lightning Damage', group: 'offense' },
  { key: 'physDamage', mod: '25% increased Physical Damage', group: 'offense' },
  { key: 'chaosDamage', mod: '25% increased Chaos Damage', group: 'offense' },
  { key: 'areaDamage', mod: '25% increased Area Damage', group: 'offense' },
  { key: 'projectileDamage', mod: '25% increased Projectile Damage', group: 'offense' },
  { key: 'minionDamage', mod: 'Minions deal 25% increased Damage', group: 'offense' },
  { key: 'minionAttackSpeed', mod: 'Minions have 15% increased Attack Speed', group: 'offense' },
  { key: 'minionCrit', mod: 'Minions have 50% increased Critical Strike Chance', group: 'offense' },
  { key: 'elePen', mod: 'Damage Penetrates 8% Elemental Resistances', group: 'offense' },
  { key: 'gemLevel', mod: '+1 to Level of all Skill Gems', group: 'offense' },
  { key: 'accuracy', mod: '25% increased Global Accuracy Rating', group: 'offense' },
  { key: 'skillDuration', mod: '25% increased Skill Effect Duration', group: 'offense' },
  { key: 'areaOfEffect', mod: '25% increased Area of Effect', group: 'offense' },

  { key: 'life', mod: '+150 to maximum Life', group: 'defense' },
  { key: 'lifePercent', mod: '10% increased maximum Life', group: 'defense' },
  { key: 'energyShield', mod: '+150 to maximum Energy Shield', group: 'defense' },
  { key: 'energyShieldPercent', mod: '25% increased maximum Energy Shield', group: 'defense' },
  { key: 'armour', mod: '25% increased Armour', group: 'defense' },
  { key: 'evasion', mod: '25% increased Evasion Rating', group: 'defense' },
  { key: 'eleRes', mod: '+10% to all Elemental Resistances', group: 'defense' },
  { key: 'chaosRes', mod: '+20% to Chaos Resistance', group: 'defense' },
  { key: 'maxRes', mod: '+2% to all maximum Elemental Resistances', group: 'defense' },
  { key: 'suppression', mod: '+10% chance to Suppress Spell Damage', group: 'defense' },
  { key: 'block', mod: '+10% Chance to Block Attack Damage', group: 'defense' },
  { key: 'lifeRegen', mod: 'Regenerate 2% of Life per second', group: 'defense' },

  { key: 'mana', mod: '+100 to maximum Mana', group: 'utility' },
  { key: 'reservation', mod: '10% increased Mana Reservation Efficiency', group: 'utility' },
];

/**
 * Comportement d'un axe quand on y investit réellement.
 *
 * C'est la distinction qui décide d'un build, et qu'une mesure au marginal ne
 * peut pas voir seule :
 *
 * - `linear` — le gain suit l'investissement. Rien à débloquer, on empile.
 * - `threshold` — faible ou nul tant qu'on n'y met qu'un peu, rentable une
 *   fois investi pour de bon. C'est le cas du critique : chance et
 *   multiplicateur pris chacun de leur côté ne valent presque rien, le couple
 *   poussé à fond change le build.
 * - `saturating` — déjà couvert, les points suivants rapportent moins.
 * - `dead` — sans effet, même investi à fond.
 */
export type AxisVerdict = 'linear' | 'threshold' | 'saturating' | 'dead';

/**
 * Une direction d'investissement : une statistique, ou un couple.
 *
 * Les couples existent parce que certaines statistiques ne valent rien
 * séparément. Les tester une par une, c'est passer à côté d'axes entiers.
 */
export interface Axis {
  probes: Probe[];
  group: Probe['group'];
  /** Gain d'une dose de chaque sonde de l'axe, en pourcentage du score. */
  marginal: number;
  /** Gain à budget d'investissement plein. */
  atScale: number;
  /**
   * Budget de doses de l'axe, réparti entre ses sondes.
   *
   * Un couple reçoit le même budget total qu'une stat seule, moitié chacune :
   * sans cela un couple gagnerait mécaniquement, pour la seule raison qu'on y
   * a mis deux fois plus de mods.
   */
  scale: number;
  /**
   * `atScale / (scale × marginal)` : 1 = linéaire, > 1 = le gain accélère,
   * < 1 = il s'essouffle. `Infinity` quand la stat est morte au marginal mais
   * vivante investie — le signal de seuil le plus fort qui soit.
   */
  acceleration: number;
  verdict: AxisVerdict;
  dpsAtScale: number;
  ehpAtScale: number;
}

export interface SensitivityResult {
  baseline: { score: number; dps: number; ehp: number };
  /** Axes simples et couples confondus, classés par gain investi. */
  axes: Axis[];
  scale: number;
  evaluations: number;
}

export interface SensitivityOptions {
  probes?: Probe[];
  /**
   * Nombre de doses appliquées pour la mesure « investie ».
   *
   * Six doses représentent à peu près ce qu'un axe coûte réellement en
   * points d'arbre et en affixes — l'ordre de grandeur d'une décision de
   * build, pas d'un mod isolé.
   */
  scale?: number;
  /**
   * Chercher aussi les couples de statistiques.
   *
   * Sans cela l'analyse reste aveugle à tout ce qui fonctionne par paquet.
   * Coûteux : le nombre de couples croît au carré du nombre de sondes.
   */
  pairs?: boolean;
  /** Couples retenus pour la mesure investie, parmi les plus prometteurs. */
  pairsKept?: number;
  onProgress?: (done: number, total: number, phase: SensitivityPhase) => void;
}

export type SensitivityPhase = 'single' | 'pairs' | 'scale';

const DEFAULT_SCALE = 6;

/** Gain relatif attendu de deux effets indépendants qui se multiplient. */
function independentGain(a: number, b: number): number {
  return ((1 + a / 100) * (1 + b / 100) - 1) * 100;
}

function verdictOf(marginal: number, atScale: number, scale: number): {
  acceleration: number;
  verdict: AxisVerdict;
} {
  if (Math.abs(atScale) < 0.1) return { acceleration: 1, verdict: 'dead' };
  // Morte à la dose, vivante investie : exactement ce qu'on cherche à ne pas
  // rater. Le rapport n'a pas de valeur finie, le verdict si.
  if (Math.abs(marginal) < 0.02) return { acceleration: Infinity, verdict: 'threshold' };

  const acceleration = atScale / (scale * marginal);
  const verdict: AxisVerdict =
    acceleration > 1.3 ? 'threshold' : acceleration < 0.8 ? 'saturating' : 'linear';
  return { acceleration, verdict };
}

/**
 * Mesure à quoi un build répond réellement, et à quelles doses.
 *
 * C'est la réponse à « quelles stats chercher » qui ne recopie rien : plutôt
 * que de reprendre ce que font les builds existants, on applique chaque
 * statistique au build en question et on lit l'écart. Une compétence que
 * personne n'a jamais jouée se traite exactement pareil.
 *
 * Chaque axe est mesuré à deux doses, parce qu'une seule ne suffit pas à
 * décider : une statistique peut être négligeable au marginal et décisive
 * investie. Voir `AxisVerdict`.
 */
export async function analyseSensitivity(
  pool: PobPool,
  draft: BuildDraft,
  goal: Goal,
  options: SensitivityOptions = {},
): Promise<SensitivityResult> {
  const probes = options.probes ?? DEFAULT_PROBES;
  const scale = options.scale ?? DEFAULT_SCALE;
  const pairsKept = options.pairsKept ?? 12;
  const { onProgress } = options;

  const base = await pool.evaluate(toPobXml(draft));
  const baseScore = score(base.stats, goal);
  const baseDps = totalDamage(base.stats);
  const baseEhp = effectiveHp(base.stats);
  let evaluations = 1;

  const measure = async (mods: string[]) => {
    const { stats } = await pool.evaluate(
      toPobXml({ ...draft, customMods: [...(draft.customMods ?? []), ...mods] }),
    );
    const pct = (now: number, before: number) =>
      before > 0 ? ((now - before) / before) * 100 : 0;
    return {
      gain: pct(score(stats, goal), baseScore),
      dps: pct(totalDamage(stats), baseDps),
      ehp: pct(effectiveHp(stats), baseEhp),
    };
  };

  /**
   * Répartit un budget de `n` doses entre les sondes d'un axe.
   *
   * Les mods « augmentés » s'additionnent, répéter la ligne revient donc bien
   * à investir davantage. Le budget est partagé, pas dupliqué : un couple
   * mesuré à deux fois le budget d'une stat seule gagnerait pour de mauvaises
   * raisons.
   */
  const dosesEach = (ps: Probe[]) => Math.max(1, Math.round(scale / ps.length));
  const doses = (ps: Probe[]) => {
    const each = dosesEach(ps);
    return ps.flatMap((p) => Array<string>(each).fill(p.mod));
  };

  const singles = await pool.map(
    probes,
    (probe) => measure([probe.mod]),
    (done, total) => onProgress?.(done, total, 'single'),
  );
  evaluations += probes.length;

  const marginalOf = new Map(probes.map((p, i) => [p.key, singles[i].gain]));
  const groups: Array<{ probes: Probe[]; marginal: number }> = probes.map((p, i) => ({
    probes: [p],
    marginal: singles[i].gain,
  }));

  if (options.pairs) {
    // Tous les couples au sein d'une même famille. On ne présélectionne pas
    // sur le gain individuel : une stat morte seule est précisément le cas
    // que cette passe existe pour rattraper.
    const combos: Array<[Probe, Probe]> = [];
    for (const group of ['offense', 'defense'] as const) {
      const g = probes.filter((p) => p.group === group);
      for (let i = 0; i < g.length; i++) {
        for (let j = i + 1; j < g.length; j++) combos.push([g[i], g[j]]);
      }
    }

    const measured = await pool.map(
      combos,
      async ([a, b]) => {
        const { gain } = await measure([a.mod, b.mod]);
        const expected = independentGain(marginalOf.get(a.key)!, marginalOf.get(b.key)!);
        return { probes: [a, b], marginal: gain, excess: gain - expected };
      },
      (done, total) => onProgress?.(done, total, 'pairs'),
    );
    evaluations += combos.length;

    // Seuls les couples qui font mieux que le produit de leurs parties
    // méritent la mesure investie : les autres n'apprennent rien de plus que
    // leurs sondes prises séparément.
    groups.push(
      ...measured
        .filter((m) => m.excess > 0.02)
        .sort((x, y) => y.excess - x.excess)
        .slice(0, pairsKept)
        .map(({ probes: ps, marginal }) => ({ probes: ps, marginal })),
    );
  }

  const scaled = await pool.map(
    groups,
    (g) => measure(doses(g.probes)),
    (done, total) => onProgress?.(done, total, 'scale'),
  );
  evaluations += groups.length;

  const axes: Axis[] = groups.map((g, i) => {
    const each = dosesEach(g.probes);
    return {
      probes: g.probes,
      group: g.probes[0].group,
      marginal: g.marginal,
      atScale: scaled[i].gain,
      scale: each,
      ...verdictOf(g.marginal, scaled[i].gain, each),
      dpsAtScale: scaled[i].dps,
      ehpAtScale: scaled[i].ehp,
    };
  });

  axes.sort((a, b) => b.atScale - a.atScale);
  return { baseline: { score: baseScore, dps: baseDps, ehp: baseEhp }, axes, scale, evaluations };
}
