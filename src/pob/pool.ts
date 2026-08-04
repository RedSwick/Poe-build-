import { cpus } from 'node:os';
import { PobEngine, type EvalResult, type TreeAllocResult, type MasterySelection } from './bridge.js';

/**
 * Pool de moteurs Path of Building tournant en parallèle.
 *
 * Une évaluation coûte de 0,5 à 1,3 seconde, et une recherche sérieuse en
 * demande des dizaines de milliers : le débit est la contrainte qui limite
 * tout le reste. Chaque moteur étant un processus LuaJIT indépendant, les
 * faire tourner en parallèle multiplie ce débit par le nombre de cœurs.
 *
 * L'interface reproduit celle de `PobEngine` pour rester interchangeable.
 */
export class PobPool {
  private engines: PobEngine[] = [];
  /** Nombre de requêtes en vol par moteur, pour router vers le moins chargé. */
  private load: number[] = [];

  constructor(public readonly size = defaultPoolSize()) {}

  async start(onProgress?: (ready: number, total: number) => void): Promise<void> {
    // Les moteurs démarrent en parallèle : l'initialisation de PoB coûte
    // plusieurs secondes chacune, les enchaîner serait inutilement long.
    const starts = Array.from({ length: this.size }, async (_, i) => {
      const engine = new PobEngine();
      await engine.start();
      this.engines[i] = engine;
      this.load[i] = 0;
      onProgress?.(this.engines.filter(Boolean).length, this.size);
    });
    await Promise.all(starts);
  }

  /** Moteur le moins sollicité à cet instant. */
  private pick(): number {
    let best = 0;
    for (let i = 1; i < this.load.length; i++) {
      if (this.load[i] < this.load[best]) best = i;
    }
    return best;
  }

  private async run<T>(fn: (engine: PobEngine) => Promise<T>): Promise<T> {
    const i = this.pick();
    this.load[i]++;
    try {
      return await fn(this.engines[i]);
    } finally {
      this.load[i]--;
    }
  }

  evaluate(xml: string, stats?: string[], opts?: { fullDps?: boolean }): Promise<EvalResult> {
    return this.run((e) => e.evaluate(xml, stats, opts));
  }

  treeAlloc(
    xml: string,
    targets: number[],
    masteries: MasterySelection[] = [],
    stats?: string[],
  ): Promise<TreeAllocResult> {
    return this.run((e) => e.treeAlloc(xml, targets, masteries, stats));
  }

  treeCandidates(xml: string) {
    return this.run((e) => e.treeCandidates(xml));
  }

  gems<T>() {
    return this.run((e) => e.gems<T>());
  }

  uniques(types?: string[]) {
    return this.run((e) => e.uniques(types));
  }

  itemInfo(raw: string) {
    return this.run((e) => e.itemInfo(raw));
  }

  calcBatch(...args: Parameters<PobEngine['calcBatch']>) {
    return this.run((e) => e.calcBatch(...args));
  }

  itemMods() {
    return this.run((e) => e.itemMods());
  }

  version() {
    return this.run((e) => e.version());
  }

  /**
   * Exécute une série de tâches en saturant le pool.
   *
   * Chaque moteur reçoit une nouvelle tâche dès qu'il se libère, plutôt que
   * de découper le travail en lots figés : une tâche lente ne bloque donc
   * pas les autres moteurs.
   */
  async map<In, Out>(
    inputs: In[],
    task: (input: In, index: number) => Promise<Out>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Out[]> {
    const results: Out[] = new Array(inputs.length);
    let next = 0;
    let done = 0;

    const worker = async () => {
      while (true) {
        const i = next++;
        if (i >= inputs.length) return;
        results[i] = await task(inputs[i], i);
        onProgress?.(++done, inputs.length);
      }
    };

    await Promise.all(Array.from({ length: this.size }, worker));
    return results;
  }

  stop(): void {
    for (const e of this.engines) e?.stop();
    this.engines = [];
    this.load = [];
  }
}

/**
 * Taille de pool par défaut.
 *
 * On laisse un cœur libre pour Node et le système : saturer toutes les
 * unités ralentit l'ensemble sans rien gagner.
 */
export function defaultPoolSize(): number {
  const n = cpus()?.length ?? 2;
  return Math.max(1, Math.min(n - 1, 12));
}
