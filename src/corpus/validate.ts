import type { PobPool } from '../pob/pool.js';
import type { CorpusEntry } from './store.js';

/**
 * Statistiques comparées entre notre calcul et celui de l'auteur du build.
 *
 * On se limite à des grandeurs structurantes : un écart sur l'une d'elles
 * signale un vrai problème de pipeline, pas un détail de configuration.
 */
export const COMPARED_STATS = [
  'FullDPS',
  'CombinedDPS',
  'TotalEHP',
  'Life',
  'EnergyShield',
  'Armour',
  'FireResist',
  'ColdResist',
  'LightningResist',
  'ChaosResist',
] as const;

export interface StatComparison {
  stat: string;
  author: number;
  computed: number;
  /** Écart relatif, ou null quand l'auteur n'a pas stocké la valeur. */
  deviation: number | null;
}

export interface ValidationResult {
  id: string;
  source: string;
  className: string;
  ascendancy: string;
  level: number;
  comparisons: StatComparison[];
  /** Écart le plus grand parmi les stats comparables. */
  worstDeviation: number;
  error?: string;
}

/**
 * Rejoue chaque build du corpus dans notre moteur et compare le résultat
 * aux valeurs que Path of Building avait écrites dedans.
 *
 * C'est un filet de sécurité contre les erreurs silencieuses : le bug qui
 * mesurait les builds de minions à zéro, ou celui qui perdait l'arbre à la
 * re-sérialisation, auraient été signalés ici en une commande au lieu
 * d'être découverts à la main.
 */
export async function validateCorpus(
  pool: PobPool,
  entries: CorpusEntry[],
  onProgress?: (done: number, total: number) => void,
): Promise<ValidationResult[]> {
  return pool.map(
    entries,
    async (entry): Promise<ValidationResult> => {
      const base = {
        id: entry.id,
        source: entry.source,
        className: entry.summary.className,
        ascendancy: entry.summary.ascendancy,
        level: entry.summary.level,
      };

      try {
        // On rejoue le XML d'origine tel quel : le but est de vérifier notre
        // moteur, pas notre reconstruction du build.
        const { stats } = await pool.evaluate(entry.xml);

        const comparisons: StatComparison[] = [];
        for (const stat of COMPARED_STATS) {
          const author = entry.authorStats[stat];
          const computed = typeof stats[stat] === 'number' ? (stats[stat] as number) : 0;
          if (author === undefined) continue;

          // Les valeurs proches de zéro donneraient des écarts relatifs
          // absurdes : on les compare en absolu.
          const scale = Math.max(Math.abs(author), 1);
          comparisons.push({
            stat,
            author,
            computed,
            deviation: Math.abs(computed - author) / scale,
          });
        }

        const worst = comparisons.reduce((m, c) => Math.max(m, c.deviation ?? 0), 0);
        return { ...base, comparisons, worstDeviation: worst };
      } catch (err) {
        return {
          ...base,
          comparisons: [],
          worstDeviation: Infinity,
          error: (err as Error).message,
        };
      }
    },
    onProgress,
  );
}

/** Seuil au-delà duquel un écart est considéré comme un défaut. */
export const DEVIATION_THRESHOLD = 0.05;
