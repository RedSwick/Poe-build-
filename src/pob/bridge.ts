import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SENTINEL = '@@PBA@@';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Racine du projet, que l'on tourne depuis src/ (tsx) ou dist/ (compilé). */
export const PROJECT_ROOT = path.resolve(here, '..', '..');
export const POB_ROOT = path.join(PROJECT_ROOT, 'vendor', 'PathOfBuilding');
export const POB_SRC = path.join(POB_ROOT, 'src');

export interface PobStats {
  [key: string]: number | boolean;
}

export interface EvalResult {
  stats: PobStats;
  warnings: string[];
}

/** Nœud d'arbre de passifs, tel qu'exposé par PoB. */
export interface TreeNodeInfo {
  id: number;
  name: string;
  type: 'Notable' | 'Keystone' | 'Mastery';
  ascendancy?: string;
  /** Points nécessaires pour l'atteindre depuis l'arbre actuel. */
  pathDist?: number;
  alloc: boolean;
  /** Texte des effets du nœud, tel qu'affiché en jeu. */
  stats: string[];
}

/** Une mastery et les effets qu'elle propose au choix. */
export interface MasteryInfo {
  id: number;
  name: string;
  pathDist?: number;
  alloc: boolean;
  effects: Array<{ id: number; stats: string[] }>;
}

/** Couple (nœud de mastery, effet choisi). */
export type MasterySelection = [nodeId: number, effectId: number];

export interface TreeAllocResult {
  stats: PobStats;
  /** Points de passif consommés (hors ascendance). */
  pointsUsed: number;
  ascPointsUsed: number;
  allocated: number[];
  masterySelections: MasterySelection[];
  missing: number[];
  /** Lien pathofexile.com vers l'arbre obtenu. */
  url: string;
}

interface Pending {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
}

/**
 * Pilote un processus LuaJIT persistant exécutant le vrai moteur de calcul
 * de Path of Building.
 *
 * On ne réimplémente aucune formule de dégâts ou de défense : PoB est la
 * source de vérité, on lui envoie du XML de build et on lit ses sorties.
 */
export class PobEngine {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rl: Interface | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private readyPromise: Promise<void> | null = null;
  private stderrTail: string[] = [];

