// ****************************************************************
// apply the new recipe order inside each part
// ****************************************************************

import {
	Footprint,
	SplitKind,
	cueNumber,
	footprintOf,
	footprintsOverlap,
	formatInt,
	SEPARATOR_NAME,
	isEmptyRecipe,
	isSeparator,
	partsOf,
	poolNumber,
	recipeKey,
	recipeLabel,
	recipesOf,
	splitKey,
} from './collect';
import { Keyed, SortKey, SortMode, blockEnds, isIdentity, sortedOrder, swappedPairs } from './sort';

export interface SortOptions {
	/** delete recipe lines without group and preset */
	deleteEmpty: boolean;
	/** separator line after every group block (group sort) or preset pool block (preset sort) */
	separators: boolean;
	/** move every group / preset pool into its own part */
	split: SplitKind | undefined;
}

export interface SortStats {
	cues: number;
	parts: number;
	recipes: number;
	/** parts whose recipe order changed */
	changedParts: number;
	/** parts that were already in the target state and were not touched at all */
	unchangedParts: number;
	deletedEmpty: number;
	separators: number;
	/** separators removed to be set anew (they don't count as "inserted" for the user) */
	replacedSeparators: number;
	newParts: number;
	/** "<part>: <recipe> ↔ <recipe>" for competing recipes that swapped order */
	priorityChanges: string[];
	/** parts whose recipes are still out of order after sorting (should stay empty) */
	unverifiedParts: string[];
}

export interface SortOutcome {
	stats: SortStats;
	error?: string;
}

/** Fade and delay properties a new part inherits from the part it was split from. */
const TIMING_PROPERTIES = ['CueInFade', 'CueInDelay', 'CueOutFade', 'CueOutDelay', 'SnapDelay'];
for (let preset = 1; preset <= 16; preset++) {
	TIMING_PROPERTIES.push(`Preset${preset}Fade`, `Preset${preset}Delay`);
}

/** Command-line address of a part, e.g. "Sequence 12 Cue 2.5 Part 0"; recipes are ".<n>". */
function partAddress(cue: Cue, part: Part): string {
	const partNo = (part.part as number | undefined) ?? part.index;
	return `Sequence ${formatInt(poolNumber(cue.Parent()))} Cue ${cueNumber(cue)} Part ${formatInt(partNo)}`;
}

/** Runs a command inside the undo group; commands (unlike Lua Copy/Delete) are undoable. */
function run(command: string, undo: UndoHandle): void {
	const result = Cmd(command, undo);
	if (result !== 'OK') error(`"${command}" failed: ${result}`);
}

/**
 * Moves recipes inside one part so the part matches `order`. `current` tracks which
 * logical item sits at each position and is updated in place.
 */
function applyOrder(address: string, current: number[], order: number[], undo: UndoHandle): void {
	order.forEach((wanted, target) => {
		const from = current.indexOf(wanted);
		if (from === target) return;
		// everything before `target` is final, so the recipe always moves up
		run(`Move ${address}.${from + 1} At ${address}.${target + 1}`, undo);
		current.splice(from, 1);
		current.splice(target, 0, wanted);
	});
}

/** A part after sorting: its address and the recipes (indices into the input list) it holds. */
interface PartLayout {
	part: Part;
	address: string;
	items: number[];
}

/**
 * Moves every group / preset pool into a new part with the original part's fade and delay
 * times. Recipes without one stay; the original part may end up empty. A part that already
 * holds exactly one group / pool (and nothing else) counts as split and is left alone, so
 * running the plugin again doesn't keep creating parts.
 */
