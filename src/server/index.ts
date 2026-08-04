import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PobEngine, PROJECT_ROOT } from '../pob/bridge.js';
import { loadGemIndex, type GemIndex } from '../data/gems.js';
import { resolveGoal } from '../domain/goals.js';
import { optimizeSupports } from '../domain/optimizer.js';
import { optimizeTree, passivePointsForLevel } from '../domain/treeOptimizer.js';
import { toPobXml } from '../pob/buildXml.js';
import { fetchBuildFromUrlOrCode, summarizeBuildXml } from '../pob/importCode.js';
import { auditBuild, snapshot } from '../domain/audit.js';
import { availableLocales } from '../i18n/index.js';
import type { BuildDraft } from '../domain/types.js';

const WEB_DIR = path.join(PROJECT_ROOT, 'src', 'server', 'public');

/**
 * Serveur local de l'interface web.
 *
 * Le moteur PoB est démarré une seule fois et partagé par toutes les
 * requêtes : son initialisation coûte plusieurs secondes, et les
 * optimisations enchaînent des centaines d'évaluations.
 *
 * Les optimisations étant longues, les endpoints diffusent leur progression
 * en Server-Sent Events plutôt que de laisser le navigateur attendre sans
 * rien afficher.
 */
export async function startServer(port: number): Promise<void> {
  const engine = new PobEngine();
  await engine.start();
  const gems = await loadGemIndex(engine);

  // Une seule instance du moteur : les requêtes concurrentes sont
  // sérialisées pour éviter d'entrelacer deux optimisations sur le même
  // processus Lua.
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const server = createServer((req, res) => {
    handle(req, res, engine, gems, serialize).catch((err) => {
      sendJson(res, 500, { error: (err as Error).message });
    });
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(`\n  PoE Build Architect — http://localhost:${port}\n`);
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  engine: PobEngine,
  gems: GemIndex,
  serialize: <T>(fn: () => Promise<T>) => Promise<T>,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  if (url.pathname === '/') return serveFile(res, 'index.html', 'text/html; charset=utf-8');
  if (url.pathname === '/app.js') return serveFile(res, 'app.js', 'text/javascript; charset=utf-8');
  if (url.pathname === '/style.css') return serveFile(res, 'style.css', 'text/css; charset=utf-8');

  if (url.pathname === '/api/meta') {
    return sendJson(res, 200, {
      locales: availableLocales(),
      version: await engine.version(),
      gemCount: gems.all.length,
      skills: gems.actives
        .map((g) => g.name)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 2000),
    });
  }

  if (url.pathname === '/api/messages') {
    const locale = url.searchParams.get('locale') ?? 'fr';
    // Les traductions sont servies au navigateur : aucun texte d'interface
    // n'est écrit en dur côté client.
    const safe = availableLocales().includes(locale) ? locale : 'fr';
    const file = path.join(PROJECT_ROOT, 'src', 'i18n', 'locales', `${safe}.json`);
    return sendJson(res, 200, JSON.parse(await readFile(file, 'utf8')));
  }

  if (url.pathname === '/api/import' && req.method === 'POST') {
    const body = await readBody(req);
    const xml = await fetchBuildFromUrlOrCode(body.source ?? '');
    const summary = summarizeBuildXml(xml);
    const { stats } = await serialize(() => engine.evaluate(xml));
    return sendJson(res, 200, {
      summary,
      snapshot: snapshot(stats),
      findings: auditBuild(stats),
    });
  }

  if (url.pathname === '/api/optimize') {
    return streamOptimize(url, res, engine, gems, serialize);
  }

  res.writeHead(404).end('Not found');
}

/** Optimisation diffusée en Server-Sent Events (progression + résultat). */
async function streamOptimize(
  url: URL,
  res: ServerResponse,
  engine: PobEngine,
  gems: GemIndex,
  serialize: <T>(fn: () => Promise<T>) => Promise<T>,
): Promise<void> {
  const p = url.searchParams;
  const skillName = p.get('skill') ?? '';
  const mainGem = gems.find(skillName) ?? gems.search(skillName)[0];

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  if (!mainGem) {
    send('error', { key: 'search.notFound', params: { query: skillName } });
    res.end();
    return;
  }

  try {
    await serialize(async () => {
      const goal = resolveGoal(p.get('goal') ?? 'balanced');
      const links = Number(p.get('links') ?? 6);
      const level = Number(p.get('level') ?? 90);
      const gemLevel = Number(p.get('gemLevel') ?? 20);
      const gemQuality = Number(p.get('gemQuality') ?? 20);
      const slot = p.get('slot') ?? 'Body Armour';
      const className = p.get('class') ?? 'Witch';
      const ascendancy = p.get('ascendancy') ?? 'Occultist';
      const withTree = p.get('tree') !== 'false';
      const treeBudget = Number(p.get('treeBudget') ?? passivePointsForLevel(level));

      const base: BuildDraft = {
        className,
        ascendancy,
        level,
        groups: [{ slot, main: { name: mainGem.name, level: gemLevel, quality: gemQuality }, supports: [] }],
      };

      send('phase', { phase: 'supports' });
      const supports = await optimizeSupports(engine, gems, base, mainGem, goal, {
        links,
        gemLevel,
        gemQuality,
        onProgress: (done, total, label) => send('progress', { done, total, label }),
      });
      send('supports', {
        main: { name: mainGem.name, level: gemLevel, quality: gemQuality },
        slot,
        links,
        chosen: supports.chosen.map((s) => ({
          name: s.gem.name,
          gainPercent: Number(s.deltaPercent.toFixed(1)),
        })),
        runnerUps: supports.runnerUps.slice(0, 6).map((s) => ({
          name: s.gem.name,
          gainPercent: Number(s.deltaPercent.toFixed(1)),
        })),
        before: snapshot(supports.baselineStats),
        after: snapshot(supports.finalStats),
      });

      if (!withTree) return;

      send('phase', { phase: 'tree' });
      const draft: BuildDraft = {
        ...base,
        ascendClassId: 1,
        groups: [
          {
            slot,
            main: { name: mainGem.name, level: gemLevel, quality: gemQuality },
            supports: supports.chosen.map((s) => ({ name: s.gem.name, level: gemLevel, quality: gemQuality })),
          },
        ],
      };
      const tree = await optimizeTree(engine, toPobXml(draft), goal, {
        budget: treeBudget,
        maxDist: Number(p.get('treeMaxDist') ?? 12),
        batch: Number(p.get('treeBatch') ?? 3),
        onProgress: (done, total, label) => send('progress', { done, total, label }),
      });

      send('tree', {
        pointsUsed: tree.pointsUsed,
        ascPointsUsed: tree.ascPointsUsed,
        budget: treeBudget,
        url: tree.url,
        nodes: tree.chosen.map((c) => ({
          name: c.node.name,
          type: c.node.type,
          ascendancy: c.node.ascendancy,
          cost: c.cost,
          gainPercent: Number(c.gainPercent.toFixed(1)),
          stats: c.node.stats.slice(0, 2),
        })),
        before: snapshot(tree.baselineStats),
        after: snapshot(tree.finalStats),
        findings: auditBuild(tree.finalStats),
      });
    });
    send('done', {});
  } catch (err) {
    send('error', { message: (err as Error).message });
  }
  res.end();
}

async function serveFile(res: ServerResponse, name: string, type: string): Promise<void> {
  try {
    const content = await readFile(path.join(WEB_DIR, name));
    res.writeHead(200, { 'Content-Type': type }).end(content);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
