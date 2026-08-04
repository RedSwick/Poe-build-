import type { CorpusEntry } from './store.js';

/**
 * Fréquences observées dans le corpus, servant d'a priori de recherche.
 *
 * L'optimiseur ne peut pas explorer un espace de plusieurs milliards de
 * combinaisons. Savoir ce que les vrais builds utilisent ne réduit pas cet
 * espace, mais le hiérarchise : on teste d'abord ce qui a des chances de
 * marcher, et le reste seulement s'il reste du budget.
 */
export interface Priors {
  /** Nombre de builds ayant servi à établir ces fréquences. */
  sampleSize: number;
  /** Supports les plus fréquents, par gemme principale. */
  supportsBySkill: Map<string, Array<{ name: string; count: number; share: number }>>;
  /** Ascendancies les plus fréquentes, par gemme principale. */
  ascendancyBySkill: Map<string, Array<{ name: string; count: number; share: number }>>;
  /** Nœuds d'arbre les plus alloués, tous builds confondus. */
  commonNodes: Array<{ id: number; count: number; share: number }>;
  /** Effets de mastery les plus retenus. */
  commonMasteries: Array<{ node: number; effect: number; count: number }>;
}

function rank<T extends string>(counts: Map<T, number>, total: number) {
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count, share: count / total }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Calcule les a priori à partir du corpus.
 *
 * La gemme principale d'un build est prise comme la première gemme active
 * de son groupe principal : c'est l'information dont dispose l'utilisateur
 * quand il demande « un build Winter Orb ».
 */
export function computePriors(entries: CorpusEntry[]): Priors {
  const supportsBySkill = new Map<string, Map<string, number>>();
  const ascBySkill = new Map<string, Map<string, number>>();
  const nodeCounts = new Map<number, number>();
  const masteryCounts = new Map<string, number>();
  const skillTotals = new Map<string, number>();

  for (const entry of entries) {
    for (const node of new Set(entry.treeNodes)) {
      nodeCounts.set(node, (nodeCounts.get(node) ?? 0) + 1);
    }
    for (const [node, effect] of entry.masteryEffects) {
      const key = `${node}:${effect}`;
      masteryCounts.set(key, (masteryCounts.get(key) ?? 0) + 1);
    }

    // Chaque groupe de liens est traité séparément : un build a souvent
    // plusieurs compétences intéressantes, pas seulement la principale.
    for (const group of entry.summary.groups) {
      const [main, ...supports] = group.gems;
      if (!main) continue;
      const skill = main.name;

      skillTotals.set(skill, (skillTotals.get(skill) ?? 0) + 1);

      const s = supportsBySkill.get(skill) ?? new Map<string, number>();
      for (const sup of supports) {
        if (!sup.enabled) continue;
        s.set(sup.name, (s.get(sup.name) ?? 0) + 1);
      }
      supportsBySkill.set(skill, s);

      const a = ascBySkill.get(skill) ?? new Map<string, number>();
      a.set(entry.summary.ascendancy, (a.get(entry.summary.ascendancy) ?? 0) + 1);
      ascBySkill.set(skill, a);
    }
  }

  const total = Math.max(entries.length, 1);
  return {
    sampleSize: entries.length,
    supportsBySkill: new Map(
      [...supportsBySkill].map(([skill, counts]) => [
        skill,
        rank(counts, skillTotals.get(skill) ?? 1),
      ]),
    ),
    ascendancyBySkill: new Map(
      [...ascBySkill].map(([skill, counts]) => [skill, rank(counts, skillTotals.get(skill) ?? 1)]),
    ),
    commonNodes: [...nodeCounts.entries()]
      .map(([id, count]) => ({ id, count, share: count / total }))
      .sort((a, b) => b.count - a.count),
    commonMasteries: [...masteryCounts.entries()]
      .map(([key, count]) => {
        const [node, effect] = key.split(':').map(Number);
        return { node, effect, count };
      })
      .sort((a, b) => b.count - a.count),
  };
}

/**
 * Réordonne des candidats pour tester d'abord ceux que le corpus valide.
 *
 * Les candidats absents du corpus ne sont pas écartés — ils passent après.
 * Un corpus trop petit ne doit pas devenir un plafond de verre : c'est un
 * indice de départ, pas une liste blanche.
 */
export function orderByPrior<T>(
  candidates: T[],
  nameOf: (c: T) => string,
  priors: Array<{ name: string; count: number }> | undefined,
): T[] {
  if (!priors || priors.length === 0) return candidates;
  const rankOf = new Map(priors.map((p, i) => [p.name.toLowerCase(), i]));
  return [...candidates].sort(
    (a, b) =>
      (rankOf.get(nameOf(a).toLowerCase()) ?? Number.MAX_SAFE_INTEGER) -
      (rankOf.get(nameOf(b).toLowerCase()) ?? Number.MAX_SAFE_INTEGER),
  );
}
