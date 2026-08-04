import type { TFunction } from '../i18n/index.js';
import type { GemInfo, SupportEvaluation } from '../domain/types.js';
import type { Goal } from '../domain/scoring-types.js';
import { totalDamage, effectiveHp, lifePool } from '../domain/goals.js';
import type { OptimizeResult } from '../domain/optimizer.js';
import {
  passivePointsForLevel,
  type TreeOptimizeResult,
} from '../domain/treeOptimizer.js';
import type { AuraOptimizeResult } from '../domain/auraOptimizer.js';

const B = '\x1b[1m';
const DIM = '\x1b[2m';
const R = '\x1b[0m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)} k`;
  if (Math.abs(n) >= 10) return n.toFixed(0);
  return n.toFixed(2);
}

/** Stats mises en avant selon l'objectif poursuivi. */
const HIGHLIGHT: Record<string, string[]> = {
  damage: ['CombinedDPS', 'TotalDPS', 'TotalDotDPS', 'AverageDamage', 'Speed', 'CritChance', 'ManaCost'],
  life: ['LifeUnreserved', 'EnergyShield', 'TotalEHP', 'CombinedDPS', 'Mana'],
  tankiness: ['TotalEHP', 'LifeUnreserved', 'EnergyShield', 'Armour', 'Evasion', 'FireResist', 'ColdResist', 'LightningResist', 'ChaosResist', 'CombinedDPS'],
  balanced: ['CombinedDPS', 'TotalEHP', 'LifeUnreserved', 'EnergyShield', 'Speed'],
};

export interface ReportInput {
  mainGem: GemInfo;
  slot: string;
  links: number;
  goal: Goal;
  result: OptimizeResult;
  tree?: TreeOptimizeResult;
  auras?: AuraOptimizeResult;
  gemLevel: number;
  gemQuality: number;
  className: string;
  ascendancy: string;
  level: number;
}

