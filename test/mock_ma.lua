-- Minimal stand-in for the parts of the grandMA3 Lua API the plugin uses.
-- Objects are plain tables; only behaviour the plugin relies on is modelled.

local M = {}

local Obj = {}
-- like MA3, an unnamed recipe reports "<class> <index>" as its name
Obj.__index = function(obj, key)
	if key == 'name' and obj.class:match('Recipe$') then
		local raw = rawget(obj, 'rawname')
		return (raw == nil or raw == '') and (obj.class .. ' ' .. obj.index) or raw
	end
	return Obj[key]
end

local function reindex(parent)
	for i, child in ipairs(parent.children) do
		child.index = i
	end
end

local function adopt(parent, child)
	child.parent = parent
	table.insert(parent.children, child)
	reindex(parent)
	return child
end

local function new(class, fields)
	local obj = setmetatable(fields or {}, Obj)
	obj.class = class
	obj.children = obj.children or {}
	return obj
end

function Obj:GetClass()
	return self.class
end

function Obj:Parent()
	return self.parent
end

function Obj:Children()
	local list = {}
	for i, child in ipairs(self.children) do
		list[i] = child
	end
	return list
end

-- property names are case-insensitive in MA; the mock stores them in lower case
function Obj:Get(name)
	return self[name:lower()]
end

function Obj:Set(name, value)
	self[name:lower()] = value
end

-- like MA3 2.4: appended parts start with part number 0 and must be renumbered
function Obj:Append(class, undo)
	assert(undo == M.UNDO, 'Append without undo handle')
	if class == 'Part' then
		return adopt(self, new('Part', { part = 0, name = 'Part' }))
	end
	return adopt(self, new(class, { rawname = '', enabled = true }))
end

-- ****************************************************************
-- show data builders
-- ****************************************************************

function M.reset()
	M.sequences = {}
	M.groups = {}
	M.presetPools = {}
	M.vars = {}
	M.selected = nil
	M.dialogQueue = {}
	M.UNDO = { 'undo' }
	M.log = { commands = {}, moves = 0, undoOpened = 0, undoClosed = 0, dialogs = {}, messages = {}, prints = {} }
end

-- groups get disjoint fixtures (no*100+1 .. no*100+4) unless set with M.fixtures()
function M.group(no)
	if not M.groups[no] then
		local data = {}
		for i = 1, 4 do
			data[i] = { sf_index = no * 100 + i }
		end
		M.groups[no] = new('Group', { no = no, name = 'Group ' .. no, selectiondata = data })
	end
	return M.groups[no]
end

function M.fixtures(groupNo, list)
	local data = {}
	for i, sf in ipairs(list) do
		data[i] = { sf_index = sf }
	end
	M.group(groupNo).selectiondata = data
end

local FEATURE_GROUPS = { 'Dimmer', 'Position', 'Gobo', 'Color', 'Beam', 'Focus', 'Control', 'Shapers', 'Video' }

function M.preset(pool, no)
	M.presetPools[pool] = M.presetPools[pool] or new('Presets', { no = pool, index = pool })
	local presets = M.presetPools[pool]
	for _, preset in ipairs(presets.children) do
		if preset.no == no then
			return preset
		end
	end
	-- presets of the "All" pools (21+) report an empty feature group
	local fields = { no = no, name = 'Preset ' .. pool .. '.' .. no, featuregroup = FEATURE_GROUPS[pool] or '' }
	return adopt(presets, new('Preset', fields))
end

-- spec: { g = 5, p = { 4, 1 }, name = 'x', extra = 'anything', sep = true }
local function recipe(spec)
	-- MA3 2.4 reports recipe lines as "StandardRecipe"
	return new('StandardRecipe', {
		rawname = spec.sep and '#########' or spec.name or '',
		enabled = not spec.sep,
		owndatapresent = false,
		selection = spec.g and M.group(spec.g) or nil,
		values = spec.p and M.preset(spec.p[1], spec.p[2]) or nil,
		matricks = spec.matricks,
		filter = spec.filter,
		extra = spec.extra,
	})
end

