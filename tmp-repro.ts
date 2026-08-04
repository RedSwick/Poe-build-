import { PobEngine } from './src/pob/bridge.js';
import { toPobXml } from './src/pob/buildXml.js';
import { loadUniqueIndex } from './src/data/uniques.js';
import { totalDamage, effectiveHp, resistanceStatus } from './src/domain/goals.js';
import { auditBuild } from './src/domain/audit.js';

const e = new PobEngine();
await e.start();
const u = await loadUniqueIndex(e);
const g=(n:string,l=20,q=20)=>({name:n,level:l,quality:q});

const items = [
  { slot:'Weapon 1', raw:u.find('Soulwrest')!.raw },
  { slot:'Helmet', raw:u.find('Ancient Skull')!.raw },
  { slot:'Body Armour', raw:`Rarity: RARE\nFate Shelter\nArcane Vestment\nQuality: 20\n--------\n+5% to all Elemental Resistances\n7% increased Effect of your Curses\n--------\n+94 to maximum Energy Shield\n101% increased Energy Shield\n+158 to maximum Life\nRegenerate 63 Life per second\n+43% to Cold Resistance\n+19% to Fire and Cold Resistances` },
  { slot:'Gloves', raw:`Rarity: RARE\nGhoul Touch\nCrusader Gloves\nQuality: 28\n--------\n115% increased Armour and Energy Shield\n+129 to maximum Life\n+36% to Lightning Resistance\n+30% to Chaos Resistance\n13% increased Stun and Block Recovery\n+20 to Dexterity` },
  { slot:'Boots', raw:`Rarity: RARE\nCorruption Road\nCrusader Boots\nQuality: 20\n--------\n+27 to Strength\n+83 to Armour\n86% increased Armour and Energy Shield\n+26 to maximum Energy Shield\n+24% to Fire Resistance\n20% increased Stun and Block Recovery\n23% increased Movement Speed` },
  { slot:'Belt', raw:`Rarity: RARE\nMind Lock\nStudded Belt\n--------\n25% increased Stun Duration on Enemies\n--------\n+28 to Strength\n+18 to maximum Energy Shield\n+115 to maximum Life\n+17% to Lightning Resistance\n25% increased Elemental Damage with Attack Skills\n+10% to Cold and Lightning Resistances` },
  { slot:'Ring 1', raw:`Rarity: RARE\nDread Coil\nTwo-Stone Ring\n--------\n+15% to Fire and Lightning Resistances\n--------\n+27 to Dexterity\n+10 to Intelligence\n+54 to maximum Mana\n+10% to Cold Resistance\n+16 to maximum Life` },
  { slot:'Ring 2', raw:`Rarity: RARE\nFate Gyre\nTwo-Stone Ring\n--------\n+14% to Fire and Cold Resistances\n--------\n+14 to maximum Energy Shield\nRegenerate 2 Life per second\n+9% to all Elemental Resistances\n+12% to Fire Resistance\n23% increased Elemental Damage with Attack Skills\n+27 to maximum Life` },
  { slot:'Amulet', raw:`Rarity: RARE\nOblivion Rosary\nCitrine Amulet\n--------\n+19 to Strength and Dexterity\n--------\n6% increased maximum Energy Shield\n+28 to maximum Mana\n+5% to all Elemental Resistances\n+15% to Fire Resistance\nGain 7 Life per Enemy Killed\n+19 to maximum Life` },
];
const groups = [
  { slot:'Weapon 1', main:g('Summon Phantasm'), supports:['Greater Multiple Projectiles','Minion Damage','Increased Critical Damage'].map(n=>g(n)) },
  { slot:'Weapon 1', main:g('Fresh Meat'), supports:[g('Faster Projectiles')] },
  { slot:'Boots', main:g('Summon Carrion Golem'), supports:[g('Maim')] },
  { slot:'Gloves', main:g('Pride'), supports:[] },
  { slot:'Gloves', main:g('Purity of Elements'), supports:[] },
  { slot:'Gloves', main:g('Flesh and Stone'), supports:[] },
  { slot:'Helmet', main:g('Raise Spectre'), supports:[g('Feeding Frenzy')] },
  { slot:'Helmet', main:g('Summon Stone Golem'), supports:[] },
  { slot:'Helmet', main:g('Animate Guardian'), supports:[] },
  { slot:'Body Armour', main:g('Cyclone'), supports:['Cast while Channelling','Desecrate','Spirit Offering'].map(n=>g(n)) },
];
const xml = toPobXml({ className:'Witch', ascendancy:'Necromancer', ascendClassId:1, level:67, items, groups, mainGroupIndex:0 } as any);

// Tes choix : Divine Shield, Zealot's Oath + les 3 masteries avec TES effets
const r = await e.treeAlloc(xml, [58556, 63425], [
  [37641, 18301],  // Armour&ES : increases d'armure -> vitesse de recharge ES
  [43647, 47429],  // Minion Offence : 50% chance d'ignorer la reduc phys
  [62416, 28589],  // Staff : 30% increased Defences au bâton
]);
const res = resistanceStatus(r.stats);
console.log(`=== TON BUILD AVEC TON ARBRE ===`);
console.log(`points  ${r.pointsUsed} passifs + ${r.ascPointsUsed} ascendance  (tu en as 90)`);
console.log(`FullDPS ${Math.round(totalDamage(r.stats))}   EHP ${Math.round(effectiveHp(r.stats))}`);
console.log(`vie ${r.stats.Life}  ES ${r.stats.EnergyShield}  armure ${r.stats.Armour}`);
console.log(`res ${res.fire}/${res.cold}/${res.lightning}  chaos ${res.chaos}   mana ${r.stats.ManaUnreserved}/${r.stats.Mana}`);
console.log(`\nlien arbre : ${r.url}`);
console.log('\naudit :');
for (const f of auditBuild(r.stats)) console.log(`  [${f.severity}] ${f.key} ${JSON.stringify(f.params??{})}`);

// Les 56 points restants : que valent-ils ?
const { optimizeTree } = await import('./src/domain/treeOptimizer.js');
const { resolveGoal } = await import('./src/domain/goals.js');
const seeded = toPobXml({
  className:'Witch', ascendancy:'Necromancer', ascendClassId:1, level:67,
  items, groups, mainGroupIndex:0,
  treeNodes: r.allocated,
  masteryEffects: [[37641,18301],[43647,47429],[62416,28589]],
} as any);
console.log('\nOptimisation des points restants…');
const t = await optimizeTree(e, seeded, resolveGoal('balanced'), {
  budget: 90, maxDist: 8, batch: 4, minGainPercent: 0.8,
});
const r2 = resistanceStatus(t.finalStats);
console.log(`\n=== APRÈS ${t.pointsUsed} POINTS (sur 90) ===`);
console.log(`FullDPS ${Math.round(totalDamage(t.finalStats))}   EHP ${Math.round(effectiveHp(t.finalStats))}`);
console.log(`vie ${t.finalStats.Life}  ES ${t.finalStats.EnergyShield}  armure ${t.finalStats.Armour}  chaos ${r2.chaos}`);
console.log('\nnoeuds ajoutés :');
for (const c of t.chosen.slice(0,14)) console.log(`  ${c.node.type.padEnd(9)} ${c.node.name.padEnd(28)} ${c.cost}pts +${c.gainPercent.toFixed(1)}%`);
console.log(`\nlien : ${t.url}`);
e.stop();
