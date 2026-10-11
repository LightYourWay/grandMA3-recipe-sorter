// ****************************************************************
// pop-up dialog and remembered settings
// ****************************************************************

import { formatInt, poolNumber } from './collect';
import { SortOptions } from './reorder';
import { SortMode } from './sort';

export interface SortRequest {
	sequences: string;
	cues: string;
	mode: SortMode;
	options: SortOptions;
	/** both split options were ticked — they exclude each other */
	splitConflict: boolean;
}

const MODES: SortMode[] = ['group', 'preset', 'name'];
const MODE_LABELS: Record<SortMode, string> = {
	group: 'Group (1-9)',
	preset: 'Preset (1-9)',
	name: 'Name (A-Z)',
};

// MA lists inputs alphabetically, the numbers keep them in this order
const INPUT_SEQUENCES = '1. Sequence(s)';
const INPUT_CUES = '2. Cues (leer = alle)';
const SELECTOR_MODE = 'Sortieren nach';

// checkboxes; MA lists them alphabetically as well
const STATE_DELETE_EMPTY = 'Leere Recipes löschen';
const STATE_SEPARATORS = 'Separatoren einfügen';
const STATE_SPLIT_GROUPS = 'Split: Groups in Parts';
const STATE_SPLIT_PRESETS = 'Split: Preset-Pools in Parts';

const COMMAND_CANCEL = 0;
const COMMAND_SORT = 1;

// ****************************************************************
// settings — remembered per user in the user variables
// (PluginVars() returns nil in MA3 2.4, so they can't be used)
// ****************************************************************

const VAR_PREFIX = 'RecipeSorter';

function readVar(key: string): string | undefined {
	const [ok, value] = pcall(() => GetVar(UserVars(), VAR_PREFIX + key));
	return ok && typeof value === 'string' ? value : undefined;
}

export function loadSettings(): SortRequest {
	const selected = SelectedSequence();
	const savedMode = readVar('Mode') as SortMode | undefined;
	const flags = readVar('Options') ?? '';
	const has = (flag: string) => flags.split(',').includes(flag);
	return {
		sequences:
			readVar('Sequences') ?? (selected !== undefined ? formatInt(poolNumber(selected)) : ''),
		cues: readVar('Cues') ?? '',
		mode: savedMode !== undefined && MODES.includes(savedMode) ? savedMode : 'group',
		options: {
			deleteEmpty: has('deleteEmpty'),
			separators: has('separators'),
			split: has('splitGroups') ? 'groups' : has('splitPresets') ? 'presets' : undefined,
		},
		splitConflict: false,
	};
}

export function saveSettings(request: SortRequest): void {
	pcall(() => {
		const vars = UserVars();
		SetVar(vars, VAR_PREFIX + 'Sequences', request.sequences);
		SetVar(vars, VAR_PREFIX + 'Cues', request.cues);
		SetVar(vars, VAR_PREFIX + 'Mode', request.mode);
		const flags: string[] = [];
		if (request.options.deleteEmpty) flags.push('deleteEmpty');
		if (request.options.separators) flags.push('separators');
		if (request.options.split === 'groups') flags.push('splitGroups');
		if (request.options.split === 'presets') flags.push('splitPresets');
		SetVar(vars, VAR_PREFIX + 'Options', flags.join(','));
	});
}

// ****************************************************************
// dialogs
// ****************************************************************

export function showMessage(display: number, title: string, message: string): void {
	MessageBox({
		title,
		message,
		display,
		commands: [{ value: 1, name: 'OK' }],
	});
}

/** Shows the sort dialog prefilled with `initial`. Returns undefined when cancelled. */
export function askForRequest(display: number, initial: SortRequest): SortRequest | undefined {
	const modeValues: Record<string, number> = {};
	MODES.forEach((mode, index) => {
		modeValues[MODE_LABELS[mode]] = index + 1;
	});

	const result = MessageBox({
		title: 'Recipe Sorter',
		message:
			'Sortiert die Recipe Lines der gewählten Cues.\nMA-Syntax erlaubt, z. B. "1 Thru 5 + 8".',
		display,
		commands: [
			{ value: COMMAND_SORT, name: 'Sortieren' },
			{ value: COMMAND_CANCEL, name: 'Abbrechen' },
		],
		inputs: [
			{ name: INPUT_SEQUENCES, value: initial.sequences, blackFilter: ';' },
			{ name: INPUT_CUES, value: initial.cues, blackFilter: ';' },
		],
		states: [
			{ name: STATE_DELETE_EMPTY, state: initial.options.deleteEmpty },
			{ name: STATE_SEPARATORS, state: initial.options.separators },
			{ name: STATE_SPLIT_GROUPS, state: initial.options.split === 'groups' },
			{ name: STATE_SPLIT_PRESETS, state: initial.options.split === 'presets' },
		],
		selectors: [
			{
				name: SELECTOR_MODE,
				selectedValue: MODES.indexOf(initial.mode) + 1,
				values: modeValues,
				type: 1,
			},
		],
	});

	if (!result.success || result.result !== COMMAND_SORT) return undefined;

	const selected = result.selectors[SELECTOR_MODE] ?? 1;
	const states = result.states ?? {};
	const splitGroups = states[STATE_SPLIT_GROUPS] === true;
	const splitPresets = states[STATE_SPLIT_PRESETS] === true;
	return {
		sequences: (result.inputs[INPUT_SEQUENCES] ?? '').trim(),
		cues: (result.inputs[INPUT_CUES] ?? '').trim(),
		mode: MODES[selected - 1] ?? 'group',
		options: {
			deleteEmpty: states[STATE_DELETE_EMPTY] === true,
			separators: states[STATE_SEPARATORS] === true,
			split: splitGroups ? 'groups' : splitPresets ? 'presets' : undefined,
		},
		splitConflict: splitGroups && splitPresets,
	};
}