-- cues: { [cueNo] = { part0Recipes, part1Recipes, ... } } given as a list of { no = 1, parts = {...} }
function M.sequence(no, name, cues)
	local sequence = new('Sequence', { no = no, name = name })
	-- internal cues every MA3 sequence has; they must never be touched
	local offCue = adopt(sequence, new('Cue', { name = 'OffCue' }))
	local cueZero = adopt(sequence, new('Cue', { no = 0, name = 'CueZero' }))
	for _, internal in ipairs({ offCue, cueZero }) do
		local part = adopt(internal, new('Part', { part = 0, name = 'Part 0' }))
		adopt(part, recipe({ g = 9, extra = 'internal-b' }))
		adopt(part, recipe({ g = 1, extra = 'internal-a' }))
	end
	for _, cueSpec in ipairs(cues) do
		local cue = adopt(sequence, new('Cue', { no = math.floor(cueSpec.no * 1000), name = 'Cue ' .. cueSpec.no }))
		for partIndex, recipes in ipairs(cueSpec.parts) do
			local part = adopt(cue, new('Part', { part = partIndex - 1, name = 'Part ' .. (partIndex - 1) }))
			for key, value in pairs(cueSpec.timing or {}) do
				part[key] = value
			end
			for _, spec in ipairs(recipes) do
				adopt(part, recipe(spec))
			end
		end
	end
	table.insert(M.sequences, sequence)
	return sequence
end

function M.cue(sequence, cueNo)
	for _, cue in ipairs(sequence.children) do
		if cue.no == math.floor(cueNo * 1000) then
			return cue
		end
	end
end

-- list of a field over the recipes of one part, e.g. M.column(part, 'extra')
function M.column(part, read)
	local list = {}
	for i, r in ipairs(part.children) do
		list[i] = read(r)
	end
	return list
end

-- ****************************************************************
-- grandMA3 globals
-- ****************************************************************

-- parses "1", "1 Thru 3", "1 Thru 3 + 7", "\"Main\"" into a predicate on (number, name)
local function parseSelection(text)
	local predicates = {}
	for token in (text .. '+'):gmatch('%s*(.-)%s*%+') do
		local from, to = token:match('^([%d%.]+)%s+[Tt][Hh][Rr][Uu]%s+([%d%.]+)$')
		local single = token:match('^([%d%.]+)$')
		local quoted = token:match('^"(.*)"$')
		if from then
			table.insert(predicates, function(n)
				return n >= tonumber(from) and n <= tonumber(to)
			end)
		elseif single then
			table.insert(predicates, function(n)
				return n == tonumber(single)
			end)
		elseif quoted then
			table.insert(predicates, function(_, name)
				return name == quoted
			end)
		else
			error('Syntax error: ' .. token)
		end
	end
	return function(n, name)
		for _, predicate in ipairs(predicates) do
			if predicate(n, name) then
				return true
			end
		end
		return false
	end
end

function ObjectList(query)
	local seqText, cueText = query:match('^Sequence (.-) Cue (.*)$')
	seqText = seqText or query:match('^Sequence (.*)$')
	local matchSeq = parseSelection(seqText)
	local result = {}
	for _, sequence in ipairs(M.sequences) do
		if matchSeq(sequence.no, sequence.name) then
			if cueText then
				local matchCue = parseSelection(cueText)
				for _, cue in ipairs(sequence.children) do
					if cue.no and matchCue(cue.no / 1000, cue.name) then
						table.insert(result, cue)
					end
				end
			else
				table.insert(result, sequence)
			end
		end
	end
	return result
end

function SelectedSequence()
	return M.selected
end

function UserVars()
	return M.vars
end

function GetVar(vars, key)
	return vars[key]
end

function SetVar(vars, key, value)
	vars[key] = value
end

local function findPart(seqNo, cueText, partNo)
	for _, sequence in ipairs(M.sequences) do
		if sequence.no == tonumber(seqNo) then
			local cueNo = math.floor(tonumber(cueText) * 1000 + 0.5)
			for _, cue in ipairs(sequence.children) do
				if cue.no == cueNo then
					for _, part in ipairs(cue.children) do
						if part.part == tonumber(partNo) then
							return part
						end
					end
				end
			end
		end
	end