export function renderReport(t: TFunction, input: ReportInput): string {
  const { mainGem, result, goal, slot, links } = input;
  const out: string[] = [];
  const line = (s = '') => out.push(s);

  line();
  line(`${B}${CYAN}━━━ ${t('report.title')} ━━━${R}`);
  line(
    `${DIM}${input.className} / ${input.ascendancy} — ${t('cli.optionLevel')} ${input.level} — ` +
      `${t(`goal.${goal.kind}`)}${R}`,
  );
  line();

  // --- Setup de gemmes : le livrable principal --------------------------
  line(`${B}${t('report.skillSetup')}${R}`);
  line(`${DIM}${t('report.linkCount', { n: links })} — ${t('report.inSlot', { slot })}${R}`);
  line();
  line(
    `  ${B}${GREEN}◆ ${mainGem.name}${R}  ${DIM}(${t('report.mainSkill')}, ` +
      `${input.gemLevel}/${input.gemQuality}%)${R}`,
  );

  if (result.chosen.length === 0) {
    line(`  ${DIM}${t('report.noGain')}${R}`);
  } else {
    for (const s of result.chosen) {
      const pct = s.deltaPercent;
      const sign = pct >= 0 ? '+' : '';
      line(
        `  ${B}◇ ${s.gem.name}${R}  ${DIM}(${input.gemLevel}/${input.gemQuality}%)${R}  ` +
          `${GREEN}${sign}${pct.toFixed(1)} %${R} ${DIM}${t('report.gain')}${R}`,
      );
    }
  }
  line();
  line(`  ${DIM}${t('report.socketNote')}${R}`);

  // Sur un objectif défensif, si aucun candidat n'a bougé les défenses, il
  // faut le dire : le classement retombe silencieusement sur les dégâts et
  // laisser croire le contraire serait trompeur.
  if (goal.kind === 'life' || goal.kind === 'tankiness') {
    const beforeDef = effectiveHp(result.baselineStats);
    const afterDef = effectiveHp(result.finalStats);
    if (Math.abs(afterDef - beforeDef) < 0.5) {
      line();
      line(`  ${YELLOW}${t('report.goalNoDefensiveEffect')}${R}`);
    }
  }
  line();

  // --- Stats avant/après -----------------------------------------------
  line(`${B}${t('report.stats')}${R}`);
  const keys = HIGHLIGHT[goal.kind] ?? HIGHLIGHT.balanced;
  // On montre l'écart de bout en bout : point de départ le plus brut
  // disponible, arrivée l'état final réellement calculé. Sans ça, sauter une
  // étape d'optimisation laisserait le tableau vide.
  const hasSupportRun = Object.keys(result.baselineStats).length > 0;
  const before = hasSupportRun ? result.baselineStats : (input.tree?.baselineStats ?? {});
  const after = input.auras?.finalStats ?? input.tree?.finalStats ?? result.finalStats;

  const label = (k: string) => t(`stat.${k}`);
  const width = Math.max(...keys.map((k) => label(k).length)) + 2;
  // La largeur de la colonne « avant » doit tenir compte de la longueur du
  // titre traduit, sinon les en-têtes se collent dans certaines langues.
  const headStart = t('report.statsStart');
  const headEnd = t('report.statsOptimised');
  const colWidth = Math.max(headStart.length + 2, 14);

  line(
    `  ${' '.repeat(width)}${DIM}${headStart.padEnd(colWidth)}${headEnd}${R}`,
  );
  for (const k of keys) {
    const b = typeof before[k] === 'number' ? (before[k] as number) : 0;
    const a = typeof after[k] === 'number' ? (after[k] as number) : 0;
    if (b === 0 && a === 0) continue;
    const changed = a !== b;
    const colour = !changed ? DIM : a > b ? GREEN : YELLOW;
    line(
      `  ${label(k).padEnd(width)}${DIM}${fmt(b).padEnd(colWidth)}${R}${colour}${fmt(a)}${R}`,
    );
  }
  line();

  // --- Auras ------------------------------------------------------------
  if (input.auras) {
    const a = input.auras;
    line(`${B}${t('aura.title')}${R}`);
    line();
    for (const c of a.chosen) {
      line(
        `  ${B}◉ ${c.gem.name}${R}  ${GREEN}+${c.gainPercent.toFixed(1)} %${R}  ` +
          `${DIM}${t('aura.manaLeft', { n: Math.round(c.manaLeft) })}${R}`,
      );
    }
    if (a.chosen.length === 0) line(`  ${DIM}${t('report.noGain')}${R}`);
    if (a.rejectedForReservation.length > 0) {
      line();
      line(
        `  ${YELLOW}${t('aura.rejected', { list: a.rejectedForReservation.slice(0, 6).join(', ') })}${R}`,
      );
    }
    line();
    line(`  ${DIM}${t('aura.note')}${R}`);
    line();
  }

  // --- Arbre de passifs -------------------------------------------------
  if (input.tree) {
    const tree = input.tree;
    line(`${B}${t('report.tree')}${R}`);
    line(
      `${DIM}${t('report.treePoints', {
        used: tree.pointsUsed,
        budget: input.level > 0 ? passivePointsForLevel(input.level) : tree.pointsUsed,
        asc: tree.ascPointsUsed,
      })}${R}`,
    );
    line();

    if (tree.chosen.length === 0) {
      line(`  ${DIM}${t('report.treeNoGain')}${R}`);
    } else {
      for (const c of tree.chosen) {
        const kind =
          c.node.type === 'Keystone' ? '★' : c.node.type === 'Mastery' ? '◈' : '●';
        const asc = c.node.ascendancy ? ` ${DIM}[${c.node.ascendancy}]${R}` : '';
        line(
          `  ${B}${kind} ${c.node.name}${R}${asc}  ` +
            `${DIM}${t('report.treeCost', { n: c.cost })}${R}  ` +
            `${GREEN}+${c.gainPercent.toFixed(1)} %${R}`,
        );
        // Le texte du nœud vient de PoB : c'est celui affiché en jeu.
        for (const s of c.node.stats.slice(0, 2)) {
          line(`      ${DIM}${s}${R}`);
        }
      }
    }
    line();
    line(`  ${B}${t('report.treeUrl')}${R}`);
    line(`  ${CYAN}${tree.url}${R}`);
    line();
  }

  // --- Priorités de stats ----------------------------------------------
  line(`${B}${t('report.priorities')}${R}`);
  line(`  ${DIM}${t(`priority.${goal.kind}`)}${R}`);
  for (const [i, p] of statPriorities(t, goal).entries()) {
    line(`  ${B}${i + 1}.${R} ${p.label}  ${DIM}${p.why}${R}`);
  }
  line();

  // --- Alternatives -----------------------------------------------------
  if (result.runnerUps.length > 0) {
    line(`${B}${t('report.alternatives')}${R}`);
    for (const s of result.runnerUps.slice(0, 5)) {
      const sign = s.deltaPercent >= 0 ? '+' : '';
      line(
        `  ${DIM}·${R} ${s.gem.name}  ${DIM}${sign}${s.deltaPercent.toFixed(1)} %${R}`,
      );
    }
    line();
  }

  const totalEvals =
    result.evaluations + (input.tree?.evaluations ?? 0) + (input.auras?.evaluations ?? 0);
  line(`${DIM}${t('optimize.evaluations', { count: totalEvals })}${R}`);
  // La mise en garde « personnage nu » ne vaut plus dès que l'arbre est
  // alloué : elle deviendrait fausse et minimiserait à tort les résultats.
  line(
    `${DIM}${input.tree ? t('report.noGearNote') : t('report.bareBuildNote')}${R}`,
  );
  line();

  return out.join('\n');
}

