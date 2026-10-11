// ****************************************************************
// apply the new recipe order inside each part
// ****************************************************************

import { cueNumber, formatInt, partsOf, poolNumber, recipeKey, recipesOf } from './collect';
import { SortMode, isIdentity, sortedOrder } from './sort';

export interface SortStats {
	cues: number;
	parts: number;
	recipes: number;
	changedParts: number;
	/** parts whose recipes are still out of order after sorting (should stay empty) */
	unverifiedParts: string[];
}

export interface SortOutcome {
	stats: SortStats;
	error?: string;
}

/** Command-line address of a part, e.g. "Sequence 12 Cue 2.5 Part 0"; recipes are ".<n>". */
function partAddress(sequence: Sequence, cue: Cue, part: Part): string {
	const partNo = (part.part as number | undefined) ?? part.index;
	return `Sequence ${formatInt(poolNumber(sequence))} Cue ${cueNumber(cue)} Part ${formatInt(partNo)}`;
}

/**
 * Reorders the recipes of one part with the MA "Move" command. Moving keeps every recipe
 * object intact (no property can get lost) and, unlike the Lua object API (Copy/Delete),
 * commands are recorded in the undo handle.
 */
function applyOrder(address: string, order: number[], undo: UndoHandle): void {
	// current[position] = original position of the recipe that sits there now
	const current = order.map((_, position) => position);
	order.forEach((wanted, target) => {
		const from = current.indexOf(wanted);
		if (from === target) return;
		// everything before `target` is final, so the recipe always moves up
		const result = Cmd(`Move ${address}.${from + 1} At ${address}.${target + 1}`, undo);
		if (result !== 'OK') error(`"Move ${address}.${from + 1}" failed: ${result}`);
		current.splice(from, 1);
		current.splice(target, 0, wanted);
	});
}

export function sortCues(cues: Cue[], mode: SortMode): SortOutcome {
	const stats: SortStats = { cues: 0, parts: 0, recipes: 0, changedParts: 0, unverifiedParts: [] };

	// one undo step for the whole run → a single "Oops" reverts everything
	const undo = CreateUndo('Recipe Sorter');
	const [ok, err] = pcall(() => {
		for (const cue of cues) {
			stats.cues++;
			for (const part of partsOf(cue)) {
				const recipes = recipesOf(part);
				stats.parts++;
				stats.recipes += recipes.length;

				const order = sortedOrder(recipes.map((recipe) => ({ key: recipeKey(recipe, mode) })));
				if (isIdentity(order)) continue;

				const address = partAddress(cue.Parent(), cue, part);
				applyOrder(address, order, undo);
				stats.changedParts++;

				// read back: proves the moves landed where intended
				const after = recipesOf(part).map((recipe) => ({ key: recipeKey(recipe, mode) }));
				if (!isIdentity(sortedOrder(after))) stats.unverifiedParts.push(address);
			}
		}
	});
	CloseUndo(undo);

	return ok ? { stats } : { stats, error: tostring(err) };
}
