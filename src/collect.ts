// ****************************************************************
// resolve sequences / cues / parts / recipes and read sort keys
// ****************************************************************

import { SortKey, SortMode } from './sort';

// Own class guards instead of grandma3-toolkit's `is`: this project compiles calls into
// node_modules code as methods (`is:Cue(obj)`), but the toolkit's Lua functions take no
// `self`, so they would receive the `is` table instead of the object.
type ClassName = 'Sequence' | 'Cue' | 'Part' | 'Group' | 'Preset';
type ClassType = {
	Sequence: Sequence;
	Cue: Cue;
	Part: Part;
	Group: Group;
	Preset: Preset;
};

function isClass<C extends ClassName>(obj: GenericObj, className: C): obj is ClassType[C] {
	return obj.GetClass() === className;
}

function childrenOfClass<C extends ClassName>(parent: GenericObj, className: C): ClassType[C][] {
	return (parent.Children() as GenericObj[]).filter((obj): obj is ClassType[C] =>
		isClass(obj, className),
	);
}

/** Recipe lines report the class "StandardRecipe" in MA3 2.4, so match the suffix. */
function isRecipe(obj: GenericObj): obj is Recipe {
	return obj.GetClass().endsWith('Recipe');
}

/**
 * Every sequence also holds the internal cues "OffCue" (no number) and "CueZero" (number 0);
 * only real cues have a positive number.
 */
function isRealCue(obj: GenericObj): obj is Cue {
	if (!isClass(obj, 'Cue')) return false;
	const no = obj.no as number | undefined;
	return no !== undefined && no > 0;
}

/** Pool number ("no") of a pool object, falling back to its child index. */
export function poolNumber(obj: GenericObj): number {
	const [ok, no] = pcall(() => (obj as unknown as { no?: unknown }).no);
	return ok && typeof no === 'number' ? no : obj.index;
}

/** Integer formatting that never yields "12.0" (Lua floats would break MA syntax). */
export function formatInt(value: number): string {
	return string.format('%d', Math.floor(value));
}

/**
 * Cue number as typed in MA ("5", "2.5", "1.125"); `no` holds the cue number multiplied by
 * 1000. Built from integers so long cue numbers can't be rounded like with "%g".
 */
export function cueNumber(cue: Cue): string {
	const no = cue.no as number | undefined;
	if (no === undefined) return cue.name;
	const whole = formatInt(Math.floor(no / 1000));
	let fraction = string.format('%03d', Math.floor(no % 1000));
	while (fraction.endsWith('0')) fraction = fraction.substring(0, fraction.length - 1);
	return fraction === '' ? whole : `${whole}.${fraction}`;
}

function objectList(query: string): GenericObj[] {
	const [ok, list] = pcall(() => ObjectList<GenericObj>(query));
	if (!ok) return [];
	return (list as GenericObj[] | undefined) ?? [];
}

/** Resolves MA syntax like "1", "1 Thru 3 + 7" or "Main" to sequences. */
export function resolveSequences(input: string): Sequence[] {
	return objectList(`Sequence ${input}`).filter((obj): obj is Sequence => isClass(obj, 'Sequence'));
}

export function isAllCues(input: string): boolean {
	const trimmed = input.trim();
	return trimmed === '' || trimmed === '*';
}

/** Resolves MA syntax like "1 Thru 5 + 8" within one sequence; empty or "*" means all cues. */
export function resolveCues(sequence: Sequence, input: string): Cue[] {
	const cues = isAllCues(input)
		? (sequence.Children() as GenericObj[])
		: objectList(`Sequence ${formatInt(poolNumber(sequence))} Cue ${input.trim()}`);
	return cues.filter((obj) => isRealCue(obj));
}

export function partsOf(cue: Cue): Part[] {
	return childrenOfClass(cue, 'Part');
}

export function recipesOf(part: Part): Recipe[] {
	return (part.Children() as GenericObj[]).filter((obj) => isRecipe(obj));
}

