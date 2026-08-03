import { inflate, inflateRaw } from 'node:zlib';
import { promisify } from 'node:util';

const inflateAsync = promisify(inflate);
const inflateRawAsync = promisify(inflateRaw);

/**
 * Décode un code de build Path of Building.
 *
 * Format : XML compressé en zlib, encodé en base64 « URL-safe » (`-` et `_`
 * au lieu de `+` et `/`). PoB 1 produit historiquement du deflate brut, les
 * versions récentes du zlib avec en-tête : on tente les deux.
 */
export async function decodePobCode(code: string): Promise<string> {
  const cleaned = code
    .trim()
    .replace(/^.*?([A-Za-z0-9\-_=+/]{40,})\s*$/s, '$1')
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  if (cleaned.length === 0) {
    throw new Error('Code de build vide');
  }

  const buf = Buffer.from(cleaned, 'base64');
  if (buf.length === 0) {
    throw new Error('Code de build invalide (base64 illisible)');
  }

  let xml: string | undefined;
  for (const fn of [inflateAsync, inflateRawAsync]) {
    try {
      xml = (await fn(buf)).toString('utf8');
      break;
    } catch {
      // On essaie l'autre variante de deflate avant d'abandonner.
    }
  }

  if (!xml) {
    throw new Error(
      'Impossible de décompresser le code de build. ' +
        'Vérifie que tu as bien copié le code depuis « Import/Export Build » de Path of Building.',
    );
  }
  if (!xml.includes('<PathOfBuilding')) {
    throw new Error(
      "Le contenu décodé n'est pas un build Path of Building. " +
        "S'agit-il d'un code Path of Building 2 (PoE 2) ? Cet outil cible Path of Exile 1.",
    );
  }
  return xml;
}

/**
 * Récupère un build depuis un lien de partage.
 *
 * Accepte les liens pastebin.com et pobb.in, qui sont les deux formats
 * partagés en pratique par la communauté, ou un code brut.
 */
export async function fetchBuildFromUrlOrCode(input: string): Promise<string> {
  const trimmed = input.trim();

  const pastebin = trimmed.match(/pastebin\.com\/(?:raw\/)?([A-Za-z0-9]+)/);
  if (pastebin) {
    return decodePobCode(await fetchText(`https://pastebin.com/raw/${pastebin[1]}`));
  }

  const pobbin = trimmed.match(/pobb\.in\/([A-Za-z0-9_-]+)/);
  if (pobbin) {
    return decodePobCode(await fetchText(`https://pobb.in/${pobbin[1]}/raw`));
  }

  if (/^https?:\/\//.test(trimmed)) {
    return decodePobCode(await fetchText(trimmed));
  }

  return decodePobCode(trimmed);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'poe-build-architect/0.1 (personal build tool)' },
  });
  if (!res.ok) {
    throw new Error(`Impossible de récupérer le build (${res.status} depuis ${url})`);
  }
  return res.text();
}

export interface ImportedBuildSummary {
  className: string;
  ascendancy: string;
  level: number;
  mainSocketGroup: number;
  treeVersion?: string;
  /** Groupes de liens trouvés, gemme principale en tête. */
  groups: Array<{ slot: string; gems: Array<{ name: string; level: number; quality: number; enabled: boolean }> }>;
  itemCount: number;
}

/**
 * Extrait un résumé lisible d'un XML de build.
 *
 * Volontairement tolérant : un build exporté par une version différente de
 * PoB peut omettre des attributs, ce qui ne doit pas empêcher l'analyse.
 */
export function summarizeBuildXml(xml: string): ImportedBuildSummary {
  const attr = (source: string, name: string): string | undefined =>
    source.match(new RegExp(`${name}="([^"]*)"`))?.[1];

  const buildTag = xml.match(/<Build\b[^>]*>/)?.[0] ?? '';
  const specTag = xml.match(/<Spec\b[^>]*>/)?.[0] ?? '';

  const groups: ImportedBuildSummary['groups'] = [];
  for (const skill of xml.matchAll(/<Skill\b([^>]*)>([\s\S]*?)<\/Skill>/g)) {
    const header = skill[1];
    const gems: ImportedBuildSummary['groups'][number]['gems'] = [];
    for (const gem of skill[2].matchAll(/<Gem\b([^>]*)\/>/g)) {
      const g = gem[1];
      const name = attr(g, 'nameSpec');
      if (!name) continue;
      gems.push({
        name,
        level: Number(attr(g, 'level') ?? 20),
        quality: Number(attr(g, 'quality') ?? 0),
        enabled: attr(g, 'enabled') !== 'false',
      });
    }
    if (gems.length > 0) {
      groups.push({ slot: attr(header, 'slot') ?? '—', gems });
    }
  }

  return {
    className: attr(buildTag, 'className') ?? 'Scion',
    ascendancy: attr(buildTag, 'ascendClassName') ?? 'None',
    level: Number(attr(buildTag, 'level') ?? 1),
    mainSocketGroup: Number(attr(buildTag, 'mainSocketGroup') ?? 1),
    treeVersion: attr(specTag, 'treeVersion'),
    groups,
    itemCount: [...xml.matchAll(/<Item\b[^>]*>/g)].length,
  };
}