function splitPart(
	cue: Cue,
	layout: PartLayout,
	keys: { key: number | undefined }[],
	undo: UndoHandle,
	stats: SortStats,
): PartLayout[] {
	const buckets = new Map<number, number[]>();
	for (const item of layout.items) {
		const key = keys[item].key;
		if (key === undefined) continue;
		const bucket = buckets.get(key) ?? [];
		bucket.push(item);
		buckets.set(key, bucket);
	}
	const splitKeys: number[] = [];
	for (const [key] of buckets) splitKeys.push(key);
	splitKeys.sort((a, b) => a - b);
	if (splitKeys.length === 0) return [layout];
	const alreadySplit =
		splitKeys.length === 1 && (buckets.get(splitKeys[0]) ?? []).length === layout.items.length;
	if (alreadySplit) return [layout];

	let nextPartNo = 0;
	for (const part of partsOf(cue)) {
		nextPartNo = Math.max(nextPartNo, ((part.part as number | undefined) ?? part.index) + 1);
	}

	const current = [...layout.items];
	const result: PartLayout[] = [];
	for (const key of splitKeys) {
		// Append (not "Store") so programmer values can never end up in the new part
		const newPart = cue.Append('Part', undo) as Part | undefined;
		if (newPart === undefined) error('could not create a new part');
		(newPart as unknown as { part: number }).part = nextPartNo++;
		for (const property of TIMING_PROPERTIES) {
			pcall(() => newPart.Set(property as never, layout.part.Get(property as never)));
		}
		const address = partAddress(cue, newPart);
		const items = buckets.get(key) ?? [];
		items.forEach((item, position) => {
			const from = current.indexOf(item);
			run(`Move ${layout.address}.${from + 1} At ${address}.${position + 1}`, undo);
			current.splice(from, 1);
		});
		result.push({ part: newPart, address, items });
		stats.newParts++;
	}
	return [{ ...layout, items: current }, ...result];
}

/** Block identity for separators: group number or preset pool; name sort has no blocks. */
function blockId(key: SortKey, mode: SortMode): number | undefined {
	if (key === undefined || typeof key === 'string') return undefined;
	return mode === 'group' || mode === 'preset' ? key[0] : undefined;
}

/** Inserts a disabled "#########" line after every block of a part. */
function insertSeparators(
	layout: PartLayout,
	keyed: Keyed[],
	mode: SortMode,
	undo: UndoHandle,
	stats: SortStats,
): void {
	const ends = blockEnds(
		layout.items,
		(a, b) => blockId(keyed[a].key, mode) === blockId(keyed[b].key, mode),
	);
	let count = layout.items.length;
	// back to front, so the positions of the remaining block ends stay valid
	for (let i = ends.length - 1; i >= 0; i--) {
		const separator = layout.part.Append('StandardRecipe', undo) as Recipe | undefined;
		if (separator === undefined) error('could not create a separator');
		separator.name = SEPARATOR_NAME;
		(separator as unknown as { enabled: boolean }).enabled = false;
		count++;
		const target = ends[i] + 2;
		if (target < count) run(`Move ${layout.address}.${count} At ${layout.address}.${target}`, undo);
		stats.separators++;
	}
}

/**
 * True when a part already looks exactly like the result would: nothing to delete, recipes
 * in order, nothing to split and separators exactly after every block. Such parts are not
 * touched at all, so a repeated run neither rewrites separators nor leaves an undo step.
 */
function isAlreadyDone(part: Part, mode: SortMode, options: SortOptions): boolean {
	const lines = recipesOf(part);
	const separatorLayout = options.separators;

	// lines the cleanup would delete for good
	const deletable = lines.filter(
		(recipe) =>
			options.deleteEmpty && isEmptyRecipe(recipe) && !(separatorLayout && isSeparator(recipe)),
	);
	if (deletable.length > 0) return false;

	const recipes = separatorLayout ? lines.filter((recipe) => !isSeparator(recipe)) : lines;
	const keyed = recipes.map((recipe) => ({ key: recipeKey(recipe, mode) }));
	if (!isIdentity(sortedOrder(keyed))) return false;

	if (options.split !== undefined) {
		const kind = options.split;
		const splitKeys = new Map<number, boolean>();
		let withoutKey = 0;
		for (const recipe of recipes) {
			const key = splitKey(recipe, kind);
			if (key === undefined) withoutKey++;
			else splitKeys.set(key, true);
		}
		// same rule as splitPart: nothing to split, or exactly one group / pool and nothing else
		if (splitKeys.size > 1 || (splitKeys.size === 1 && withoutKey > 0)) return false;
	}

	if (separatorLayout) {
		const expected: boolean[] = [];
		const ends =
			mode === 'name'
				? []
				: blockEnds(
						recipes.map((_, position) => position),
						(a, b) => blockId(keyed[a].key, mode) === blockId(keyed[b].key, mode),
					);
		recipes.forEach((_, position) => {
			expected.push(false);
			if (ends.includes(position)) expected.push(true);
		});
		if (expected.length !== lines.length) return false;
		if (!lines.every((recipe, position) => isSeparator(recipe) === expected[position])) {
			return false;
		}
	}
	return true;
}

