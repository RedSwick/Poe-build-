--[[
  Pont headless vers le moteur de calcul de Path of Building Community Fork.

  Ce script est lancé par LuaJIT DEPUIS le dossier `src/` du dépôt PoB
  (cwd = vendor/PathOfBuilding/src), et reste vivant : il lit des requêtes
  JSON ligne par ligne sur stdin et répond en JSON sur stdout.

  Pourquoi un processus persistant : l'initialisation de PoB (chargement de
  l'arbre 3.29, des uniques, des mods) coûte plusieurs secondes. L'optimiseur
  de gemmes support enchaîne des centaines d'évaluations — on ne peut pas
  payer ce coût à chaque appel.

  Protocole : chaque réponse est préfixée par un sentinel, car PoB écrit
  librement sur stdout pendant le chargement et pendant les calculs.

  Requêtes acceptées :
    {"id":1,"action":"ping"}
    {"id":2,"action":"eval","xml":"<PathOfBuilding>...</PathOfBuilding>","stats":["TotalDPS"]}
    {"id":3,"action":"version"}
]]

local SENTINEL = "@@PBA@@"

dofile("HeadlessWrapper.lua")

local dkjson = require("dkjson")

-- Statistiques renvoyées par défaut. Ce sont les clés réelles du tableau
-- `build.calcsTab.mainOutput` de PoB (vérifiées sur la 3.29).
local DEFAULT_STATS = {
	-- Offensif
	"TotalDPS", "CombinedDPS", "FullDPS", "TotalDotDPS", "WithDotDPS", "AverageDamage",
	"AverageHit", "Speed", "CritChance", "CritMultiplier", "HitChance",
	"ManaCost", "AreaOfEffectRadius",
	-- Défensif
	"Life", "LifeUnreserved", "EnergyShield", "Mana", "ManaUnreserved",
	"Ward", "TotalEHP", "Armour", "Evasion", "BlockChance", "SpellBlockChance",
	"SpellSuppressionChance", "PhysicalDamageReduction",
	"FireResist", "ColdResist", "LightningResist", "ChaosResist",
	"FireResistOverCap", "ColdResistOverCap", "LightningResistOverCap",
	"LifeRegenRecovery", "EnergyShieldRecharge",
	"PhysicalMaximumHitTaken", "FireMaximumHitTaken", "ColdMaximumHitTaken",
	"LightningMaximumHitTaken", "ChaosMaximumHitTaken",
	-- Attributs / divers
	"Str", "Dex", "Int", "Devotion",
}

local function respond(payload)
	io.stdout:write(SENTINEL .. dkjson.encode(payload) .. "\n")
	io.stdout:flush()
end

--- Extrait les stats demandées du dernier calcul.
local function collectStats(wanted)
	local out = build.calcsTab and build.calcsTab.mainOutput
	if not out then
		return nil, "mainOutput indisponible (le build n'a pas été calculé)"
	end
	local stats = {}
	for _, key in ipairs(wanted) do
		local v = out[key]
		-- On ne renvoie que les scalaires : mainOutput contient aussi des
		-- sous-tables (breakdowns) qui ne sont pas sérialisables utilement.
		if type(v) == "number" or type(v) == "boolean" then
			stats[key] = v
		end
	end
	return stats
end

--- Charge un build depuis son XML et force un recalcul complet.
local function evaluate(req)
	local wanted = req.stats
	if type(wanted) ~= "table" or #wanted == 0 then
		wanted = DEFAULT_STATS
	end

	loadBuildFromXML(req.xml, req.name or "pba-eval")

	-- FullDPS n'agrège que les groupes marqués `includeInFullDPS`. Les
	-- groupes créés par un objet (Soulwrest et son Summon Phantasm déclenché)
	-- naissent à false : sans ce forçage, un build dont les dégâts viennent
	-- d'un unique ou de minions est mesuré à zéro.
	if req.fullDps then
		for _, sg in ipairs(build.skillsTab.socketGroupList or {}) do
			if sg.enabled ~= false then sg.includeInFullDPS = true end
		end
		build.buildFlag = true
	end

	-- BuildOutput() force le recalcul ; sans ça les stats peuvent refléter
	-- l'état précédent quand seules les gemmes ont changé.
	build.calcsTab:BuildOutput()

	local stats, err = collectStats(wanted)
	if not stats then
		return { ok = false, error = err }
	end

	-- Remonter les erreurs de calcul de PoB (gemme inconnue, item invalide…)
	-- plutôt que de renvoyer silencieusement des zéros.
	local warnings = {}
	if build.calcsTab.errMsg then
		table.insert(warnings, tostring(build.calcsTab.errMsg))
	end

	return { ok = true, stats = stats, warnings = warnings }
