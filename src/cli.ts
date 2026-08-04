#!/usr/bin/env node
import { Command } from 'commander';
import { PobEngine } from './pob/bridge.js';
import { loadGemIndex } from './data/gems.js';
import { resolveGoal } from './domain/goals.js';
import { optimizeSupports, type OptimizeResult } from './domain/optimizer.js';
import {
  optimizeTree,
  passivePointsForLevel,
  type TreeOptimizeResult,
} from './domain/treeOptimizer.js';
import { toPobXml } from './pob/buildXml.js';
import { renderReport, renderJson } from './report/render.js';
import { renderImport } from './report/renderImport.js';
import { createTranslator, availableLocales } from './i18n/index.js';
import type { BuildDraft } from './domain/types.js';
import { fetchBuildFromUrlOrCode, summarizeBuildXml } from './pob/importCode.js';
import { auditBuild, snapshot } from './domain/audit.js';
import { loadUniqueIndex } from './data/uniques.js';
import { optimizeGear } from './domain/gearOptimizer.js';
import { createPriceFilter, type BudgetTier } from './domain/budget.js';
import { loadPriceIndex, DEFAULT_LEAGUE, type PriceIndex } from './trade/ninja.js';
import { renderGear } from './report/renderGear.js';
import { loadModIndex } from './data/itemMods.js';
import {
  needsFromStats, buildRareTarget, pickBase, SLOT_TO_BASE_TYPE,
} from './domain/rareBuilder.js';
import { buildTradeSearchUrl } from './trade/searchLink.js';
import { resistanceStatus } from './domain/goals.js';

/** Résultat neutre quand l'optimisation des supports est désactivée. */
function emptySupportResult(): OptimizeResult {
  return {
    chosen: [],
    runnerUps: [],
    baselineScore: 0,
    baselineStats: {},
    finalStats: {},
    evaluations: 0,
  };
}

const program = new Command();

program
  .name('pba')
  .description('PoE Build Architect')
  .version('0.1.0');