end

-- supports the commands the plugin issues, with MA3 2.4 semantics:
--   Move <recipe> At <recipe>   take the recipe out, insert it at the target (any part)
--   Delete <recipe> /nc         remove the recipe
-- <recipe> = "Sequence s Cue c Part p.r"
function Cmd(command, undo)
	assert(undo == M.UNDO, 'Cmd without undo handle: ' .. command)
	table.insert(M.log.commands, command)
	local addr = 'Sequence (%d+) Cue ([%d%.]+) Part (%d+)%.(%d+)'
	local s1, c1, p1, r1, s2, c2, p2, r2 = command:match('^Move ' .. addr .. ' At ' .. addr .. '$')
	if s1 then
		local from, to = findPart(s1, c1, p1), findPart(s2, c2, p2)
		assert(from and to, 'Move from/to unknown part: ' .. command)
		local recipe = assert(table.remove(from.children, tonumber(r1)), 'no source recipe: ' .. command)
		assert(tonumber(r2) <= #to.children + 1, 'target index out of range: ' .. command)
		table.insert(to.children, tonumber(r2), recipe)
		recipe.parent = to
		reindex(from)
		reindex(to)
		M.log.moves = M.log.moves + 1
		return 'OK'
	end
	local s3, c3, p3, r3 = command:match('^Delete ' .. addr .. ' /nc$')
	if s3 then
		local part = assert(findPart(s3, c3, p3), 'Delete in unknown part: ' .. command)
		assert(table.remove(part.children, tonumber(r3)), 'no recipe to delete: ' .. command)
		reindex(part)
		M.log.deletes = (M.log.deletes or 0) + 1
		return 'OK'
	end
	return 'Illegal command'
end

function CreateUndo(text)
	M.log.undoOpened = M.log.undoOpened + 1
	return M.UNDO
end

function CloseUndo(undo)
	assert(undo == M.UNDO, 'CloseUndo with wrong handle')
	M.log.undoClosed = M.log.undoClosed + 1
end

function Printf(text)
	table.insert(M.log.prints, text)
end

function Echo(text) end

-- dialogs with inputs are answered by the queued responders; plain messages are logged
function MessageBox(options)
	if options.inputs == nil then
		table.insert(M.log.messages, options.message)
		return { success = true, result = 1, inputs = {}, selectors = {}, states = {} }
	end
	table.insert(M.log.dialogs, options)
	local respond = table.remove(M.dialogQueue, 1)
	assert(respond, 'unexpected dialog: ' .. options.title)
	return respond(options)
end

-- checkbox names are matched by a distinctive part of their label
local STATE_PATTERNS = {
	deleteEmpty = 'Leere',
	separators = 'Separatoren',
	splitGroups = 'Groups in Parts',
	splitPresets = 'Preset%-Pools in Parts',
}

-- queue an answer for the sort dialog; opts = { deleteEmpty = true, separators = true, ... }
function M.answer(sequences, cues, mode, opts)
	local modeIndex = ({ group = 1, preset = 2, name = 3 })[mode]
	table.insert(M.dialogQueue, function(options)
		local selector = options.selectors[1]
		local selectorName = selector.name
		local labelOk = false
		for _, value in pairs(selector.values) do
			labelOk = labelOk or value == modeIndex
		end
		assert(labelOk, 'selector has no value ' .. modeIndex)
		local states = {}
		for key, pattern in pairs(STATE_PATTERNS) do
			local found
			for _, state in ipairs(options.states or {}) do
				if state.name:find(pattern) then
					found = state.name
				end
			end
			assert(found, 'dialog has no checkbox for ' .. key)
			states[found] = (opts or {})[key] == true
		end
		return {
			success = true,
			result = 1,
			inputs = { [options.inputs[1].name] = sequences, [options.inputs[2].name] = cues },
			selectors = { [selectorName] = modeIndex },
			states = states,
		}
	end)
end

function M.cancel()
	table.insert(M.dialogQueue, function()
		return { success = false, result = 0, inputs = {}, selectors = {}, states = {} }
	end)
end

return M