export function recipeKey(recipe: Recipe, mode: SortMode): SortKey {
	switch (mode) {
		case 'group': {
			const group = recipe.selection as GenericObj | undefined;
			return group !== undefined && isClass(group, 'Group') ? [poolNumber(group)] : undefined;
		}
		case 'preset': {
			const preset = recipe.values as GenericObj | undefined;
			return preset !== undefined && isClass(preset, 'Preset')
				? [poolNumber(preset.Parent()), poolNumber(preset)]
				: undefined;
		}
		case 'name': {
			// unnamed recipes report a default name like "StandardRecipe 2" (class + position)
			const name = recipe.name as string | undefined;
			const defaultName = `${recipe.GetClass()} ${recipe.index}`;
			return name !== undefined && name !== '' && name !== defaultName ? name : undefined;
		}
	}
}

function groupOf(recipe: Recipe): Group | undefined {
	const group = recipe.selection as GenericObj | undefined;
	return group !== undefined && isClass(group, 'Group') ? group : undefined;
}

function presetOf(recipe: Recipe): Preset | undefined {
	const preset = recipe.values as GenericObj | undefined;
	return preset !== undefined && isClass(preset, 'Preset') ? preset : undefined;
}

/** "Empty" recipe lines have neither a group nor a preset; separators are empty lines. */
export function isEmptyRecipe(recipe: Recipe): boolean {
	return recipe.selection === undefined && recipe.values === undefined;
}

export type SplitKind = 'groups' | 'presets';

/** Number of the part a recipe goes to when splitting: group number or preset pool number. */
export function splitKey(recipe: Recipe, kind: SplitKind): number | undefined {
	if (kind === 'groups') {
		const group = groupOf(recipe);
		return group !== undefined ? poolNumber(group) : undefined;
	}
	const preset = presetOf(recipe);
	return preset !== undefined ? poolNumber(preset.Parent()) : undefined;
}

/** Short label for messages, e.g. "Group 4/Preset 4.4". */
export function recipeLabel(recipe: Recipe): string {
	const group = groupOf(recipe);
	const preset = presetOf(recipe);
	const parts: string[] = [];
	if (group !== undefined) parts.push(`Group ${formatInt(poolNumber(group))}`);
	if (preset !== undefined) {
		parts.push(`Preset ${formatInt(poolNumber(preset.Parent()))}.${formatInt(poolNumber(preset))}`);
	}
	return parts.length > 0 ? parts.join('/') : recipe.name;
}

/**
 * What a recipe line controls: the subfixtures of its group and the feature group of its
 * preset. `true` stands for "unknown, assume everything".
 */
export interface Footprint {
	fixtures: Map<number, boolean> | true;
	features: string | true | undefined;
}

export function footprintOf(recipe: Recipe): Footprint {
	const group = groupOf(recipe);
	let fixtures: Map<number, boolean> | true = new Map();
	if (group !== undefined) {
		// property names are case-insensitive in MA; lower case is what was verified in onPC
		const [ok, data] = pcall(
			() => (group as unknown as { selectiondata?: FixtureSelectionData[] }).selectiondata,
		);
		if (ok && data !== undefined) {
			const set = new Map<number, boolean>();
			for (const entry of data) set.set(entry.sf_index, true);
			fixtures = set;
		} else {
			fixtures = true;
		}
	}

	const preset = presetOf(recipe);
	let features: string | true | undefined;
	if (preset !== undefined) {
		// presets of the "All" pools report an empty feature group: they can hold anything
		const [ok, featureGroup] = pcall(
			() => (preset as unknown as { featuregroup?: unknown }).featuregroup,
		);
		features = ok && typeof featureGroup === 'string' && featureGroup !== '' ? featureGroup : true;
	} else {
		const [ok, ownData] = pcall(
			() => (recipe as unknown as { owndatapresent?: unknown }).owndatapresent,
		);
		features = ok && ownData === true ? true : undefined;
	}
	return { fixtures, features };
}

/** Two recipe lines compete when they share a subfixture and a feature group. */
export function footprintsOverlap(a: Footprint, b: Footprint): boolean {
	if (a.features === undefined || b.features === undefined) return false;
	if (a.features !== true && b.features !== true && a.features !== b.features) return false;
	if (a.fixtures === true || b.fixtures === true) return true;
	for (const [fixture] of a.fixtures) {
		if (b.fixtures.has(fixture)) return true;
	}
	return false;
}
