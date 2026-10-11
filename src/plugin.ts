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

function report(display_handle: number, outcome: ReturnType<typeof sortCues>) {
	const { stats, error } = outcome;
	const lines = [
		`${stats.recipes} Recipes in ${stats.parts} Parts / ${stats.cues} Cues geprüft.`,
		`${stats.changedParts} Parts umsortiert.`,
	];
	if (stats.deletedEmpty > 0) lines.push(`${stats.deletedEmpty} leere Recipes gelöscht.`);
	if (stats.separators > 0) lines.push(`${stats.separators} Separatoren eingefügt.`);
	if (stats.newParts > 0) lines.push(`${stats.newParts} neue Parts angelegt.`);
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
