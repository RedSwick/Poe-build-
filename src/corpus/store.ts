import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PROJECT_ROOT } from '../pob/bridge.js';
import { fetchBuildFromUrlOrCode, summarizeBuildXml, type ImportedBuildSummary } from '../pob/importCode.js';

/**
 * Le corpus vit dans le dépôt, pas dans un cache.
 *
 * C'est la mémoire du projet : les builds servent à la fois de références
 * pour vérifier les calculs et de source d'a priori pour guider la
 * recherche. Ils doivent donc être versionnés avec le code.
 */
export const CORPUS_DIR = path.join(PROJECT_ROOT, 'corpus');

export interface CorpusEntry {
  id: string;
  source: string;
  addedAt: string;
  summary: ImportedBuildSummary;
  /**
   * Statistiques telles que stockées dans le build par son auteur.
   *
   * Path of Building sérialise ses propres résultats dans le XML : ce sont
   * des valeurs de référence gratuites, qui permettent de vérifier que notre
   * moteur reproduit bien les mêmes chiffres.
   */
  authorStats: Record<string, number>;
  /** Nœuds d'arbre alloués, pour les statistiques d'usage. */
  treeNodes: number[];
  /** Effets de mastery retenus. */
  masteryEffects: Array<[number, number]>;
  xml: string;
}

/** Extrait les `PlayerStat` que PoB a écrits dans le build. */
export function extractAuthorStats(xml: string): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const m of xml.matchAll(/<PlayerStat\s+stat="([^"]+)"\s+value="([^"]*)"/g)) {
    const v = Number(m[2]);
    if (Number.isFinite(v)) stats[m[1]] = v;
  }
  return stats;
}

function extractTree(xml: string): { nodes: number[]; masteries: Array<[number, number]> } {
  const spec = xml.match(/<Spec\b[^>]*>/)?.[0] ?? '';
  const nodes = (spec.match(/nodes="([^"]*)"/)?.[1] ?? '')
    .split(',')
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const masteries: Array<[number, number]> = [];
  for (const m of (spec.match(/masteryEffects="([^"]*)"/)?.[1] ?? '').matchAll(/\{(\d+),(\d+)\}/g)) {
    masteries.push([Number(m[1]), Number(m[2])]);
  }
  return { nodes, masteries };
}

export function corpusPath(id: string): string {
  return path.join(CORPUS_DIR, `${id}.json`);
}

/**
 * Ajoute un build au corpus.
 *
 * L'identifiant dérive du contenu : réimporter le même build le met à jour
 * au lieu de le dupliquer, ce qui rend la commande sûre à relancer sur une
 * liste entière.
 */
export async function addToCorpus(source: string): Promise<{ entry: CorpusEntry; isNew: boolean }> {
  const xml = await fetchBuildFromUrlOrCode(source);
  const id = createHash('sha1').update(xml).digest('hex').slice(0, 12);
  const tree = extractTree(xml);

  const entry: CorpusEntry = {
    id,
    source,
    addedAt: new Date().toISOString(),
    summary: summarizeBuildXml(xml),
    authorStats: extractAuthorStats(xml),
    treeNodes: tree.nodes,
    masteryEffects: tree.masteries,
    xml,
  };

  mkdirSync(CORPUS_DIR, { recursive: true });
  const isNew = !existsSync(corpusPath(id));
  writeFileSync(corpusPath(id), JSON.stringify(entry, null, 2), 'utf8');
  return { entry, isNew };
}

export function loadCorpus(): CorpusEntry[] {
  if (!existsSync(CORPUS_DIR)) return [];
  return readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(CORPUS_DIR, f), 'utf8')) as CorpusEntry);
}

/**
 * Lit une liste de sources depuis un fichier.
 *
 * Un lien ou un code par ligne ; les lignes vides et celles commençant par
 * `#` sont ignorées, pour pouvoir commenter la liste.
 */
export function readSourceList(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}
