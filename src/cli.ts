#!/usr/bin/env node
import { Command } from 'commander';
import { PobEngine } from './pob/bridge.js';
import { loadGemIndex } from './data/gems.js';
import { resolveGoal } from './domain/goals.js';
import { optimizeSupports } from './domain/optimizer.js';
import { renderReport, renderJson } from './report/render.js';
import { createTranslator, availableLocales } from './i18n/index.js';
import type { BuildDraft } from './domain/types.js';

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
      const result = await optimizeSupports(engine, gems, baseDraft, mainGem, goal, {
        links,
        gemLevel,
        gemQuality,
        onProgress: (done, total, label) => {
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
        },
      });
      if (!quiet) process.stderr.write('\n');

      const reportInput = {
        mainGem,
        slot: opts.slot,
        links,
        goal,
        result,
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
