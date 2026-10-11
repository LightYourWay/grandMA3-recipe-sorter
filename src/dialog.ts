// ****************************************************************
// pop-up dialog and remembered settings
// ****************************************************************

import { formatInt, poolNumber } from './collect';
import { SortMode } from './sort';

export interface SortRequest {
	sequences: string;
	cues: string;
	mode: SortMode;
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
	return {
		sequences:
			readVar('Sequences') ?? (selected !== undefined ? formatInt(poolNumber(selected)) : ''),
		cues: readVar('Cues') ?? '',
		mode: savedMode !== undefined && MODES.includes(savedMode) ? savedMode : 'group',
	};
}

export function saveSettings(request: SortRequest): void {
	pcall(() => {
		const vars = UserVars();
		SetVar(vars, VAR_PREFIX + 'Sequences', request.sequences);
		SetVar(vars, VAR_PREFIX + 'Cues', request.cues);
		SetVar(vars, VAR_PREFIX + 'Mode', request.mode);
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
	return {
		sequences: (result.inputs[INPUT_SEQUENCES] ?? '').trim(),
		cues: (result.inputs[INPUT_CUES] ?? '').trim(),
		mode: MODES[selected - 1] ?? 'group',
	};
}