end

local function version()
	return {
		ok = true,
		pobVersion = launch and launch.versionNumber or "inconnue",
		treeVersion = build and build.spec and build.spec.treeVersion or "inconnue",
	}
end

--- Exporte l'index des gemmes tel que PoB l'a chargé.
--
-- On ne parse jamais Data/Gems.lua nous-mêmes : on lit la structure que le
-- moteur a construite. Les données suivent donc automatiquement la ligue
-- supportée par le fork PoB installé.
local function gems()
	local list = {}
	for gemId, gem in pairs(data.gems) do
		local ge = gem.grantedEffect
		local entry = {
			gemId = gemId,
			name = gem.name,
			baseTypeName = gem.baseTypeName,
			variantId = gem.variantId,
			grantedEffectId = gem.grantedEffectId,
			support = ge and ge.support == true or false,
			naturalMaxLevel = gem.naturalMaxLevel,
			reqStr = gem.reqStr, reqDex = gem.reqDex, reqInt = gem.reqInt,
			tags = {},
			skillTypes = {},
			supportSkillTypes = {},
		}
		for tag, on in pairs(gem.tags or {}) do
			if on then table.insert(entry.tags, tag) end
		end
		-- skillTypes : ce que la gemme active EST.
		-- supportSkillTypes : ce qu'une gemme de support peut soutenir.
		-- L'intersection des deux donne un présélecteur de compatibilité
		-- fiable, avant de mesurer réellement le gain via le moteur.
		if ge then
			for st, on in pairs(ge.skillTypes or {}) do
				if on then table.insert(entry.skillTypes, st) end
			end
			for st, on in pairs(ge.supportSkillTypes or {}) do
				if on then table.insert(entry.supportSkillTypes, st) end
			end
			entry.description = ge.description
		end
		table.insert(list, entry)
	end
	return { ok = true, gems = list }
end

local TREE_URL_PREFIX = "https://www.pathofexile.com/passive-skill-tree/"

--- Liste les nœuds d'arbre allouables intéressants pour un build donné.
--
-- On ne renvoie que les notables et les mots-clés : les nœuds « Normal »
-- (petits +10 force, etc.) ne sont pas des cibles d'optimisation, ils sont
-- alloués automatiquement en tant que chemin vers une cible.
local function treeCandidates(req)
	loadBuildFromXML(req.xml, "pba-tree")
	local spec = build.spec
	local list = {}

	-- Masteries : chaque mastery offre plusieurs effets au choix. On expose
	-- chaque couple (mastery, effet) comme un candidat distinct, car c'est
	-- l'effet choisi qui fait la valeur du nœud, pas le nœud lui-même.
	local masteries = {}
	for id, node in pairs(spec.nodes) do
		if node.type == "Mastery" and node.masteryEffects then
			local effects = {}
			for _, entry in ipairs(node.masteryEffects) do
				local effect = spec.tree.masteryEffects[entry.effect]
				if effect then
					table.insert(effects, { id = entry.effect, stats = effect.sd or {} })
				end
			end
			if #effects > 0 then
				table.insert(masteries, {
					id = id,
					name = node.dn or node.name,
					pathDist = node.pathDist,
					alloc = node.alloc == true,
					effects = effects,
				})
			end
		end
	end

	for id, node in pairs(spec.nodes) do
		local keep = node.type == "Notable" or node.type == "Keystone"
		-- Les nœuds d'ascendance d'une AUTRE ascendance sont inatteignables :
		-- les proposer ferait perdre des évaluations pour rien.
		if keep and node.ascendancyName and node.ascendancyName ~= spec.curAscendClassName then
			keep = false
		end
		-- Sans chemin calculé, le nœud n'est pas reliable à l'arbre.
		if keep and not node.path and not node.alloc then
			keep = false
		end
		if keep then
			table.insert(list, {
				id = id,
				name = node.dn or node.name,
				type = node.type,
				ascendancy = node.ascendancyName,
				pathDist = node.pathDist,
				alloc = node.alloc == true,
				stats = node.sd or {},
			})
		end
	end

	local used, ascUsed = spec:CountAllocNodes()
	return {
		ok = true,
		candidates = list,
		masteries = masteries,
		pointsUsed = used,
		ascPointsUsed = ascUsed,
	}
