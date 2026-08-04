import { PobEngine } from './src/pob/bridge.js';
import { toPobXml } from './src/pob/buildXml.js';

const e = new PobEngine();
await e.start();
const xml = toPobXml({
  className:'Witch', ascendancy:'Necromancer', ascendClassId:1, level:67,
  groups:[{slot:'Weapon 1',main:{name:'Summon Phantasm',level:20,quality:20},supports:[]}],
} as any);
const c = await e.treeCandidates(xml);

for (const name of ['Divine Shield','Zealot\'s Oath']) {
  const n = c.candidates.find(x => x.name === name);
  console.log(n ? `KEYSTONE ${name}: id=${n.id} dist=${n.pathDist}` : `KEYSTONE ${name}: INTROUVABLE`);
}
for (const mName of ['Armour and Energy Shield Mastery','Minion Offence Mastery','Staff Mastery']) {
  const m = c.masteries.find(x => x.name === mName);
  if (!m) { console.log(`MASTERY ${mName}: INTROUVABLE`); continue; }
  console.log(`\nMASTERY ${mName} (id=${m.id}, dist=${m.pathDist})`);
  for (const eff of m.effects) console.log(`   effet ${eff.id}: ${eff.stats.join(' | ').slice(0,95)}`);
}
e.stop();
