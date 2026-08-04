#!/usr/bin/env node
import { Command } from 'commander';
import { PobEngine } from './pob/bridge.js';
import { loadGemIndex } from './data/gems.js';
import { resolveGoal } from './domain/goals.js';
import { optimizeSupports, type OptimizeResult } from './domain/optimizer.js';
import { optimizeAuras, type AuraOptimizeResult } from './domain/auraOptimizer.js';
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
import { addToCorpus, loadCorpus, readSourceList } from './corpus/store.js';
import { validateCorpus, DEVIATION_THRESHOLD } from './corpus/validate.js';
import { computePriors } from './corpus/priors.js';
import { PobPool } from './pob/pool.js';
import { DEFAULT_COMBAT, toConfigInputs, parseEnemy, describeCombat, type CombatConfig } from './domain/config.js';

/** Options de conditions de combat, communes à plusieurs commandes. */
function combatFromOpts(opts: any): CombatConfig {
  return {
    ...DEFAULT_COMBAT,
    enemy: parseEnemy(opts.enemy),
    enemyLevel: opts.enemyLevel ? Number(opts.enemyLevel) : undefined,
    powerCharges: Boolean(opts.powerCharges),
    frenzyCharges: Boolean(opts.frenzyCharges),
    enduranceCharges: Boolean(opts.enduranceCharges),
    enemyCursed: Boolean(opts.enemyCursed),
  };
}

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
  .option('--auras', 'chercher aussi les meilleures auras')
  .option('--max-auras <n>', 'nombre maximum d\'auras', '4')
  .option('--refine', 'repasser sur les supports une fois l\'arbre choisi')
  .option('--use-corpus', 'ordonner les candidats selon le corpus de builds réels')
  .option('--max-candidates <n>', 'plafond de supports testés (avec --use-corpus)')
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

      const combat = combatFromOpts(opts);
      log(t('config.using', { config: describeCombat(combat) }));

      const baseDraft: BuildDraft = {
        className: opts.class,
        ascendancy: opts.ascendancy,
        level,
        config: toConfigInputs(combat),
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

      // Les a priori du corpus n'écartent rien : ils décident seulement de
      // l'ordre de test. Combinés à un plafond, ils permettent d'explorer
      // d'abord ce que les vrais builds utilisent.
      let priorOrder: Array<{ name: string; count: number }> | undefined;
      if (opts.useCorpus) {
        const entries = loadCorpus();
        if (entries.length === 0) {
          log(t('corpus.empty'));
        } else {
          const priors = computePriors(entries);
          priorOrder = priors.supportsBySkill.get(mainGem.name);
          log(
            priorOrder?.length
              ? t('corpus.priorUsed', { n: priorOrder.length, skill: mainGem.name, builds: priors.sampleSize })
              : t('corpus.priorMissing', { skill: mainGem.name }),
          );
        }
      }

      const result = opts.supports
        ? await optimizeSupports(engine, gems, baseDraft, mainGem, goal, {
            links,
            gemLevel,
            gemQuality,
            priorOrder,
            maxCandidates: opts.maxCandidates ? Number(opts.maxCandidates) : undefined,
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

      // Les auras se logent dans leurs propres groupes de liens, avec
      // l'arbre déjà alloué : leur coût en réservation dépend de la mana
      // que l'arbre a apportée.
      let auras: AuraOptimizeResult | undefined;
      if (opts.auras) {
        const draftForAuras: BuildDraft = {
          ...baseDraft,
          ascendClassId: 1,
          treeNodes: tree?.allocated,
          groups: [
            {
              slot: opts.slot,
              main: { name: mainGem.name, level: gemLevel, quality: gemQuality },
              supports: result.chosen.map((s) => ({ name: s.gem.name, level: gemLevel, quality: gemQuality })),
            },
          ],
        };
        log('');
        log(t('aura.running'));
        auras = await optimizeAuras(engine, gems, draftForAuras, goal, {
          maxAuras: Number(opts.maxAuras),
          gemLevel,
          gemQuality,
          onProgress: progress,
        });
        if (!quiet) process.stderr.write('\n');
      }

      // Si des auras ont été rejetées faute de mana, on relance l'arbre AVEC
      // ces auras posées. Le score pénalise alors la mana insuffisante, si
      // bien que les nœuds de réservation et de mana deviennent les plus
      // rentables — l'optimiseur cherche de lui-même à débloquer l'aura, au
      // lieu de constater qu'elle ne rentre pas.
      if (opts.auras && auras && auras.rejectedForReservation.length > 0 && tree) {
        const blocked = auras.rejectedForReservation
          .map((n) => gems.find(n))
          .filter((g): g is NonNullable<typeof g> => Boolean(g))
          .slice(0, 2);

        if (blocked.length > 0) {
          log('');
          log(t('aura.unblocking', { list: blocked.map((b) => b.name).join(', ') }));
          const draftBlocked: BuildDraft = {
            ...baseDraft,
            ascendClassId: 1,
            groups: [
              {
                slot: opts.slot,
                main: { name: mainGem.name, level: gemLevel, quality: gemQuality },
                supports: result.chosen.map((s) => ({ name: s.gem.name, level: gemLevel, quality: gemQuality })),
              },
              ...auras.chosen.map((a, i) => ({
                slot: (['Helmet', 'Gloves', 'Boots', 'Weapon 2'] as const)[i % 4],
                main: { name: a.gem.name, level: gemLevel, quality: gemQuality },
                supports: [],
              })),
              ...blocked.map((b) => ({
                slot: 'Weapon 2',
                main: { name: b.name, level: gemLevel, quality: gemQuality },
                supports: [],
              })),
            ],
            mainGroupIndex: 0,
          };
          tree = await optimizeTree(engine, toPobXml(draftBlocked), goal, {
            budget: opts.treeBudget ? Number(opts.treeBudget) : passivePointsForLevel(level),
            maxDist: Number(opts.treeMaxDist),
            batch: Number(opts.treeBatch),
            minGainPercent: Number(opts.treeMinGain),
            onProgress: progress,
          });
          if (!quiet) process.stderr.write('\n');
        }
      }

      // Seconde passe sur les supports : le meilleur support dépend de
      // l'arbre et des auras en place. Le classement obtenu sur un
      // personnage nu n'est pas forcément celui du build final.
      let refined: OptimizeResult | undefined;
      if (opts.refine && opts.supports && tree) {
        const draftRefine: BuildDraft = {
          ...baseDraft,
          ascendClassId: 1,
          treeNodes: tree.allocated,
          groups: [
            { slot: opts.slot, main: { name: mainGem.name, level: gemLevel, quality: gemQuality }, supports: [] },
            ...(auras?.chosen ?? []).map((a, i) => ({
              slot: (['Helmet', 'Gloves', 'Boots', 'Weapon 2'] as const)[i % 4],
              main: { name: a.gem.name, level: gemLevel, quality: gemQuality },
              supports: [],
            })),
          ],
          mainGroupIndex: 0,
        };
        log('');
        log(t('optimize.refining'));
        refined = await optimizeSupports(engine, gems, draftRefine, mainGem, goal, {
          links, gemLevel, gemQuality, onProgress: progress,
        });
        if (!quiet) process.stderr.write('\n');
      }

      const reportInput = {
        mainGem,
        slot: opts.slot,
        links,
        goal,
        result: refined ?? result,
        auras,
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
  .option('--enemy <kind>', 'none | boss | pinnacle | uber', 'pinnacle')
  .option('--enemy-level <n>', 'niveau de l\'ennemi')
  .option('--power-charges', 'compter les charges de pouvoir')
  .option('--frenzy-charges', 'compter les charges de frénésie')
  .option('--endurance-charges', 'compter les charges d\'endurance')
  .option('--enemy-cursed', 'considérer l\'ennemi comme maudit')
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

      const combat = combatFromOpts(opts);
      log(t('config.using', { config: describeCombat(combat) }));

      const base: BuildDraft = {
        className: opts.class,
        ascendancy: opts.ascendancy,
        ascendClassId: 1,
        level,
        config: toConfigInputs(combat),
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
  .option('--enemy <kind>', 'none | boss | pinnacle | uber', 'pinnacle')
  .option('--enemy-level <n>', 'niveau de l\'ennemi')
  .option('--power-charges', 'compter les charges de pouvoir')
  .option('--frenzy-charges', 'compter les charges de frénésie')
  .option('--endurance-charges', 'compter les charges d\'endurance')
  .option('--enemy-cursed', 'considérer l\'ennemi comme maudit')
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

      const combat = combatFromOpts(opts);
      log(t('config.using', { config: describeCombat(combat) }));

      const draft: BuildDraft = {
        className: opts.class,
        ascendancy: opts.ascendancy,
        ascendClassId: 1,
        level: Number(opts.level),
        config: toConfigInputs(combat),
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

const corpus = program.command('corpus').description('constitue et exploite un corpus de builds réels');

corpus
  .command('add')
  .description('ajoute un ou plusieurs builds (lien pobb.in/pastebin, code, ou fichier de liens)')
  .argument('[sources...]', 'liens ou codes')
  .option('-f, --file <path>', 'fichier contenant un lien par ligne')
  .action(async (sources: string[], opts) => {
    const t = createTranslator();
    const list = [...(sources ?? []), ...(opts.file ? readSourceList(opts.file) : [])];
    if (list.length === 0) {
      console.error(t('corpus.noSource'));
      process.exitCode = 1;
      return;
    }

    let added = 0, updated = 0, failed = 0;
    for (const [i, src] of list.entries()) {
      const label = src.length > 60 ? src.slice(0, 57) + '…' : src;
      try {
        const { entry, isNew } = await addToCorpus(src);
        isNew ? added++ : updated++;
        console.log(
          `[${i + 1}/${list.length}] ${isNew ? '+' : '~'} ${entry.summary.className}/${entry.summary.ascendancy} ` +
          `niv ${entry.summary.level} — ${entry.summary.groups.length} groupes, ${Object.keys(entry.authorStats).length} stats de référence`,
        );
      } catch (err) {
        failed++;
        console.error(`[${i + 1}/${list.length}] ✗ ${label} — ${(err as Error).message}`);
      }
    }
    console.log(t('corpus.addDone', { added, updated, failed, total: loadCorpus().length }));
  });

corpus
  .command('validate')
  .description('compare nos calculs aux stats stockées dans chaque build')
  .option('--json', 'sortie JSON')
  .action(async (opts) => {
    const t = createTranslator();
    const entries = loadCorpus();
    if (entries.length === 0) {
      console.error(t('corpus.empty'));
      process.exitCode = 1;
      return;
    }

    const pool = new PobPool();
    console.error(t('corpus.startingPool', { n: pool.size }));
    await pool.start();
    try {
      const results = await validateCorpus(pool, entries, (done, total) => {
        if (!opts.json) process.stderr.write(`\r  ${done}/${total} builds rejoués   `);
      });
      if (!opts.json) process.stderr.write('\n');

      if (opts.json) { console.log(JSON.stringify(results, null, 2)); return; }

      const bad = results.filter((r) => r.error || r.worstDeviation > DEVIATION_THRESHOLD);
      console.log('');
      for (const r of results) {
        const head = `${r.className}/${r.ascendancy} niv ${r.level}`;
        if (r.error) { console.log(`  \x1b[31m✗\x1b[0m ${head} — ${r.error}`); continue; }
        const worst = r.comparisons.filter(c => (c.deviation ?? 0) > DEVIATION_THRESHOLD)
          .sort((a,b)=>(b.deviation??0)-(a.deviation??0)).slice(0,3);
        if (worst.length === 0) { console.log(`  \x1b[32m✓\x1b[0m ${head}`); continue; }
        console.log(`  \x1b[33m!\x1b[0m ${head}`);
        for (const c of worst) {
          console.log(`      ${c.stat.padEnd(16)} auteur ${Math.round(c.author).toLocaleString('fr')}` +
            `  vs  nous ${Math.round(c.computed).toLocaleString('fr')}  (${((c.deviation ?? 0) * 100).toFixed(0)} % d'écart)`);
        }
      }
      console.log('');
      console.log(t('corpus.validateDone', { ok: results.length - bad.length, total: results.length }));
    } finally {
      pool.stop();
    }
  });

corpus
  .command('stats')
  .description('a priori tirés du corpus (supports, ascendancies, noeuds)')
  .argument('[skill]', 'filtrer sur une gemme principale')
  .action(async (skill?: string) => {
    const t = createTranslator();
    const entries = loadCorpus();
    if (entries.length === 0) { console.error(t('corpus.empty')); process.exitCode = 1; return; }
    const p = computePriors(entries);
    console.log(t('corpus.sample', { n: p.sampleSize }));

    const skills = skill
      ? [...p.supportsBySkill.keys()].filter((s) => s.toLowerCase().includes(skill.toLowerCase()))
      : [...p.supportsBySkill.keys()].sort((a, b) => (p.supportsBySkill.get(b)?.[0]?.count ?? 0) - (p.supportsBySkill.get(a)?.[0]?.count ?? 0)).slice(0, 12);

    for (const s of skills) {
      const sup = p.supportsBySkill.get(s) ?? [];
      const asc = p.ascendancyBySkill.get(s) ?? [];
      if (sup.length === 0) continue;
      console.log(`\n\x1b[1m${s}\x1b[0m  ${asc.slice(0,2).map(a=>`${a.name} ${(a.share*100).toFixed(0)}%`).join(', ')}`);
      for (const x of sup.slice(0, 8)) {
        console.log(`   ${String(Math.round(x.share*100)).padStart(3)}%  ${x.name}`);
      }
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
