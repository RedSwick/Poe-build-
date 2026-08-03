import type { PobStatsLike } from './scoring-types.js';
import { resistanceStatus, ELEMENTAL_RES_CAP, totalDamage, effectiveHp, lifePool } from './goals.js';

export type Severity = 'critical' | 'warning' | 'ok';

export interface AuditFinding {
  severity: Severity;
  /** Clé de traduction du constat. */
  key: string;
  params?: Record<string, string | number>;
}

/**
 * Diagnostique un build sur les règles non négociables de Path of Exile.
 *
 * Ces règles ne sont pas des préférences : un personnage sous le cap de
 * résistances meurt en endgame quelle que soit sa feuille de dégâts. L'audit
 * les remonte donc avant toute considération d'optimisation.
 */
export function auditBuild(stats: PobStatsLike): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const res = resistanceStatus(stats);
  const num = (k: string) => (typeof stats[k] === 'number' ? (stats[k] as number) : 0);

  // --- Résistances : la règle prioritaire ------------------------------
  const under = ([
    ['fire', res.fire],
    ['cold', res.cold],
    ['lightning', res.lightning],
  ] as const).filter(([, v]) => v < ELEMENTAL_RES_CAP);

  if (under.length > 0) {
    for (const [which, value] of under) {
      findings.push({
        severity: 'critical',
        key: 'audit.resUncapped',
        params: { res: which, value: Math.round(value), missing: Math.round(ELEMENTAL_RES_CAP - value) },
      });
    }
  } else {
    findings.push({ severity: 'ok', key: 'audit.resCapped' });

    // L'overcap absorbe les malédictions de map (Elemental Weakness) et les
    // pénalités de résistance : être pile à 75 % ne suffit pas en endgame.
    const overcap = Math.min(
      num('FireResistOverCap'),
      num('ColdResistOverCap'),
      num('LightningResistOverCap'),
    );
    if (overcap < 20) {
      findings.push({
        severity: 'warning',
        key: 'audit.resOvercapLow',
        params: { overcap: Math.round(overcap) },
      });
    }
  }

  if (res.chaos < 0) {
    findings.push({
      severity: 'warning',
      key: 'audit.chaosResLow',
      params: { value: Math.round(res.chaos) },
    });
  }

  // --- Pool de vie effectif --------------------------------------------
  const pool = lifePool(stats);
  const ehp = effectiveHp(stats);
  if (pool > 0 && pool < 4000) {
    findings.push({
      severity: pool < 2500 ? 'critical' : 'warning',
      key: 'audit.lowLifePool',
      params: { pool: Math.round(pool) },
    });
  }

  // --- Dégâts -----------------------------------------------------------
  const dps = totalDamage(stats);
  if (dps > 0 && dps < 100_000) {
    findings.push({
      severity: 'warning',
      key: 'audit.lowDps',
      params: { dps: Math.round(dps) },
    });
  }

  return findings;
}

export interface BuildSnapshot {
  dps: number;
  ehp: number;
  lifePool: number;
  fireResist: number;
  coldResist: number;
  lightningResist: number;
  chaosResist: number;
}

export function snapshot(stats: PobStatsLike): BuildSnapshot {
  const res = resistanceStatus(stats);
  return {
    dps: totalDamage(stats),
    ehp: effectiveHp(stats),
    lifePool: lifePool(stats),
    fireResist: res.fire,
    coldResist: res.cold,
    lightningResist: res.lightning,
    chaosResist: res.chaos,
  };
}
