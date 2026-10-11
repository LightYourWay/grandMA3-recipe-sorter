// ****************************************************************
// pure sorting logic — no grandMA3 API in here
// ****************************************************************

export type SortMode = 'group' | 'preset' | 'name';

/**
 * Sort key of a single recipe line.
 * - numbers: compared element by element (e.g. [pool, preset] for presets)
 * - string:  compared case-insensitively with natural number ordering
 * - undefined: recipe has no value for the chosen criterion → sorted to the end
 */
export type SortKey = number[] | string | undefined;

function isDigit(charCode: number): boolean {
	return charCode >= 48 && charCode <= 57;
}

function stripLeadingZeros(digits: string): string {
	let i = 0;
	while (i < digits.length - 1 && digits.charCodeAt(i) === 48) i++;
	return digits.substring(i);
}

/** Case-insensitive compare where digit runs compare by value ("Front 2" < "Front 10"). */
export function naturalCompare(a: string, b: string): number {
	const x = a.toLowerCase();
	const y = b.toLowerCase();
	let i = 0;
	let j = 0;
	while (i < x.length && j < y.length) {
		const cx = x.charCodeAt(i);
		const cy = y.charCodeAt(j);
		if (isDigit(cx) && isDigit(cy)) {
			let endX = i;
			while (endX < x.length && isDigit(x.charCodeAt(endX))) endX++;
			let endY = j;
			while (endY < y.length && isDigit(y.charCodeAt(endY))) endY++;
			// compare as digit strings so long numbers can't overflow
			const nx = stripLeadingZeros(x.substring(i, endX));
			const ny = stripLeadingZeros(y.substring(j, endY));
			if (nx.length !== ny.length) return nx.length - ny.length;
			if (nx !== ny) return nx < ny ? -1 : 1;
			i = endX;
			j = endY;
		} else {
			if (cx !== cy) return cx - cy;
			i++;
			j++;
		}
	}
	return x.length - i - (y.length - j);
}

function compareNumbers(a: number[], b: number[]): number {
	const length = Math.min(a.length, b.length);
	for (let i = 0; i < length; i++) {
		if (a[i] !== b[i]) return a[i] - b[i];
	}
	return a.length - b.length;
}

export function compareKeys(a: SortKey, b: SortKey): number {
	if (a === undefined || b === undefined) {
		if (a === b) return 0;
		return a === undefined ? 1 : -1;
	}
	if (typeof a === 'string' && typeof b === 'string') return naturalCompare(a, b);
	if (typeof a !== 'string' && typeof b !== 'string') return compareNumbers(a, b);
	// mixed key types never happen within one sort run
	return 0;
}

/**
 * A sort key wrapped in an object. Keys can be undefined, and undefined (nil) entries in a
 * Lua array leave holes: `#` then reports an arbitrary border and part of the list is lost.
 */
export interface Keyed {
	key: SortKey;
}

/**
 * Returns the new order as a list of original positions (0-based).
 * Stable: recipes with equal keys keep their current relative order.
 */
export function sortedOrder(items: Keyed[]): number[] {
	const positions = items.map((_, position) => position);
	positions.sort((a, b) => {
		// no `||` fallback here: 0 is truthy in Lua
		const result = compareKeys(items[a].key, items[b].key);
		return result !== 0 ? result : a - b;
	});
	return positions;
}

export function isIdentity(order: number[]): boolean {
	return order.every((position, index) => position === index);
}