program
  .command('optimize', { isDefault: true })
  .argument('<skill>', 'gemme principale')
  .option('-g, --goal <goal>', 'damage | life | tankiness | balanced', 'balanced')
  .option('-c, --class <class>', 'classe', 'Witch')
  .option('-a, --ascendancy <asc>', 'ascendance', 'Occultist')
  .option('-l, --level <n>', 'niveau', '90')
  .option('--links <n>', 'nombre de liens', '6')
  .option('--gem-level <n>', 'niveau des gemmes', '20')
  .option('--gem-quality <n>', 'qualité des gemmes', '20')
  .option('--slot <slot>', 'emplacement', 'Body Armour')
  .option('--locale <locale>', `langue (${availableLocales().join(', ')})`)
  .option('--json', 'sortie JSON')
  .option('--refresh-gems', 'recharge les données de gemmes depuis PoB')
  .option('--no-tree', 'ne pas optimiser l\'arbre de passifs')
  .option('--no-supports', 'ne pas optimiser les gemmes de support')
  .option('--tree-budget <n>', 'points de passif disponibles (défaut : selon le niveau)')
  .option('--tree-max-dist <n>', 'distance max d\'un notable candidat', '12')
  .option('--tree-batch <n>', 'notables alloués par passe', '3')
  .option('--tree-min-gain <pct>', 'gain minimum pour qu\'un notable soit pris', '0.5')
  .action(async (skill: string, opts) => {
    const t = createTranslator(opts.locale);
    const engine = new PobEngine();
    const quiet = Boolean(opts.json);
    const log = (s: string) => { if (!quiet) console.error(s); };

    try {
      log(t('engine.starting'));
      await engine.start();
      const v = await engine.version();
      log(t('engine.ready', { pobVersion: v.pobVersion, treeVersion: v.treeVersion }));

      log(t('engine.loadingGems'));
      const gems = await loadGemIndex(engine, { refresh: Boolean(opts.refreshGems) });
      log(
        t('engine.gemsLoaded', {
          count: gems.all.length,
          actives: gems.actives.length,
          supports: gems.supports.length,
        }),
      );

      const mainGem = gems.find(skill) ?? gems.search(skill)[0];
      if (!mainGem) {
        console.error(t('search.notFound', { query: skill }));
        const suggestions = gems.search(skill.slice(0, 4), 5);
        if (suggestions.length > 0) {
          console.error(t('search.didYouMean'));
          for (const s of suggestions) console.error(`  · ${s.name}`);
        }
        process.exitCode = 1;
        return;
      }
      if (mainGem.support) {
        console.error(t('search.isSupport', { name: mainGem.name }));
        process.exitCode = 1;
        return;
      }

      const goal = resolveGoal(opts.goal);
      const links = Number(opts.links);
      const gemLevel = Number(opts.gemLevel);
      const gemQuality = Number(opts.gemQuality);
      const level = Number(opts.level);

      log('');
      log(t('optimize.running', { skill: mainGem.name, goal: t(`goal.${goal.kind}`) }));

      const baseDraft: BuildDraft = {
        className: opts.class,
        ascendancy: opts.ascendancy,
        level,
        groups: [{ slot: opts.slot, main: { name: mainGem.name, level: gemLevel, quality: gemQuality }, supports: [] }],
      };

      let lastLabel = '';
      const progress = (done: number, total: number, label: string) => {
        if (quiet) return;
        // Réécriture sur place uniquement sur un vrai terminal : redirigée
        // vers un fichier ou un pipe, la barre de progression produirait
        // des milliers de lignes.
        if (process.stderr.isTTY) {
          if (label !== lastLabel) { process.stderr.write('\n'); lastLabel = label; }
          process.stderr.write(`\r  ${t('optimize.progress', { label, done, total })}   `);
        } else if (done === total) {
          process.stderr.write(`  ${t('optimize.progress', { label, done, total })}\n`);
        }
      };

      const result = opts.supports
        ? await optimizeSupports(engine, gems, baseDraft, mainGem, goal, {
            links,
            gemLevel,
            gemQuality,
            onProgress: progress,
          })
        : emptySupportResult();
      if (!quiet) process.stderr.write('\n');

      // L'arbre est optimisé APRÈS les supports, avec le setup de gemmes
      // retenu : le gain d'un notable dépend des supports en place.
      let tree: TreeOptimizeResult | undefined;
      if (opts.tree) {
        const draftWithSupports: BuildDraft = {
          ...baseDraft,
          ascendClassId: 1,
          groups: [
            {
              slot: opts.slot,
              main: { name: mainGem.name, level: gemLevel, quality: gemQuality },
              supports: result.chosen.map((s) => ({
                name: s.gem.name,
                level: gemLevel,
                quality: gemQuality,
              })),
            },
          ],
        };
        const budget = opts.treeBudget
          ? Number(opts.treeBudget)
          : passivePointsForLevel(level);

        log('');
        log(t('optimize.runningTree', { budget }));
        tree = await optimizeTree(engine, toPobXml(draftWithSupports), goal, {
          budget,
          maxDist: Number(opts.treeMaxDist),
          batch: Number(opts.treeBatch),
          minGainPercent: Number(opts.treeMinGain),
          onProgress: progress,
        });
        if (!quiet) process.stderr.write('\n');
      }

      const reportInput = {
        mainGem,
        slot: opts.slot,
        links,
        goal,
        result,
        tree,
        gemLevel,
        gemQuality,
        className: opts.class,
        ascendancy: opts.ascendancy,
        level,
      };

      console.log(opts.json ? renderJson(reportInput) : renderReport(t, reportInput));
    } catch (err) {
      console.error(t('error.generic', { message: (err as Error).message }));
      process.exitCode = 1;
    } finally {
      engine.stop();
    }
  });