  /** Démarre le moteur et attend la fin de son initialisation. */
  async start(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise<void>((resolve, reject) => {
      if (!existsSync(POB_SRC)) {
        reject(
          new Error(
            `Path of Building introuvable dans ${POB_ROOT}.\n` +
              `Lance d'abord : npm run setup`,
          ),
        );
        return;
      }

      const enginePath = path.join(PROJECT_ROOT, 'src', 'pob', 'engine.lua');
      if (!existsSync(enginePath)) {
        reject(new Error(`Script moteur introuvable : ${enginePath}`));
        return;
      }

      // PoB doit impérativement tourner avec cwd = son propre src/ : il
      // charge ses données par chemins relatifs.
      this.proc = spawn('luajit', [enginePath], {
        cwd: POB_SRC,
        env: {
          ...process.env,
          LUA_PATH: [
            path.join(POB_ROOT, 'runtime', 'lua', '?.lua'),
            path.join(POB_ROOT, 'runtime', 'lua', '?', 'init.lua'),
            './?.lua',
            '',
          ].join(';'),
          LUA_CPATH: '/usr/local/lib/lua/5.1/?.so;;',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.proc.on('error', (err) => {
        reject(
          new Error(
            `Impossible de lancer luajit : ${err.message}\n` +
              `Installe-le avec : sudo apt-get install luajit`,
          ),
        );
      });

      this.proc.stderr.on('data', (chunk: Buffer) => {
        // On garde une fenêtre glissante de stderr pour diagnostiquer un
        // crash sans noyer la mémoire sur une longue session.
        this.stderrTail.push(chunk.toString());
        if (this.stderrTail.length > 50) this.stderrTail.shift();
      });

      this.proc.on('exit', (code) => {
        const err = new Error(
          `Le moteur PoB s'est arrêté (code ${code}).\n${this.stderrTail.join('')}`,
        );
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
        this.proc = null;
      });

      this.rl = createInterface({ input: this.proc.stdout });
      this.rl.on('line', (line: string) => {
        // PoB écrit son propre journal sur stdout : on ne traite que les
        // lignes portant notre sentinel.
        const at = line.indexOf(SENTINEL);
        if (at === -1) return;

        let msg: any;
        try {
          msg = JSON.parse(line.slice(at + SENTINEL.length));
        } catch {
          return;
        }

        if (msg.ready) {
          resolve();
          return;
        }

        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);

        if (msg.ok) p.resolve(msg);
        else p.reject(new Error(msg.error ?? 'erreur inconnue du moteur PoB'));
      });
    });

    return this.readyPromise;
  }

  private request<T>(payload: Record<string, unknown>): Promise<T> {
    if (!this.proc) {
      return Promise.reject(new Error('Le moteur PoB n\'est pas démarré'));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc!.stdin.write(JSON.stringify({ ...payload, id }) + '\n');
    });
  }

  async ping(): Promise<boolean> {
    const r = await this.request<{ pong: boolean }>({ action: 'ping' });
    return r.pong === true;
  }

  /** Version de PoB et version de l'arbre de passifs actuellement chargée. */
  async version(): Promise<{ pobVersion: string; treeVersion: string }> {
    return this.request({ action: 'version' });
  }

  /** Liste les notables et mots-clés allouables pour un build. */
  async treeCandidates(xml: string): Promise<{
    candidates: TreeNodeInfo[];
    masteries: MasteryInfo[];
    pointsUsed: number;
    ascPointsUsed: number;
  }> {
    return this.request({ action: 'tree_candidates', xml });
  }

  /**
   * Alloue des nœuds cibles et recalcule le build.
   *
   * PoB alloue lui-même les nœuds de chemin menant à chaque cible : le coût
   * réel en points est donc `pointsUsed`, pas le nombre de cibles.
   */
  async treeAlloc(
    xml: string,
    targets: number[],
    masteries: MasterySelection[] = [],
    stats?: string[],
  ): Promise<TreeAllocResult> {
    return this.request({ action: 'tree_alloc', xml, targets, masteries, stats });
  }

  /** Exporte les objets uniques connus de PoB, groupés par type de base. */
  async uniques(types?: string[]): Promise<{
    uniques: Record<string, Array<{ name: string; base: string; raw: string; variants: number }>>;
  }> {
    return this.request({ action: 'uniques', types });
  }

  /**
   * Évalue plusieurs variantes d'un même build en un seul aller-retour.
   *
   * Utilise le calculateur incrémental de PoB : une passe de base, puis
   * chaque candidat ne rejoue que le calcul. `treeAlloc` recharge le XML à
   * chaque appel, ce qui refait l'analyse complète du build pour rien.
   */
  async calcBatch(
    xml: string,
    candidates: Array<{
      addNodes?: number[];
      removeNodes?: number[];
      masteries?: MasterySelection[];
    }>,
    stats?: string[],
    options: { withPath?: boolean } = {},
  ): Promise<{
    base: Record<string, number | boolean>;
    results: Array<{
      stats?: Record<string, number | boolean>;
      /** Points dépensés, chemin compris. */
      cost?: number;
      error?: string;
    }>;
  }> {
    return this.request({
      action: 'calc_batch',
      xml,
      candidates,
      stats,
      withPath: options.withPath !== false,
    });
  }

  /**
   * Identifie un objet depuis son texte copier-coller.
   *
   * C'est PoB qui lit la base et en déduit le type : maintenir une table des
   * bases du jeu de notre côté ferait doublon avec la sienne.
   */
  async itemInfo(raw: string): Promise<{
    name: string; base: string; type: string; rarity: string;
  }> {
    return this.request({ action: 'item_info', raw });
  }

  /** Exporte le pool de mods explicites et les bases d'objets. */
  async itemMods(): Promise<{ mods: any[]; bases: any[] }> {
    return this.request({ action: 'item_mods' });
  }

  /** Exporte l'index des gemmes tel que chargé par PoB. */
  async gems<T>(): Promise<{ gems: T[] }> {
    return this.request({ action: 'gems' });
  }

  /** Calcule les stats d'un build décrit en XML PoB. */
  async evaluate(
    xml: string,
    stats?: string[],
    opts: { fullDps?: boolean } = {},
  ): Promise<EvalResult> {
    const r = await this.request<{ stats: PobStats; warnings: string[] }>({
      action: 'eval',
      xml,
      stats,
      fullDps: opts.fullDps ?? true,
    });
    return { stats: r.stats ?? {}, warnings: r.warnings ?? [] };
  }

  stop(): void {
    this.rl?.close();
    this.proc?.stdin.end();
    this.proc?.kill();
    this.proc = null;
    this.readyPromise = null;
  }
}
