# Recipe Sorter

grandMA3-Plugin, das die Recipe Lines in Cues sortiert — nach **Group-Nummer**, **Preset-Nummer** oder **Recipe-Name**.

Gebaut auf Basis des [grandMA3-plugin-starter](https://github.com/LightYourWay/grandMA3-plugin-starter) (TypeScript → Lua via TypeScriptToLua). Ziel-Version: grandMA3 2.4.2.2.

## Bedienung

Plugin starten → es öffnet sich ein Pop-up:

| Feld | Bedeutung |
| --- | --- |
| **Sequence(s)** | Eine oder mehrere Sequences in MA-Syntax, z. B. `12`, `1 Thru 3 + 7` oder `"Main Show"` |
| **Cues** | Cues in MA-Syntax, z. B. `1 Thru 5 + 8`. Leer oder `*` = alle Cues |
| **Sortieren nach** | `Group (1-9)`, `Preset (1-9)` oder `Name (A-Z)` |

Optionen (Checkboxen, alle frei kombinierbar außer den beiden Split-Optionen):

| Option | Wirkung |
| --- | --- |
| **Leere Recipes löschen** | Löscht Recipe Lines ohne Group **und** ohne Preset. |
| **Separatoren einfügen** | Fügt nach jedem Block eine deaktivierte Zeile `#########` ein, auch nach dem letzten Block. Block = gleiche Group (Group-Sortierung) bzw. gleicher Preset-Pool (Preset-Sortierung); bei Name-Sortierung gibt es keine Separatoren. Leere Zeilen gelten als Separatoren und werden bei jedem Lauf entfernt und neu gesetzt. |
| **Split: Groups in Parts** | Jede Group bekommt einen eigenen Part. Die erste Group (und Recipes ohne Group) bleiben im ursprünglichen Part, jede weitere Group kommt in einen neuen Part. |
| **Split: Preset-Pools in Parts** | Wie oben, aber pro Preset-Pool. |

Neue Parts bekommen die Fade- und Delay-Zeiten des ursprünglichen Parts (Cue In/Out Fade/Delay, Snap Delay, Preset-Zeiten) und die nächste freie Part-Nummer. Sie werden per Lua angelegt, nicht per `Store`, damit keine Programmer-Werte hineingeraten.

Beim ersten Start ist die selektierte Sequence vorbelegt, danach jeweils die zuletzt benutzten Einstellungen. Findet das Plugin keine Sequence oder keine Cues, erscheint eine Meldung und das Pop-up öffnet sich mit den eingegebenen Werten erneut.

Zum Schluss zeigt eine Meldung, wie viele Recipes, Parts und Cues geprüft und wie viele Parts umsortiert wurden, sowie gelöschte Recipes, eingefügte Separatoren und neue Parts (auch im Command Line Feedback). Mit Please wird die Meldung bestätigt.

### Prioritäts-Warnung

Die Reihenfolge der Recipes bestimmt, welche bei überlappenden Attributen gewinnt (die spätere überschreibt die frühere). Recipes verschiedener Groups dürfen beim Sortieren die Plätze tauschen. Tauschen dabei zwei Recipes, die sich **Fixtures** (aus den Groups) und **Attribute** (Feature Group des Presets, z. B. Color) teilen, warnt die Abschlussmeldung mit dem betroffenen Part und den beiden Recipes. Presets aus den All-Pools zählen als „alle Attribute“.

## Sortierregeln

- **Group:** aufsteigend nach Group-Nummer.
- **Preset:** erst nach Preset-Pool-Nummer, dann nach Preset-Nummer: `2.5 < 2.10 < 4.1 < 4.12 < 21.3`.
- **Name:** Recipe-Name A–Z, ohne Groß-/Kleinschreibung, Zahlen nach Wert (`Front 2 < Front 10`).
- Recipes **ohne** Group / Preset / Name kommen ans Ende.
- **Stabil:** Recipes mit gleichem Wert behalten ihre bisherige Reihenfolge.
- Jeder **Part** wird für sich sortiert; Recipes wandern nur bei den Split-Optionen zwischen Parts.
- Bereits sortierte Parts werden nicht umsortiert.

## Undo

Der komplette Lauf ist **ein** Undo-Schritt — ein einziges `Oops` macht die Sortierung rückgängig.

Technisch verschiebt und löscht das Plugin die Recipes mit den MA-Befehlen `Move` und `Delete` (z. B. `Move Sequence 12 Cue 2.5 Part 0.4 At Sequence 12 Cue 2.5 Part 0.1`). Die Recipe-Objekte bleiben dabei unverändert, es kann also keine Property (MAtricks, Filter, …) verloren gehen. Anders als die Lua-Objekt-API (`Copy`/`Delete`) landen Befehle zuverlässig im Undo. Nach dem Sortieren liest das Plugin die Reihenfolge zur Kontrolle zurück und warnt, falls ein Part nicht korrekt sortiert ist.

Neue Parts und Separatoren entstehen per Lua `Append` mit Undo-Handle; auch das nimmt `Oops` zurück.

Die Einstellungen werden pro Benutzer in den User-Variablen gespeichert (`RecipeSorterSequences`, `RecipeSorterCues`, `RecipeSorterMode`, `RecipeSorterOptions`).

## Getestet

- End-to-End in **grandMA3 onPC 2.4.2.2** (macOS): alle drei Sortierungen, mehrere Sequences, Cue-Bereiche mit Kommastellen, mehrere Parts, ein `Oops` für den ganzen Lauf, gemerkte Einstellungen, Fehlermeldungen. Die Optionen (leere Recipes, Separatoren, Split in Parts inkl. Timing) und die Prioritäts-Warnung wurden mit den Groups und Presets der MA-Demoshow getestet.
- Automatisiert mit `npm test` gegen einen Mock, der das in onPC beobachtete Verhalten nachbildet (Klasse `StandardRecipe`, Standardnamen unbenannter Recipes, interne Cues `OffCue`/`CueZero`, `Move`-Semantik).

## Entwicklung

```bash
npm install
npm run dev       # bauen + bei Änderungen neu bauen
npm run build     # dist/recipe-sorter.lua + dist/recipe-sorter.xml
npm test          # bauen + Tests gegen eine nachgebaute MA3-API (Lua 5.4 via wasmoon)
npm run package   # release/recipe-sorter_v<version>.zip
```

| Datei            | Inhalt                                                         |
| ---------------- | -------------------------------------------------------------- |
| `src/plugin.ts`  | Einstiegspunkt: Dialog → Cues auflösen → sortieren → Meldung   |
| `src/dialog.ts`  | Pop-up und gemerkte Einstellungen                              |
| `src/collect.ts` | Sequences/Cues/Parts/Recipes auflösen, Sortierschlüssel lesen  |
| `src/sort.ts`    | Vergleichslogik (ohne MA-API)                                  |
| `src/reorder.ts` | Umsortieren per `Move`-Befehl, Undo, Statistik                 |
| `test/`          | Mock der MA3-API und End-to-End-Tests des kompilierten Plugins |

## Import in grandMA3

Den Projektordner (bzw. den entpackten Release-Ordner) nach `gma3_library/datapools/plugins/` legen und das Plugin über den Import-Dialog im Plugin-Pool importieren.
