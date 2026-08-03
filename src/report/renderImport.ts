import type { TFunction } from '../i18n/index.js';
import type { ImportedBuildSummary } from '../pob/importCode.js';
import type { AuditFinding, BuildSnapshot } from '../domain/audit.js';

const B = '\x1b[1m';
const DIM = '\x1b[2m';
const R = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)} k`;
  return n.toFixed(0);
}

/** Colore une résistance selon qu'elle atteint le cap obligatoire. */
function res(value: number): string {
  const colour = value >= 75 ? GREEN : value >= 0 ? YELLOW : RED;
  return `${colour}${Math.round(value)} %${R}`;
}

export function renderImport(
  t: TFunction,
  summary: ImportedBuildSummary,
  snap: BuildSnapshot,
  findings: AuditFinding[],
): string {
  const out: string[] = [];
  const line = (s = '') => out.push(s);

  line();
  line(`${B}${CYAN}━━━ ${t('import.current')} ━━━${R}`);
  line(`${DIM}${summary.className} / ${summary.ascendancy} — niveau ${summary.level}${R}`);
  line();

  // --- Chiffres clés ----------------------------------------------------
  line(`  ${t('stat.CombinedDPS').padEnd(22)}${B}${fmt(snap.dps)}${R}`);
  line(`  ${t('stat.TotalEHP').padEnd(22)}${B}${fmt(snap.ehp)}${R}`);
  line(`  ${t('stat.Life').padEnd(22)}${fmt(snap.lifePool)}`);
  line(
    `  ${'Résistances'.padEnd(22)}` +
      `${res(snap.fireResist)} / ${res(snap.coldResist)} / ` +
      `${res(snap.lightningResist)} ${DIM}—${R} chaos ${res(snap.chaosResist)}`,
  );
  line();

  // --- Setup de gemmes importé -----------------------------------------
  if (summary.groups.length > 0) {
    line(`${B}${t('report.skillSetup')}${R}`);
    for (const g of summary.groups.slice(0, 8)) {
      const gems = g.gems
        .map((gem) => (gem.enabled ? gem.name : `${DIM}${gem.name}${R}`))
        .join(' + ');
      line(`  ${DIM}${g.slot.padEnd(14)}${R}${gems}`);
    }
    if (summary.groups.length > 8) {
      line(`  ${DIM}… et ${summary.groups.length - 8} autres groupes${R}`);
    }
    line();
  }

  // --- Audit ------------------------------------------------------------
  line(`${B}${t('audit.title')}${R}`);
  const blocking = findings.filter((f) => f.severity !== 'ok');
  if (blocking.length === 0) {
    line(`  ${GREEN}✓${R} ${t('audit.noIssues')}`);
  }
  for (const f of findings) {
    const icon =
      f.severity === 'critical' ? `${RED}✗${R}` : f.severity === 'warning' ? `${YELLOW}!${R}` : `${GREEN}✓${R}`;
    line(`  ${icon} ${t(f.key, f.params)}`);
  }
  line();

  return out.join('\n');
}