end

--- Alloue une liste de nœuds cibles puis calcule le build.
--
-- `AllocNode` de PoB alloue aussi tout le chemin menant au nœud : on
-- délègue donc entièrement le pathfinding au moteur au lieu de le recoder.
local function treeAlloc(req)
	loadBuildFromXML(req.xml, "pba-tree")
	local spec = build.spec

	local missing = {}

	-- L'effet d'une mastery doit être choisi AVANT son allocation : sans
	-- sélection, PoB considère le nœud comme non alloué.
	for _, m in ipairs(req.masteries or {}) do
		local node = spec.nodes[m[1]]
		if node then
			spec.masterySelections[m[1]] = m[2]
		end
	end

	for _, id in ipairs(req.targets or {}) do
		local node = spec.nodes[id]
		if not node then
			table.insert(missing, id)
		else
			spec:AllocNode(node)
		end
	end

	for _, m in ipairs(req.masteries or {}) do
		local node = spec.nodes[m[1]]
		if node then
			spec:AllocNode(node)
		else
			table.insert(missing, m[1])
		end
	end

	-- Propager l'arbre modifié vers les calculs, sinon les stats reflètent
	-- encore l'arbre chargé depuis le XML.
	spec:BuildAllDependsAndPaths()
	build.buildFlag = true
	build.calcsTab:BuildOutput()

	local wanted = req.stats
	if type(wanted) ~= "table" or #wanted == 0 then wanted = DEFAULT_STATS end
	local stats, err = collectStats(wanted)
	if not stats then return { ok = false, error = err } end

	local used, ascUsed = spec:CountAllocNodes()

	local allocated = {}
	for id, node in pairs(spec.allocNodes) do
		if node.type ~= "ClassStart" and node.type ~= "AscendClassStart" then
			table.insert(allocated, id)
		end
	end

	local masterySelections = {}
	for nodeId, effectId in pairs(spec.masterySelections or {}) do
		table.insert(masterySelections, { nodeId, effectId })
	end

	return {
		ok = true,
		stats = stats,
		pointsUsed = used,
		ascPointsUsed = ascUsed,
		allocated = allocated,
		masterySelections = masterySelections,
		missing = missing,
		url = spec:EncodeURL(TREE_URL_PREFIX),
	}
end

--- Exporte les objets uniques connus de PoB, groupés par type de base.
--
-- PoB stocke chaque unique sous forme de texte brut, identique au
-- copier-coller depuis le jeu : c'est exactement ce qu'on réinjecte dans le
-- XML d'un build pour l'équiper.
local function uniques(req)
	local out = {}
	local wanted = req.types
	for typeName, list in pairs(data.uniques) do
		local keep = true
		if type(wanted) == "table" and #wanted > 0 then
			keep = false
			for _, w in ipairs(wanted) do
				if w == typeName then keep = true break end
			end
		end
		if keep then
			local entries = {}
			for _, raw in ipairs(list) do
				-- La première ligne est le nom, la deuxième la base.
				local name, base = raw:match("^%s*([^\n]+)\n([^\n]+)")
				if name then
					table.insert(entries, {
						name = name,
						base = base,
						raw = raw,
						-- Nombre de variantes : un unique reworké au fil des
						-- ligues en a plusieurs, la dernière étant l'actuelle.
						variants = select(2, raw:gsub("\nVariant:", "")),
					})
				end
			end
			out[typeName] = entries
		end
	end
	return { ok = true, uniques = out }
end