program
  .command('import')
  .description('importe un build (code PoB, lien pastebin/pobb.in) et l\'analyse')
  .argument('<source>', 'code PoB, lien pastebin.com ou pobb.in')
  .option('--locale <locale>')
  .option('--json', 'sortie JSON')
  .option('--upgrade', 'chercher aussi des améliorations de gemmes de support')
  .option('-g, --goal <goal>', 'damage | life | tankiness | balanced', 'balanced')
  .action(async (source: string, opts) => {
    const t = createTranslator(opts.locale);
    const engine = new PobEngine();
    const quiet = Boolean(opts.json);
    const log = (s: string) => { if (!quiet) console.error(s); };

    try {
      log(t('import.loading'));
      const xml = await fetchBuildFromUrlOrCode(source);
      const summary = summarizeBuildXml(xml);
      log(
        t('import.loaded', {
          class: summary.className,
          asc: summary.ascendancy,
          level: summary.level,
          groups: summary.groups.length,
          items: summary.itemCount,
        }),
      );
      // Un build exporté sur un ancien arbre ne se compare pas directement
      // aux valeurs de la ligue courante : il faut le dire, pas le masquer.
      if (summary.treeVersion && summary.treeVersion !== '3_29') {
        log(t('import.treeVersionMismatch', { version: summary.treeVersion.replace('_', '.') }));
      }

      await engine.start();
      log(t('import.analysing'));
      const { stats, warnings } = await engine.evaluate(xml);
      for (const w of warnings) log(t('report.warning', { message: w }));

      const findings = auditBuild(stats);
      const snap = snapshot(stats);

      if (opts.json) {
        console.log(JSON.stringify({ summary, snapshot: snap, findings }, null, 2));
        return;
      }

      console.log(renderImport(t, summary, snap, findings));
    } catch (err) {
      console.error(t('error.generic', { message: (err as Error).message }));
      process.exitCode = 1;
    } finally {
      engine.stop();
    }
  });

program
  .command('search')
  .description('cherche une gemme par nom')
  .argument('<query>')
  .option('--locale <locale>')
  .action(async (query: string, opts) => {
    const t = createTranslator(opts.locale);
    const engine = new PobEngine();
    try {
      await engine.start();
      const gems = await loadGemIndex(engine);
      const found = gems.search(query, 20);
      if (found.length === 0) {
        console.error(t('search.notFound', { query }));
        process.exitCode = 1;
        return;
      }
      for (const g of found) {
        const kind = g.support ? 'support' : 'active';
        console.log(`${g.name}  [${kind}]  ${g.tags.join(', ')}`);
      }
    } finally {
      engine.stop();
    }
  });

