import type { GemSocket, SkillGroup, BuildDraft } from '../domain/types.js';

/** Identifiants de classe utilisés par l'arbre de passifs de PoE 1. */
export const CLASS_IDS: Record<string, number> = {
  Scion: 0,
  Marauder: 1,
  Ranger: 2,
  Witch: 3,
  Duelist: 4,
  Templar: 5,
  Shadow: 6,
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderGem(gem: GemSocket): string {
  const attrs: Record<string, string> = {
    nameSpec: gem.name,
    level: String(gem.level),
    quality: String(gem.quality),
    enabled: 'true',
    enableGlobal1: 'true',
    enableGlobal2: 'false',
    count: '1',
  };
  // skillId/gemId viennent des données de PoB : les fournir évite que PoB
  // ait à résoudre la gemme par son nom affiché (sensible à la langue).
  if (gem.skillId) attrs.skillId = gem.skillId;
  if (gem.gemId) attrs.gemId = gem.gemId;
  if (gem.variantId) attrs.variantId = gem.variantId;

  const rendered = Object.entries(attrs)
    .map(([k, v]) => `${k}="${escapeXml(v)}"`)
    .join(' ');
  return `      <Gem ${rendered}/>`;
}

function renderGroup(group: SkillGroup, index: number, mainIndex: number): string {
  const gems = [group.main, ...group.supports].map(renderGem).join('\n');
  return [
    `    <Skill enabled="true" includeInFullDPS="${index === mainIndex}" ` +
      `slot="${escapeXml(group.slot)}" mainActiveSkill="1" mainActiveSkillCalcs="1">`,
    gems,
    `    </Skill>`,
  ].join('\n');
}

/**
 * Sérialise un brouillon de build vers le format XML de Path of Building.
 *
 * C'est le seul format d'entrée du moteur : tout ce que l'on veut faire
 * calculer par PoB passe par ici.
 */
export function toPobXml(draft: BuildDraft): string {
  const classId = CLASS_IDS[draft.className] ?? 0;
  const mainIndex = draft.mainGroupIndex ?? 0;

  const groups = draft.groups
    .map((g, i) => renderGroup(g, i, mainIndex))
    .join('\n');

  // `nodes` : liste des identifiants de passifs alloués, séparés par des
  // virgules. 58833 est le nœud racine par défaut d'un nouveau build PoB.
  const nodes = draft.treeNodes && draft.treeNodes.length > 0
    ? draft.treeNodes.join(',')
    : '58833';

  // Sans cet attribut, toute re-sérialisation d'un build perd ses masteries :
  // PoB considère alors les nœuds de mastery comme non alloués, et les
  // défenses ou dégâts qu'ils apportaient disparaissent silencieusement.
  const masteryEffects = (draft.masteryEffects ?? [])
    .map(([node, effect]) => `{${node},${effect}}`)
    .join(',');

  const config = (draft.config ?? [])
    .map((c) =>
      c.value === true
        ? `      <Input boolean="true" name="${escapeXml(c.name)}"/>`
        : typeof c.value === 'number'
          ? `      <Input number="${c.value}" name="${escapeXml(c.name)}"/>`
          : `      <Input string="${escapeXml(String(c.value))}" name="${escapeXml(c.name)}"/>`,
    )
    .join('\n');

  // PoB accepte des modificateurs libres appliqués au personnage : c'est le
  // moyen le plus direct de tester « et si j'avais telle stat ? » sans
  // fabriquer un objet qui la porte.
  const customMods = (draft.customMods ?? []).length
    ? `    <CustomModifierBlock title="pba" enabled="true">${escapeXml(
        (draft.customMods ?? []).join('\n'),
      )}</CustomModifierBlock>\n`
    : '';

  const items = (draft.items ?? [])
    .map(
      (it, i) =>
        `    <Item id="${i + 1}">${escapeXml(it.raw)}</Item>`,
    )
    .join('\n');

  const itemSlots = (draft.items ?? [])
    .map((it, i) => `      <Slot name="${escapeXml(it.slot)}" itemId="${i + 1}"/>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="${draft.level}" targetVersion="3_0" className="${escapeXml(draft.className)}" ascendClassName="${escapeXml(draft.ascendancy)}" mainSocketGroup="${mainIndex + 1}" viewMode="CALCS" bandit="${escapeXml(draft.bandit ?? 'None')}" pantheonMajorGod="None" pantheonMinorGod="None"/>
  <Tree activeSpec="1">
    <Spec treeVersion="${escapeXml(draft.treeVersion ?? '3_29')}" classId="${classId}" ascendClassId="${draft.ascendClassId ?? 0}" nodes="${nodes}" masteryEffects="${masteryEffects}"/>
  </Tree>
  <Skills activeSkillSet="1" defaultGemLevel="normalMaximum" sortGemsByDPS="true">
    <SkillSet id="1">
${groups}
    </SkillSet>
  </Skills>
  <Items activeItemSet="1">
${items}
    <ItemSet id="1">
${itemSlots}
    </ItemSet>
  </Items>
  <Config>
${config}
${customMods}  </Config>
</PathOfBuilding>`;
}
