import { isAllCues, resolveCues, resolveSequences } from './collect';
import { askForRequest, loadSettings, saveSettings, showMessage } from './dialog';
import { sortCues } from './reorder';

const [pluginName, componentName, signalTable, my_handle] = [...$vararg] as EnvArgs;

const TITLE = 'Recipe Sorter';
const MAX_LISTED = 8;

// ****************************************************************
// plugin main entry point
// ****************************************************************
function Main(display_handle: number, argument: any) {
	let request = loadSettings();

	// re-open the dialog with the entered values until the input resolves or is cancelled
	while (true) {
		const answer = askForRequest(display_handle, request);
		if (answer === undefined) return;
		request = answer;

		if (request.splitConflict) {
			showMessage(display_handle, TITLE, 'Bitte nur eine Split-Option wählen.');
			continue;
		}

		if (request.sequences === '') {
			showMessage(display_handle, TITLE, 'Bitte mindestens eine Sequence angeben.');
			continue;
		}

		const sequences = resolveSequences(request.sequences);
		if (sequences.length === 0) {
			showMessage(display_handle, TITLE, `Keine Sequence gefunden für "${request.sequences}".`);
			continue;
		}

		const cues: Cue[] = [];
		for (const sequence of sequences) {
			for (const cue of resolveCues(sequence, request.cues)) cues.push(cue);
		}
		if (cues.length === 0) {
			const cueText = isAllCues(request.cues) ? 'alle' : `"${request.cues}"`;
			showMessage(display_handle, TITLE, `Keine Cues gefunden (Cues: ${cueText}).`);
			continue;
		}

		saveSettings(request);
		report(display_handle, sortCues(cues, request.mode, request.options));
		return;
	}
}

function count(n: number, singular: string, plural: string): string {
	return `${n} ${n === 1 ? singular : plural}`;
}

function report(display_handle: number, outcome: ReturnType<typeof sortCues>) {
	const { stats, error } = outcome;
	const lines = [
		`${count(stats.recipes, 'Recipe', 'Recipes')} in ${count(stats.parts, 'Part', 'Parts')} / ${count(stats.cues, 'Cue', 'Cues')} geprüft.`,
	];
	if (stats.unchangedParts === stats.parts && error === undefined) {
		lines.push('Alles war bereits sortiert, nichts geändert.');
	} else {
		lines.push(
			stats.changedParts > 0
				? `Reihenfolge in ${stats.changedParts} von ${count(stats.parts, 'Part', 'Parts')} geändert.`
				: 'Reihenfolge war bereits korrekt.',
		);
		if (stats.deletedEmpty > 0) {
			lines.push(`${count(stats.deletedEmpty, 'leere Recipe', 'leere Recipes')} gelöscht.`);
		}
		if (stats.separators > 0 && stats.replacedSeparators === 0) {
			lines.push(`${count(stats.separators, 'Separator', 'Separatoren')} eingefügt.`);
		} else if (stats.separators > 0 || stats.replacedSeparators > 0) {
			lines.push(
				`Separatoren neu gesetzt: ${stats.separators} (vorher ${stats.replacedSeparators}).`,
			);
		}
		if (stats.newParts > 0) {
			lines.push(`${count(stats.newParts, 'neuer Part', 'neue Parts')} angelegt.`);
		}
	}
	if (stats.priorityChanges.length > 0) {
		const shown = stats.priorityChanges.slice(0, MAX_LISTED);
		lines.push('', 'WARNUNG: Prioritäten geändert! Recipes mit gemeinsamen Fixtures und');
		lines.push('Attributen haben die Reihenfolge getauscht, der Look kann sich ändern:');
		shown.forEach((change) => lines.push(`  ${change}`));
		const hidden = stats.priorityChanges.length - shown.length;
		if (hidden > 0) lines.push(`  ... und ${hidden} weitere`);
		lines.push('Mit "Oops" rückgängig machen.');
	}
	if (stats.unverifiedParts.length > 0) {
		lines.push('', 'WARNUNG: Reihenfolge nach dem Sortieren nicht korrekt in:');
		stats.unverifiedParts.forEach((label) => lines.push(`  ${label}`));
		lines.push('Mit "Oops" rückgängig machen.');
	}
	if (error !== undefined) {
		lines.push('', `FEHLER: ${error}`, 'Mit "Oops" rückgängig machen.');
	}

	const message = lines.join('\n');
	Printf(`${TITLE}: ${message}`);
	showMessage(display_handle, TITLE, message);
}

export = [Main];