program
  .command('gear')
  .description('cherche le meilleur équipement unique pour une compétence')
  .argument('<skill>', 'gemme principale')
  .option('-g, --goal <goal>', 'damage | life | tankiness | balanced', 'balanced')
  .option('-c, --class <class>', 'classe', 'Witch')
  .option('-a, --ascendancy <asc>', 'ascendance', 'Occultist')
  .option('-l, --level <n>', 'niveau', '90')
  .option('-b, --budget <tier>', 'leagueStart | comfortable | optimised | mirror', 'comfortable')
  .option('--league <name>', 'ligue poe.ninja', DEFAULT_LEAGUE)
  .option('--slots <list>', 'emplacements, séparés par des virgules')
  .option('--candidates <n>', 'uniques testés par emplacement', '40')
  .option('--locale <locale>')
  .option('--json', 'sortie JSON')
  .action(async (skill: string, opts) => {
    const t = createTranslator(opts.locale);
    const engine = new PobEngine();
    const quiet = Boolean(opts.json);
    const log = (s: string) => { if (!quiet) console.error(s); };

    try {
      log(t('engine.starting'));
      await engine.start();

      log(t('engine.loadingGems'));
      const gems = await loadGemIndex(engine);
      const mainGem = gems.find(skill) ?? gems.search(skill)[0];
      if (!mainGem || mainGem.support) {
        console.error(t('search.notFound', { query: skill }));
        process.exitCode = 1;
        return;
      }

      log(t('gear.loadingUniques'));
      const uniques = await loadUniqueIndex(engine);
      log(t('gear.uniquesLoaded', { count: uniques.all.length }));

      // Les prix sont facultatifs : sans eux on optimise quand même, en le
      // disant clairement plutôt qu'en filtrant sur des données absentes.
      log(t('gear.loadingPrices', { league: opts.league }));
      let prices: PriceIndex | null = null;
      try {
        prices = await loadPriceIndex(opts.league);
      } catch (err) {
        log(t('error.generic', { message: (err as Error).message }));
      }

      const tier = opts.budget as BudgetTier;
      const filter = createPriceFilter(tier, prices);
      const goal = resolveGoal(opts.goal);
      const level = Number(opts.level);

      const base: BuildDraft = {
        className: opts.class,
        ascendancy: opts.ascendancy,
        ascendClassId: 1,
        level,
        groups: [{ slot: 'Body Armour', main: { name: mainGem.name, level: 20, quality: 20 }, supports: [] }],
      };

      let lastLabel = '';
      const result = await optimizeGear(engine, uniques, base, goal, {
        slots: opts.slots ? String(opts.slots).split(',').map((x) => x.trim()) : undefined,
        maxCandidatesPerSlot: Number(opts.candidates),
        priceFilter: filter,
        onProgress: (done, total, label) => {
          if (quiet) return;
          if (process.stderr.isTTY) {
            if (label !== lastLabel) { process.stderr.write('\n'); lastLabel = label; }
            process.stderr.write(`\r  ${t('optimize.progress', { label, done, total })}   `);
          } else if (done === total) {
            process.stderr.write(`  ${t('optimize.progress', { label, done, total })}\n`);
          }
        },
      });
      if (!quiet) process.stderr.write('\n');

      const findings = auditBuild(result.finalStats);
      if (opts.json) {
        console.log(JSON.stringify({
          tier,
          pricesUnavailable: filter.unavailable,
          chosen: result.chosen.map((c) => ({
            slot: c.slot, name: c.item.name, base: c.item.base,
            gainPercent: Number(c.gainPercent.toFixed(2)), price: c.price,
          })),
          emptySlots: result.emptySlots,
          snapshot: snapshot(result.finalStats),
          findings,
          evaluations: result.evaluations,
        }, null, 2));
        return;
      }

      console.log(renderGear(t, {
        result,
        tier,
        pricesUnavailable: filter.unavailable,
        testedPerSlot: Number(opts.candidates),
        findings,
      }));
    } catch (err) {
      console.error(t('error.generic', { message: (err as Error).message }));
      process.exitCode = 1;
    } finally {
      engine.stop();
    }
  });

