import type { TFunction } from '../i18n/index.js';
import type { GearOptimizeResult } from '../domain/gearOptimizer.js';
import type { BudgetTier } from '../domain/budget.js';
import { resistanceStatus } from '../domain/goals.js';
import type { AuditFinding } from '../domain/audit.js';

const B = '\x1b[1m';
const DIM = '\x1b[2m';
const R = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GOLD = '\x1b[33m';

function resColour(v: number): string {
  const c = v >= 75 ? GREEN : v >= 0 ? YELLOW : RED;
  return `${c}${Math.round(v)}%${R}`;
}

export interface GearReportInput {
  result: GearOptimizeResult;
  tier: BudgetTier;
  pricesUnavailable: boolean;
  testedPerSlot: number;
  findings: AuditFinding[];
}

export function renderGear(t: TFunction, input: GearReportInput): string {
  const { result } = input;
  const out: string[] = [];
  const line = (s = '') => out.push(s);

  line();
  line(`${B}${CYAN}━━━ ${t('gear.title')} ━━━${R}`);
  line(`${DIM}${t('gear.running', { tier: t(`tier.${input.tier}`) })}${R}`);
  line();

  for (const c of result.chosen) {
    const price = c.price ? `  ${GOLD}${c.price}${R}` : '';
    const res = c.resContribution > 0 ? `  ${DIM}${t('gear.resGain', { n: c.resContribution })}${R}` : '';
    line(
      `  ${DIM}${c.slot.padEnd(13)}${R}${B}${c.item.name}${R}${price}  ` +
        `${GREEN}+${c.gainPercent.toFixed(1)} %${R}${res}`,
    );
    line(`  ${' '.repeat(13)}${DIM}${c.item.base}${R}`);
  }

  if (result.emptySlots.length > 0) {
    line();
    line(`  ${DIM}${t('gear.empty', { slots: result.emptySlots.join(', ') })}${R}`);
  }
  line();

  // --- Résistances : la règle qui prime -------------------------------
  const before = resistanceStatus(result.baselineStats);
  const after = resistanceStatus(result.finalStats);
  line(`${B}${t('stat.FireResist')} / ${t('stat.ColdResist')} / ${t('stat.LightningResist')}${R}`);
  line(
    `  ${DIM}${Math.round(before.fire)}/${Math.round(before.cold)}/${Math.round(before.lightning)}` +
      `  →  ${R}${resColour(after.fire)} / ${resColour(after.cold)} / ${resColour(after.lightning)}` +
      `   ${DIM}${t('stat.ChaosResist')}${R} ${resColour(after.chaos)}`,
  );
  line();

  for (const f of input.findings) {
    const icon = f.severity === 'critical' ? `${RED}✗${R}` : f.severity === 'warning' ? `${YELLOW}!${R}` : `${GREEN}✓${R}`;
    line(`  ${icon} ${t(f.key, f.params)}`);
  }
  line();

  // --- Mises en garde honnêtes -----------------------------------------
  if (input.pricesUnavailable) {
    line(`  ${YELLOW}${t('gear.pricesUnavailable')}${R}`);
  }
  line(`  ${DIM}${t('gear.uniquesOnly')}${R}`);
  line(`  ${DIM}${t('optimize.evaluations', { count: result.evaluations })}${R}`);
  line();

  return out.join('\n');
}