--- Exporte le pool de mods explicites et les bases d'objets.
--
-- PoB embarque la base de mods complète du jeu : préfixes, suffixes, niveau
-- d'objet requis, groupe d'exclusion, poids d'apparition par catégorie de
-- base, et surtout les `tradeHashes`, identifiants de stats de l'API trade
-- officielle. On ne scrape donc aucun site de craft.
local function itemMods(req)
	local mods = {}
	for modId, mod in pairs(data.itemMods.Item or {}) do
		-- Seuls les mods portant un type (Prefix/Suffix) peuvent apparaître
		-- sur un objet rare classique.
		if mod.type == "Prefix" or mod.type == "Suffix" then
			local stats = {}
			for _, line in ipairs(mod) do
				if type(line) == "string" then table.insert(stats, line) end
			end

			-- weightKey/weightVal sont deux listes parallèles : une catégorie
			-- de base et son poids d'apparition. Un poids nul interdit le mod.
			local weights = {}
			for i, key in ipairs(mod.weightKey or {}) do
				local val = (mod.weightVal or {})[i] or 0
				if val > 0 then weights[key] = val end
			end

			local hashes = {}
			for hash in pairs(mod.tradeHashes or {}) do
				table.insert(hashes, hash)
			end

			if #stats > 0 then
				table.insert(mods, {
					id = modId,
					type = mod.type,
					affix = mod.affix,
					stats = stats,
					level = mod.level or 1,
					group = mod.group,
					weights = weights,
					tags = mod.modTags or {},
					tradeHashes = hashes,
				})
			end
		end
	end

	local bases = {}
	for name, base in pairs(data.itemBases) do
		local tags = {}
		for tag, on in pairs(base.tags or {}) do
			if on then table.insert(tags, tag) end
		end
		table.insert(bases, {
			name = name,
			type = base.type,
			subType = base.subType,
			tags = tags,
			reqLevel = base.req and base.req.level or 1,
			socketLimit = base.socketLimit,
		})
	end

	return { ok = true, mods = mods, bases = bases }
end

--- Liste les compétences réellement actives d'un build, source comprise.
--
-- Une compétence peut venir d'une gemme sertie OU d'un objet qui la
-- déclenche (Soulwrest et son Summon Phantasm, par exemple). PoB range les
-- secondes dans des groupes portant un champ `source` : sans les exposer,
-- un build dont la compétence principale vient d'un unique est invisible.
local function skills(req)
	loadBuildFromXML(req.xml, "pba-skills")
	build.calcsTab:BuildOutput()

	local groups = {}
	for index, sg in ipairs(build.skillsTab.socketGroupList or {}) do
		local gems = {}
		for _, gem in ipairs(sg.gemList or {}) do
			table.insert(gems, {
				name = gem.nameSpec,
				level = gem.level,
				quality = gem.quality,
				enabled = gem.enabled,
			})
		end

		-- `displaySkillList` contient les compétences effectivement produites
		-- par le groupe, y compris celles octroyées par un objet.
		local active = {}
		for _, skill in ipairs(sg.displaySkillList or {}) do
			local ge = skill.activeEffect and skill.activeEffect.grantedEffect
			if ge then
				table.insert(active, {
					name = ge.name,
					level = skill.activeEffect.level,
					minion = skill.minion ~= nil,
				})
			end
		end

		table.insert(groups, {
			index = index,
			slot = sg.slot,
			label = sg.label,
			source = sg.source,
			enabled = sg.enabled,
			gems = gems,
			activeSkills = active,
		})
	end

	return { ok = true, groups = groups, mainGroup = build.mainSocketGroup }
end

local HANDLERS = {
	ping = function() return { ok = true, pong = true } end,
	version = version,
	eval = evaluate,
	gems = gems,
	tree_candidates = treeCandidates,
	tree_alloc = treeAlloc,
	uniques = uniques,
	item_mods = itemMods,
	skills = skills,
}

-- Signale au parent que l'initialisation est terminée et que PoB a fini
-- d'écrire son bruit de démarrage sur stdout.
respond({ id = 0, ok = true, ready = true })

for line in io.lines() do
	if line ~= "" then
		local req = dkjson.decode(line)
		if not req then
			respond({ id = -1, ok = false, error = "JSON invalide" })
		else
			local handler = HANDLERS[req.action]
			if not handler then
				respond({ id = req.id, ok = false, error = "action inconnue: " .. tostring(req.action) })
			else
				-- pcall : une erreur Lua dans PoB ne doit pas tuer le worker,
				-- sinon toute la session d'optimisation est perdue.
				local success, result = pcall(handler, req)
				if success then
					result.id = req.id
					respond(result)
				else
					respond({ id = req.id, ok = false, error = tostring(result) })
				end
			end
		end
	end
end