program
  .command('rares')
  .description('génère les objets rares à viser pour capper les résistances')
  .argument('<skill>', 'gemme principale')
  .option('-c, --class <class>', 'classe', 'Witch')
  .option('-a, --ascendancy <asc>', 'ascendance', 'Occultist')
  .option('-l, --level <n>', 'niveau', '90')
  .option('--item-level <n>', 'niveau des objets visés', '86')
  .option('--defence <kind>', 'EnergyShield | Armour | Evasion', 'EnergyShield')
  .option('--league <name>', 'ligue pour les liens de trade', DEFAULT_LEAGUE)
  .option('--min-roll <pct>', 'valeur minimale cherchée, en % du max', '70')
  .option('--locale <locale>')
  .option('--json', 'sortie JSON')
  .action(async (skill: string, opts) => {
    const t = createTranslator(opts.locale);
    const engine = new PobEngine();
    const quiet = Boolean(opts.json);
    const log = (s: string) => { if (!quiet) console.error(s); };

    try {
      await engine.start();
      const gems = await loadGemIndex(engine);
      const mainGem = gems.find(skill) ?? gems.search(skill)[0];
      if (!mainGem || mainGem.support) {
        console.error(t('search.notFound', { query: skill }));
        process.exitCode = 1;
        return;
      }

      log(t('rare.loadingMods'));
      const idx = await loadModIndex(engine);
      log(t('rare.modsLoaded', { mods: idx.mods.length, bases: idx.bases.length }));
      log(t('rare.running'));

      const draft: BuildDraft = {
        className: opts.class,
        ascendancy: opts.ascendancy,
        ascendClassId: 1,
        level: Number(opts.level),
        groups: [{ slot: 'Body Armour', main: { name: mainGem.name, level: 20, quality: 20 }, supports: [] }],
        items: [],
      };

      let stats = (await engine.evaluate(toPobXml(draft))).stats;
      const before = resistanceStatus(stats);
      const targets: Array<{ slot: string; base: string; affixes: string[]; url: string }> = [];

      // Les emplacements sont traités en séquence : chaque objet est équipé
      // avant de calculer les besoins du suivant, sinon on demanderait huit
      // fois les mêmes résistances.
      for (const slot of Object.keys(SLOT_TO_BASE_TYPE)) {
        const base = pickBase(idx, SLOT_TO_BASE_TYPE[slot], opts.defence, Number(opts.level));
        if (!base) continue;

        const needs = needsFromStats(stats);
        const target = buildRareTarget(idx, slot, base, needs, {
          itemLevel: Number(opts.itemLevel),
        });
        const mods = [...target.prefixes, ...target.suffixes];
        if (mods.length === 0) continue;

        draft.items!.push({ slot, raw: target.raw });
        stats = (await engine.evaluate(toPobXml(draft))).stats;

        targets.push({
          slot,
          base: base.name,
          affixes: mods.flatMap((m) => m.stats.map((x) => x.replace(/\((\d+)-(\d+)\)/g, '$2'))),
          url: buildTradeSearchUrl(mods, base, {
            league: opts.league,
            minRollRatio: Number(opts.minRoll) / 100,
          }),
        });
      }

      const after = resistanceStatus(stats);
      const findings = auditBuild(stats);

      if (opts.json) {
        console.log(JSON.stringify({ targets, before, after, findings }, null, 2));
        return;
      }

      const out: string[] = ['', `\x1b[1m\x1b[36m━━━ ${t('rare.title')} ━━━\x1b[0m`, ''];
      for (const tg of targets) {
        out.push(`  \x1b[1m${t('rare.slot', { slot: tg.slot, base: tg.base })}\x1b[0m`);
        for (const a of tg.affixes) out.push(`      \x1b[2m${a}\x1b[0m`);
        out.push(`      \x1b[36m${tg.url}\x1b[0m`);
        out.push('');
      }
      out.push(
        `  ${t('stat.FireResist')} ${before.fire} → \x1b[32m${after.fire}\x1b[0m` +
        `   ${t('stat.ColdResist')} ${before.cold} → \x1b[32m${after.cold}\x1b[0m` +
        `   ${t('stat.LightningResist')} ${before.lightning} → \x1b[32m${after.lightning}\x1b[0m` +
        `   ${t('stat.ChaosResist')} ${before.chaos} → ${after.chaos}`,
      );
      out.push('');
      for (const f of findings) {
        const ic = f.severity === 'critical' ? '\x1b[31m✗' : f.severity === 'warning' ? '\x1b[33m!' : '\x1b[32m✓';
        out.push(`  ${ic}\x1b[0m ${t(f.key, f.params)}`);
      }
      out.push('', `  \x1b[2m${t('rare.notASimulator')}\x1b[0m`);
      out.push(`  \x1b[2m${t('rare.rollNote', { ratio: opts.minRoll })}\x1b[0m`, '');
      console.log(out.join('\n'));
    } catch (err) {
      console.error(t('error.generic', { message: (err as Error).message }));
      process.exitCode = 1;
    } finally {
      engine.stop();
    }
  });

program
  .command('serve')
  .description('lance l\'interface web')
  .option('-p, --port <n>', 'port', '5173')
  .action(async (opts) => {
    const { startServer } = await import('./server/index.js');
    await startServer(Number(opts.port));
  });

program
  .command('doctor')
  .description('vérifie l\'installation du moteur PoB')
  .action(async () => {
    const t = createTranslator();
    const engine = new PobEngine();
    try {
      await engine.start();
      const v = await engine.version();
      console.log(t('engine.ready', { pobVersion: v.pobVersion, treeVersion: v.treeVersion }));
      const gems = await loadGemIndex(engine, { refresh: true });
      console.log(
        t('engine.gemsLoaded', {
          count: gems.all.length,
          actives: gems.actives.length,
          supports: gems.supports.length,
        }),
      );
    } catch (err) {
      console.error(t('error.generic', { message: (err as Error).message }));
      process.exitCode = 1;
    } finally {
      engine.stop();
    }
  });

program.parseAsync(process.argv);