function sortPart(
	cue: Cue,
	part: Part,
	mode: SortMode,
	options: SortOptions,
	undo: UndoHandle,
	stats: SortStats,
): void {
	const address = partAddress(cue, part);

	// 1. cleanup: "delete empty" removes every empty line (separators are empty too);
	//    the separator option alone only removes its own separators to set them anew
	if (options.deleteEmpty || options.separators) {
		const remove = recipesOf(part).filter((recipe) =>
			options.deleteEmpty ? isEmptyRecipe(recipe) : isSeparator(recipe),
		);
		for (let i = remove.length - 1; i >= 0; i--) {
			if (isSeparator(remove[i])) stats.replacedSeparators++;
			else stats.deletedEmpty++;
			run(`Delete ${address}.${remove[i].index} /nc`, undo);
		}
	}

	const recipes = recipesOf(part);
	stats.recipes += recipes.length;
	// keys are wrapped in objects: nil entries in a Lua array break `#` and everything using it
	const keyed = recipes.map((recipe) => ({ key: recipeKey(recipe, mode) }));
	const order = sortedOrder(keyed);
	const footprints: Footprint[] = recipes.map((recipe) => footprintOf(recipe));
	const labels = recipes.map((recipe) => recipeLabel(recipe));

	// 2. sort
	const current = recipes.map((_, position) => position);
	if (!isIdentity(order)) {
		applyOrder(address, current, order, undo);
		stats.changedParts++;
	}

	// 3. split into parts
	let layouts: PartLayout[] = [{ part, address, items: current }];
	if (options.split !== undefined) {
		const kind = options.split;
		const splitKeys = recipes.map((recipe) => ({ key: splitKey(recipe, kind) }));
		layouts = splitPart(cue, layouts[0], splitKeys, undo, stats);
	}

	// 4. warn when competing recipes (shared fixtures and feature group) swapped order
	const after: number[] = [];
	for (const layout of layouts) for (const item of layout.items) after.push(item);
	const before = recipes.map((_, position) => position);
	for (const [a, b] of swappedPairs(before, after)) {
		if (footprintsOverlap(footprints[a], footprints[b])) {
			stats.priorityChanges.push(`${address}: ${labels[a]} <-> ${labels[b]}`);
			break;
		}
	}

	// 5. separators
	if (options.separators && mode !== 'name') {
		for (const layout of layouts) insertSeparators(layout, keyed, mode, undo, stats);
	}

	// 6. read back: proves the moves landed where intended
	for (const layout of layouts) {
		const check = recipesOf(layout.part)
			.filter((recipe) => !(options.separators && isSeparator(recipe)))
			.map((recipe) => ({ key: recipeKey(recipe, mode) }));
		if (!isIdentity(sortedOrder(check))) stats.unverifiedParts.push(layout.address);
	}
}

export function sortCues(cues: Cue[], mode: SortMode, options: SortOptions): SortOutcome {
	const stats: SortStats = {
		cues: 0,
		parts: 0,
		recipes: 0,
		changedParts: 0,
		unchangedParts: 0,
		deletedEmpty: 0,
		separators: 0,
		replacedSeparators: 0,
		newParts: 0,
		priorityChanges: [],
		unverifiedParts: [],
	};

	// one undo step for the whole run → a single "Oops" reverts everything. It is only
	// opened once something changes, so a run with nothing to do leaves no empty Oops step.
	let undo: UndoHandle | undefined;
	const [ok, err] = pcall(() => {
		for (const cue of cues) {
			stats.cues++;
			// parts created by splitting are appended; only sort the parts that existed before
			for (const part of partsOf(cue)) {
				stats.parts++;
				if (isAlreadyDone(part, mode, options)) {
					stats.unchangedParts++;
					stats.recipes += recipesOf(part).filter(
						(recipe) => !(options.separators && isSeparator(recipe)),
					).length;
					continue;
				}
				undo ??= CreateUndo('Recipe Sorter');
				sortPart(cue, part, mode, options, undo, stats);
			}
		}
	});
	if (undo !== undefined) CloseUndo(undo);

	return ok ? { stats } : { stats, error: tostring(err) };
}
