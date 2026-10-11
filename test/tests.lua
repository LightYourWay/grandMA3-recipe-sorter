-- End-to-end tests: run the compiled plugin against the mocked grandMA3 API.
-- PLUGIN_SOURCE and MA (test/mock_ma.lua) are set up by test/run.mjs.

local tests = {}
local function test(name, fn)
	table.insert(tests, { name = name, fn = fn })
end

local function same(actual, expected, label)
	local function show(list)
		local parts = {}
		for i = 1, math.max(#list, 0) do
			parts[i] = tostring(list[i])
		end
		return '{' .. table.concat(parts, ', ') .. '}'
	end
	local a, e = show(actual), show(expected)
	if #actual ~= #expected or a ~= e then
		error((label or 'mismatch') .. ': expected ' .. e .. ', got ' .. a, 2)
	end
end

local function check(condition, message)
	if not condition then
		error(message, 2)
	end
end

local function runPlugin()
	local chunk = assert(load(PLUGIN_SOURCE, '@recipe-sorter.lua'))
	local main = chunk('recipe-sorter', 'recipe-sorter', {}, nil)
	main(1, nil)
end

local function extra(r)
	return r.extra or '-'
end

local function part(sequence, cueNo, partIndex)
	return MA.cue(sequence, cueNo).children[partIndex or 1]
end

-- ****************************************************************

test('sorts by group number, empty groups last, all properties move along', function()
	local seq = MA.sequence(1, 'Main', {
		{
			no = 1,
			parts = {
				{
					{ g = 5, extra = 'g5a', matricks = 'mx1', filter = 'f1', name = 'Wash' },
					{ extra = 'none' },
					{ g = 2, extra = 'g2' },
					{ g = 5, extra = 'g5b' },
					{ g = 10, extra = 'g10' },
					{ g = 1, extra = 'g1' },
				},
			},
		},
	})
	MA.answer('1', '', 'group')
	runPlugin()

	local recipes = part(seq, 1)
	same(MA.column(recipes, extra), { 'g1', 'g2', 'g5a', 'g5b', 'g10', 'none' })
	same(MA.column(recipes, function(r)
		return r.selection and r.selection.no or '-'
	end), { 1, 2, 5, 5, 10, '-' }, 'groups')
	local moved = recipes.children[3]
	check(moved.matricks == 'mx1' and moved.filter == 'f1' and moved.rawname == 'Wash', 'properties lost')
	check(MA.log.undoOpened == 1 and MA.log.undoClosed == 1, 'expected exactly one undo block')
end)

test('sorts by preset: pool number first, then preset number', function()
	local seq = MA.sequence(1, 'Main', {
		{
			no = 1,
			parts = {
				{
					{ p = { 4, 12 }, extra = '4.12' },
					{ p = { 21, 3 }, extra = '21.3' },
					{ extra = 'none' },
					{ p = { 2, 10 }, extra = '2.10' },
					{ p = { 4, 1 }, extra = '4.1' },
					{ p = { 2, 5 }, extra = '2.5' },
				},
			},
		},
	})
	MA.answer('1', '', 'preset')
	runPlugin()
	same(MA.column(part(seq, 1), extra), { '2.5', '2.10', '4.1', '4.12', '21.3', 'none' })
end)

-- recipes without a key must not leave nil holes in Lua arrays: `#` would then report
-- an arbitrary border and only part of the recipes would get sorted (seen in MA3 2.4)
test('recipes without a value never cut the sort short', function()
	local seq = MA.sequence(1, 'Main', {
		{
			no = 1,
			parts = {
				{
					{ p = { 4, 9 }, extra = 'p9' },
					{ extra = 'n1' },
					{ extra = 'n2' },
					{ extra = 'n3' },
					{ extra = 'n4' },
					{ extra = 'n5' },
					{ p = { 4, 1 }, extra = 'p1' },
				},
			},
		},
	})
	MA.answer('1', '', 'preset')
	runPlugin()
	same(MA.column(part(seq, 1), extra), { 'p1', 'p9', 'n1', 'n2', 'n3', 'n4', 'n5' })
end)

test('sorts by recipe name A-Z: case-insensitive, natural numbers, empty last', function()
	local seq = MA.sequence(1, 'Main', {
		{
			no = 1,
			parts = {
				{
					{ name = 'Front 10' },
					{ name = '' },
					{ name = 'back' },
					{ name = 'Front 2' },
					{ name = 'Alpha' },
					{ name = 'front 2' },
					-- sorts after the default name "StandardRecipe n" → proves defaults count as empty
					{ name = 'Zoom' },
				},
			},
		},
	})
	MA.answer('1', '', 'name')
	runPlugin()
	same(MA.column(part(seq, 1), function(r)
		return r.rawname
	end), { 'Alpha', 'back', 'Front 2', 'front 2', 'Front 10', 'Zoom', '' })
end)

test('only touches the selected cues, sorts every part separately', function()
	local unsorted = { { g = 3, extra = 'c' }, { g = 1, extra = 'a' }, { g = 2, extra = 'b' } }
	local seq = MA.sequence(1, 'Main', {
		{ no = 1, parts = { unsorted } },
		{ no = 2, parts = { unsorted, { { g = 9, extra = 'z' }, { g = 8, extra = 'y' } } } },
		{ no = 2.5, parts = { unsorted } },
		{ no = 3, parts = { unsorted } },
	})
	MA.answer('1', '2 Thru 2.5', 'group')
	runPlugin()
	same(MA.column(part(seq, 1), extra), { 'c', 'a', 'b' }, 'cue 1 untouched')
	same(MA.column(part(seq, 2, 1), extra), { 'a', 'b', 'c' }, 'cue 2 part 0')
	same(MA.column(part(seq, 2, 2), extra), { 'y', 'z' }, 'cue 2 part 1')
	same(MA.column(part(seq, 2.5), extra), { 'a', 'b', 'c' }, 'cue 2.5')
	same(MA.column(part(seq, 3), extra), { 'c', 'a', 'b' }, 'cue 3 untouched')
end)

test('"all cues" skips the internal OffCue and CueZero', function()
	local seq = MA.sequence(1, 'Main', { { no = 1, parts = { { { g = 2 }, { g = 1 } } } } })
	MA.answer('1', '', 'group')
	runPlugin()
	for i = 1, 2 do
		local internal = seq.children[i].children[1]
		same(MA.column(internal, extra), { 'internal-b', 'internal-a' }, seq.children[i].name)
	end
	check(MA.log.messages[1]:find('/ 1 Cues', 1, true), MA.log.messages[1])
end)

test('addresses long cue numbers and higher parts exactly', function()
	local seq = MA.sequence(7, 'Main', {
		{ no = 1234.567, parts = { { { g = 1 } }, { { g = 2, extra = 'b' }, { g = 1, extra = 'a' } } } },
	})
	MA.answer('7', '', 'group')
	runPlugin()
	same(MA.column(part(seq, 1234.567, 2), extra), { 'a', 'b' })
	same(MA.log.commands, { 'Move Sequence 7 Cue 1234.567 Part 1.2 At Sequence 7 Cue 1234.567 Part 1.1' })
end)

test('handles several sequences in one run', function()
	local unsorted = { { g = 2, extra = 'b' }, { g = 1, extra = 'a' } }
	local s1 = MA.sequence(1, 'One', { { no = 1, parts = { unsorted } } })
	local s2 = MA.sequence(2, 'Two', { { no = 1, parts = { unsorted } } })
	local s3 = MA.sequence(3, 'Three', { { no = 1, parts = { unsorted } } })
	local s7 = MA.sequence(7, 'Seven', { { no = 1, parts = { unsorted } } })
	MA.answer('1 Thru 2 + 7', '', 'group')
	runPlugin()
	same(MA.column(part(s1, 1), extra), { 'a', 'b' }, 'seq 1')
	same(MA.column(part(s2, 1), extra), { 'a', 'b' }, 'seq 2')
	same(MA.column(part(s3, 1), extra), { 'b', 'a' }, 'seq 3 untouched')
	same(MA.column(part(s7, 1), extra), { 'a', 'b' }, 'seq 7')
end)

test('already sorted parts are not rewritten', function()
	MA.sequence(1, 'Main', { { no = 1, parts = { { { g = 1 }, { g = 2 }, {} } } } })
	MA.answer('1', '', 'group')
	runPlugin()
	check(MA.log.moves == 0, 'expected no writes, got ' .. MA.log.moves .. ' moves')
	check(MA.log.messages[1]:find('0 Parts umsortiert', 1, true), MA.log.messages[1])
end)

test('cancel changes nothing', function()
	local seq = MA.sequence(1, 'Main', { { no = 1, parts = { { { g = 2 }, { g = 1 } } } } })
	MA.cancel()
	runPlugin()
	check(MA.log.moves == 0 and MA.log.undoOpened == 0, 'cancel must not modify the show')
	check(part(seq, 1).children[1].selection.no == 2, 'order changed')
end)

test('unknown sequence shows an error and re-opens the dialog with the entered values', function()
	local seq = MA.sequence(1, 'Main', { { no = 1, parts = { { { g = 2 }, { g = 1 } } } } })
	MA.answer('99', '1', 'preset')
	MA.cancel()
	runPlugin()
	check(MA.log.messages[1]:find('Keine Sequence', 1, true), 'missing error message')
	local second = MA.log.dialogs[2]
	check(second.inputs[1].value == '99' and second.inputs[2].value == '1', 'inputs not kept')
	check(second.selectors[1].selectedValue == 2, 'mode not kept')
	check(part(seq, 1).children[1].selection.no == 2, 'order changed')
end)

test('invalid syntax and missing cues are reported, not crashing', function()
	MA.sequence(1, 'Main', { { no = 1, parts = { { { g = 1 } } } } })
	MA.answer('1 +* x', '', 'group')
	MA.answer('1', '50', 'group')
	MA.cancel()
	runPlugin()
	check(MA.log.messages[1]:find('Keine Sequence', 1, true), 'syntax error not reported')
	check(MA.log.messages[2]:find('Keine Cues', 1, true), 'missing cues not reported')
end)

test('sequence can be given by name', function()
	local seq = MA.sequence(4, 'Main Show', { { no = 1, parts = { { { g = 2 }, { g = 1 } } } } })
	MA.answer('"Main Show"', '', 'group')
	runPlugin()
	check(part(seq, 1).children[1].selection.no == 1, 'not sorted')
end)

test('defaults to the selected sequence, then remembers the last settings', function()
	local seq = MA.sequence(12, 'Main', { { no = 1, parts = { { { g = 1 } } } } })
	MA.selected = seq
	MA.answer('12', '1 Thru 5', 'name')
	runPlugin()
	local first = MA.log.dialogs[1]
	check(first.inputs[1].value == '12', 'selected sequence not prefilled: ' .. first.inputs[1].value)
	check(first.selectors[1].selectedValue == 1, 'default mode should be group')

	MA.cancel()
	runPlugin()
	local second = MA.log.dialogs[2]
	check(second.inputs[2].value == '1 Thru 5', 'cues not remembered')
	check(second.selectors[1].selectedValue == 3, 'mode not remembered')
end)

test('report lists counts', function()
	MA.sequence(1, 'Main', {
		{ no = 1, parts = { { { g = 2 }, { g = 1 } }, { { g = 1 } } } },
		{ no = 2, parts = { { { g = 1 }, { g = 2 } } } },
	})
	MA.answer('1', '', 'group')
	runPlugin()
	local message = MA.log.messages[1]
	check(message:find('5 Recipes in 3 Parts / 2 Cues', 1, true), message)
	check(message:find('1 Parts umsortiert', 1, true), message)
	check(not message:find('WARNUNG', 1, true) and not message:find('FEHLER', 1, true), message)
end)

-- ****************************************************************
-- v0.2: options
-- ****************************************************************

-- tag of a recipe line; separators show as '#' (with '!' if they are not disabled)
local function tag(r)
	if r.name == '#########' then
		return r.enabled == false and '#' or '#!'
	end
	return r.extra or '-'
end

local function message()
	return MA.log.messages[#MA.log.messages] or ''
end

test('delete empty: removes lines without group and preset', function()
	local seq = MA.sequence(1, 'Main', {
		{ no = 1, parts = { { { g = 2, extra = 'b' }, { extra = 'e1' }, { g = 1, extra = 'a' }, { sep = true }, { p = { 4, 1 }, extra = 'p' } } } },
	})
	MA.answer('1', '', 'group', { deleteEmpty = true })
	runPlugin()
	same(MA.column(part(seq, 1), tag), { 'a', 'b', 'p' })
	check(message():find('1 leere Recipes gelöscht', 1, true), message())
end)

test('separators: after every group block incl. the last, disabled, idempotent; other empty lines stay', function()
	local seq = MA.sequence(1, 'Main', {
		{
			no = 1,
			parts = {
				{
					{ g = 4, extra = 'g4' },
					{ extra = 'empty' },
					{ g = 1, extra = 'g1a' },
					{ p = { 4, 1 }, extra = 'nogroup' },
					{ g = 1, extra = 'g1b' },
				},
			},
		},
	})
	MA.answer('1', '', 'group', { separators = true })
	runPlugin()
	-- the plain empty line is no separator: it stays and sorts with the group-less recipes
	local expected = { 'g1a', 'g1b', '#', 'g4', '#', 'empty', 'nogroup', '#' }
	same(MA.column(part(seq, 1), tag), expected)
	check(message():find('3 Separatoren eingefügt', 1, true), message())
	-- second run: old separators are replaced, not duplicated
	MA.answer('1', '', 'group', { separators = true })
	runPlugin()
	same(MA.column(part(seq, 1), tag), expected, 'second run')
end)

test('separators: after every preset pool when sorting by preset', function()
	local seq = MA.sequence(1, 'Main', {
		{
			no = 1,
			parts = {
				{
					{ g = 1, p = { 4, 8 }, extra = '4.8' },
					{ g = 1, extra = 'none' },
					{ g = 1, p = { 1, 2 }, extra = '1.2' },
					{ g = 1, p = { 4, 4 }, extra = '4.4' },
					{ g = 1, p = { 2, 2 }, extra = '2.2' },
				},
			},
		},
	})
	MA.answer('1', '', 'preset', { separators = true })
	runPlugin()
	same(MA.column(part(seq, 1), tag), { '1.2', '#', '2.2', '#', '4.4', '4.8', '#', 'none', '#' })
end)

test('separators: only exact separators (disabled, "#########", empty) are replaced', function()
	local seq = MA.sequence(1, 'Main', {
		{
			no = 1,
			parts = {
				{
					{ g = 2, extra = 'g2' },
					{ sep = true },
					{ g = 1, extra = 'g1' },
					{ extra = 'enabled-hash', name = '#########' },
					{ g = 3, extra = 'hash-with-group', name = '#########' },
				},
			},
		},
	})
	-- make the look-alikes exact apart from one property each
	local recipes = MA.cue(seq, 1).children[1].children
	recipes[4].enabled = true
	recipes[5].enabled = false
	MA.answer('1', '', 'group', { separators = true })
	runPlugin()
	same(MA.column(part(seq, 1), function(r)
		if r.extra then
			return r.extra
		end
		return tag(r)
	end), { 'g1', '#', 'g2', '#', 'hash-with-group', '#', 'enabled-hash', '#' })
end)

test('separators: name sort adds none and removes old ones', function()
	local seq = MA.sequence(1, 'Main', {
		{ no = 1, parts = { { { g = 1, name = 'b', extra = 'b' }, { sep = true }, { g = 2, name = 'a', extra = 'a' }, { sep = true } } } },
	})
	MA.answer('1', '', 'name', { separators = true })
	runPlugin()
	same(MA.column(part(seq, 1), tag), { 'a', 'b' })
end)

test('split groups: every group gets a new part with the original timing', function()
	local seq = MA.sequence(1, 'Main', {
		{
			no = 1,
			timing = { cueinfade = 2, cueindelay = 1, cueoutfade = 'CueTiming', preset4fade = 3 },
			parts = {
				{
					{ g = 4, p = { 4, 4 }, extra = 'g4-color' },
					{ g = 1, extra = 'g1' },
					{ g = 7, extra = 'g7' },
					{ p = { 2, 2 }, extra = 'nogroup' },
					{ g = 4, p = { 2, 2 }, extra = 'g4-pos' },
				},
			},
		},
	})
	MA.answer('1', '', 'group', { splitGroups = true })
	runPlugin()
	local cue = MA.cue(seq, 1)
	check(#cue.children == 4, 'expected 4 parts, got ' .. #cue.children)
	same(MA.column(cue.children[1], tag), { 'nogroup' }, 'part 0 keeps recipes without group')
	same(MA.column(cue.children[2], tag), { 'g1' }, 'part 1')
	same(MA.column(cue.children[3], tag), { 'g4-color', 'g4-pos' }, 'part 2')
	same(MA.column(cue.children[4], tag), { 'g7' }, 'part 3')
	for i = 2, 4 do
		local p = cue.children[i]
		check(p.part == i - 1, 'part number ' .. tostring(p.part))
		check(p.cueinfade == 2 and p.cueindelay == 1 and p.cueoutfade == 'CueTiming' and p.preset4fade == 3, 'timing not copied')
	end
	check(message():find('3 neue Parts angelegt', 1, true), message())
end)

test('split again: parts holding a single group are left alone', function()
	local seq = MA.sequence(1, 'Main', {
		{ no = 1, parts = { { { g = 4, extra = 'g4' }, { g = 1, extra = 'g1' } } } },
	})
	MA.answer('1', '', 'group', { splitGroups = true })
	runPlugin()
	MA.answer('1', '', 'group', { splitGroups = true })
	runPlugin()
	local cue = MA.cue(seq, 1)
	check(#cue.children == 3, 'expected 3 parts after two runs, got ' .. #cue.children)
	same(MA.column(cue.children[1], tag), {}, 'part 0 stays empty')
	same(MA.column(cue.children[2], tag), { 'g1' }, 'part 1')
	same(MA.column(cue.children[3], tag), { 'g4' }, 'part 2')
	check(not message():find('neue Parts', 1, true), 'second run must not create parts: ' .. message())
end)

test('split presets: every preset pool gets a new part, numbered after existing parts', function()
	local seq = MA.sequence(1, 'Main', {
		{
			no = 1,
			parts = {
				{ { g = 1, p = { 4, 4 }, extra = 'c1' }, { g = 2, p = { 1, 2 }, extra = 'd' }, { g = 3, p = { 4, 8 }, extra = 'c2' } },
				{ { g = 9, extra = 'other-part' } },
			},
		},
	})
	MA.answer('1', '', 'preset', { splitPresets = true })
	runPlugin()
	local cue = MA.cue(seq, 1)
	same(MA.column(cue.children[1], tag), {}, 'part 0 ends up empty')
	same(MA.column(cue.children[2], tag), { 'other-part' }, 'existing part 1 (no preset) stays')
	same(MA.column(cue.children[3], tag), { 'd' }, 'new part for pool 1')
	same(MA.column(cue.children[4], tag), { 'c1', 'c2' }, 'new part for pool 4')
	check(cue.children[3].part == 2 and cue.children[4].part == 3, 'new parts should be 2 and 3')
end)

test('split + separators: each part ends with a separator', function()
	local seq = MA.sequence(1, 'Main', {
		{ no = 1, parts = { { { g = 2, extra = 'g2' }, { g = 1, extra = 'g1' } } } },
	})
	MA.answer('1', '', 'group', { splitGroups = true, separators = true })
	runPlugin()
	local cue = MA.cue(seq, 1)
	same(MA.column(cue.children[1], tag), {}, 'part 0')
	same(MA.column(cue.children[2], tag), { 'g1', '#' }, 'part 1')
	same(MA.column(cue.children[3], tag), { 'g2', '#' }, 'part 2')
end)

test('both split options: error and the dialog re-opens', function()
	local seq = MA.sequence(1, 'Main', { { no = 1, parts = { { { g = 2 }, { g = 1 } } } } })
	MA.answer('1', '', 'group', { splitGroups = true, splitPresets = true })
	MA.cancel()
	runPlugin()
	check(MA.log.messages[1]:find('nur eine Split', 1, true), tostring(MA.log.messages[1]))
	check(#MA.log.dialogs == 2, 'dialog should re-open')
	check(MA.log.undoOpened == 0, 'nothing must change')
end)

test('priority warning: overlapping groups with the same feature swapped', function()
	MA.fixtures(3, { 1, 2, 3, 4, 5, 6, 7, 8 })
	MA.fixtures(4, { 1, 2, 3, 4 })
	MA.sequence(1, 'Main', { { no = 1, parts = { { { g = 4, p = { 4, 4 } }, { g = 3, p = { 4, 8 } } } } } })
	MA.answer('1', '', 'group')
	runPlugin()
	check(message():find('Prioritäten geändert', 1, true), message())
	check(message():find('Group 4/Preset 4.4 <%-> Group 3/Preset 4.8'), message())
end)

test('priority warning: no warning for different features or disjoint fixtures', function()
	MA.fixtures(3, { 1, 2, 3, 4, 5, 6, 7, 8 })
	MA.fixtures(4, { 1, 2, 3, 4 })
	MA.sequence(1, 'Main', {
		-- same fixtures, different feature groups (Color vs Position)
		{ no = 1, parts = { { { g = 4, p = { 4, 4 } }, { g = 3, p = { 2, 2 } } } } },
		-- same feature, disjoint fixtures (group 1 has its own fixtures)
		{ no = 2, parts = { { { g = 4, p = { 4, 4 } }, { g = 1, p = { 4, 8 } } } } },
	})
	MA.answer('1', '', 'group')
	runPlugin()
	check(message():find('2 Parts umsortiert', 1, true), message())
	check(not message():find('Prioritäten', 1, true), message())
end)

test('priority warning: presets of the All pools count as every feature', function()
	MA.fixtures(3, { 1, 2, 3, 4, 5, 6, 7, 8 })
	MA.fixtures(4, { 1, 2, 3, 4 })
	MA.sequence(1, 'Main', { { no = 1, parts = { { { g = 4, p = { 2, 2 } }, { g = 3, p = { 21, 1 } } } } } })
	MA.answer('1', '', 'group')
	runPlugin()
	check(message():find('Prioritäten geändert', 1, true), message())
end)

test('options are remembered', function()
	MA.sequence(1, 'Main', { { no = 1, parts = { { { g = 1 } } } } })
	MA.answer('1', '', 'preset', { separators = true, splitGroups = true })
	runPlugin()
	MA.cancel()
	runPlugin()
	local states = {}
	for _, state in ipairs(MA.log.dialogs[2].states) do
		states[state.name] = state.state
	end
	check(states['Separatoren einfügen'] == true, 'separators not remembered')
	check(states['Split: Groups in Parts'] == true, 'split not remembered')
	check(states['Leere Recipes löschen'] == false, 'delete empty should be off')
end)

-- ****************************************************************

local failures = 0
for _, t in ipairs(tests) do
	MA.reset()
	local ok, err = pcall(t.fn)
	if ok then
		print('  ok   ' .. t.name)
	else
		failures = failures + 1
		print('  FAIL ' .. t.name .. '\n       ' .. tostring(err))
	end
end
print(string.format('\n%d tests, %d failed', #tests, failures))
return failures