/**
 * Statistiques à privilégier pour un objectif, lues depuis les traductions.
 *
 * Volontairement qualitatif : le gain chiffré par point de stat dépend de
 * l'équipement réel, qui n'est pas encore intégré au calcul.
 */
function statPriorities(
  t: TFunction,
  goal: Goal,
): Array<{ label: string; why: string }> {
  return (
    t.raw<Array<{ label: string; why: string }>>(`priorityList.${goal.kind}`) ?? []
  );
}

/** Variante JSON, pour alimenter une interface web ou un autre outil. */
export function renderJson(input: ReportInput): string {
  const { result } = input;
  return JSON.stringify(
    {
      build: {
        className: input.className,
        ascendancy: input.ascendancy,
        level: input.level,
        goal: input.goal.kind,
      },
      setup: {
        slot: input.slot,
        links: input.links,
        main: {
          name: input.mainGem.name,
          gemId: input.mainGem.gemId,
          level: input.gemLevel,
          quality: input.gemQuality,
        },
        supports: result.chosen.map((s: SupportEvaluation) => ({
          name: s.gem.name,
          gemId: s.gem.gemId,
          level: input.gemLevel,
          quality: input.gemQuality,
          gainPercent: Number(s.deltaPercent.toFixed(2)),
        })),
      },
      stats: {
        before: {
          dps: totalDamage(result.baselineStats),
          ehp: effectiveHp(result.baselineStats),
          lifePool: lifePool(result.baselineStats),
          raw: result.baselineStats,
        },
        after: {
          dps: totalDamage(result.finalStats),
          ehp: effectiveHp(result.finalStats),
          lifePool: lifePool(result.finalStats),
          raw: result.finalStats,
        },
      },
      alternatives: result.runnerUps.map((s) => ({
        name: s.gem.name,
        gainPercent: Number(s.deltaPercent.toFixed(2)),
      })),
      tree: input.tree
        ? {
            pointsUsed: input.tree.pointsUsed,
            ascPointsUsed: input.tree.ascPointsUsed,
            url: input.tree.url,
            nodes: input.tree.chosen.map((c) => ({
              id: c.node.id,
              name: c.node.name,
              type: c.node.type,
              ascendancy: c.node.ascendancy,
              cost: c.cost,
              gainPercent: Number(c.gainPercent.toFixed(2)),
              stats: c.node.stats,
              masteryEffectId: c.masteryEffect?.id,
            })),
            allocated: input.tree.allocated,
            masterySelections: input.tree.masterySelections,
          }
        : undefined,
      evaluations: result.evaluations,
    },
    null,
    2,
  );
}
