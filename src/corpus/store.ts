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
  /** Version de l'arbre du build : la seule marque de ligue dans un export. */
  treeVersion?: string | null;
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

/** Version d'arbre visée par le projet. */
export const TARGET_TREE_VERSION = '3_29';

/**
 * Version de l'arbre sur laquelle un build a été construit.
 *
 * C'est la seule marque de ligue fiable dans un export PoB : il n'y a pas de
 * champ « ligue », mais l'arbre change à chaque extension et son numéro est
 * écrit dans le XML. Un build en `3_28` a été pensé pour un arbre qui n'existe
 * plus tel quel.
 */
export function treeVersionOf(xml: string): string | null {
  return xml.match(/<Spec[^>]*\btreeVersion="([^"]+)"/)?.[1] ?? null;
}

/**
 * Emplacements où Path of Building range ses builds, par système.
 *
 * PoB écrit un `.xml` par build, exactement au format qu'on sait déjà lire.
 * Une installation un peu utilisée en contient des dizaines : c'est le corpus
 * le plus riche et le plus immédiat qui soit, et il ne demande aucun réseau.
 */
export function defaultPobBuildDirs(): string[] {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');

  const under = (base: string) => [
    path.join(base, 'Documents', 'Path of Building', 'Builds'),
    path.join(base, 'OneDrive', 'Documents', 'Path of Building', 'Builds'),
  ];

  const dirs = [
    ...under(home),
    path.join(appData, 'Path of Building', 'Builds'),
    // Linux / macOS, natif ou via Wine/Proton.
    path.join(home, '.local', 'share', 'Path of Building', 'Builds'),
    path.join(home, 'Library', 'Application Support', 'Path of Building', 'Builds'),
    path.join(home, '.wine', 'drive_c', 'users', process.env.USER ?? '', 'Documents', 'Path of Building', 'Builds'),
  ];

  // Sous WSL, le projet tourne côté Linux mais Path of Building est installé
  // côté Windows : le dossier personnel de l'un ne mène pas à celui de
  // l'autre. Sans ce détour, la détection ne trouve jamais rien sur ce qui
  // est pourtant la configuration la plus courante.
  for (const drive of ['/mnt/c/Users', '/mnt/d/Users']) {
    if (!existsSync(drive)) continue;
    for (const user of readdirSync(drive, { withFileTypes: true })) {
      if (!user.isDirectory()) continue;
      if (['Public', 'Default', 'All Users', 'Default User'].includes(user.name)) continue;
      dirs.push(...under(path.join(drive, user.name)));
    }
  }

  return dirs;
}

/** Parcourt un dossier et rend les fichiers de build qu'il contient. */
export function findBuildFiles(dir: string, depth = 6): string[] {
  if (!existsSync(dir) || depth < 0) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) out.push(...findBuildFiles(full, depth - 1));
    // PoB écrit du `.xml` ; les codes exportés se rangent souvent en `.txt`.
    else if (/\.(xml|txt)$/i.test(name.name)) out.push(full);
  }
  return out;
}

/**
 * Ajoute un build au corpus.
 *
 * L'identifiant dérive du contenu : réimporter le même build le met à jour
 * au lieu de le dupliquer, ce qui rend la commande sûre à relancer sur une
 * liste entière.
 */
export async function addToCorpus(
  source: string,
  options: { requireTreeVersion?: string | null } = {},
): Promise<{ entry: CorpusEntry; isNew: boolean }> {
  const xml = await fetchBuildFromUrlOrCode(source);

  // Un build d'une ancienne extension fausse tout ce qu'on en tire : les
  // a priori de recherche comme la validation des calculs. Mieux vaut le
  // refuser bruyamment que l'agréger en silence.
  const required = options.requireTreeVersion;
  if (required) {
    const found = treeVersionOf(xml);
    if (found !== required) {
      throw new Error(
        `build en arbre ${found ?? 'inconnu'}, attendu ${required} — ignoré`,
      );
    }
  }

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
    treeVersion: treeVersionOf(xml),
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
