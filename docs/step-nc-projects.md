# OpenSpindle STEP-NC project files

OpenSpindle saves projects as ISO 10303-21 text (`.stpnc`) using a small documentary profile of the AP238:2020 entity model. The file contains a machining project, ordered workplans, original NC source documents, and application properties that preserve the OpenSpindle project for reopening.

This is an archive and round-trip profile. It does **not** convert arbitrary G-code into portable STEP-NC machining features, operations, or toolpaths. No AP238 conformance class or external controller compatibility is claimed. Opening a project restores the workspace; it does not execute the NC programs. The importer supports this OpenSpindle profile, not arbitrary STEP-NC files from other applications.

## Usage

Choose **File › New Project** (⌘N) to start a new project, **File › Save Project…** (⌘S) to save the current workspace, or **File › Open Project…** (⌘O) to reopen it. Dropping a single project file on the window, or opening a `.stpnc` file from Finder, opens it too.

**File › Import…** (⇧⌘O) imports an NC program, as dropping NC files on the window or opening them with OpenSpindle from Finder does. Programs go to the selected plate, or to a new plate set up as the first one describes (the stock its markers give: OpenSpindle's, with where the stock sits, the work origin on it and the device's fixtures that hold it ([Fusion 360](fusion360.md#stock-and-fixtures)), else Makera CAM's; or the setup made on the empty plate it replaces). A plate without a name takes the first program's: its Fusion NC program's name, else its file's name without the extension. When a program splits into operations by tool or toolpath, or holds what its machine would not run as written ([program rules](design-rules.md#program-rules)), a dialog first asks which plate it goes to, how to split it and how to fix it; closing it imports nothing. An import can be undone in one step. An OpenSpindle NC export comes in as a plate of its own, with its setup. **File › Import from Fusion 360** opens the connected program picker ([Fusion 360](fusion360.md)).

OpenSpindle starts with a new, empty project every time it opens; a project is kept only by saving it. The tool and stock libraries are the app's own: a saved project carries a copy of them, and opening one keeps yours, adding the tools its plates use that yours lacks (a tool you have stays as you have it). Before replacing a project with unsaved changes, or closing the window with them, choose **Save**, **Don't save**, or **Cancel**. OpenSpindle validates the incoming project before replacing the workspace; an invalid file leaves the current project intact. Opening restores saved workspace data without connecting to a device or executing a program.

## Two layers and their versions

A project file has two layers, versioned independently:

- The **container** is the ISO 10303-21 file described below: its header, the documentary AP238 graph with each operation's exact NC text, and the application payload stored inside it. Its profile, named in `FILE_DESCRIPTION`, is `OpenSpindle STEP-NC project archive v1`. The container does not interpret the payload. It is implemented in `src/formats/project/step-nc.ts`.
- The **project document** is the application payload: JSON whose `schemaVersion` names the project format. The current format is **version 10** (`src/formats/project/document.ts`).

`encodeProject` in `src/formats/project/project.ts` writes version 10 and `decodeProject` reads versions 4 through 10, upgrading older operation sources, bed positions and probing strategies as described below. When an older project has no `ruleSettings`, its design rules (`designRules`) become rule settings (`ruleSettingsFromDesignRules`, `src/formats/project/rule-settings.ts`): each limit's value and severity under its rule's id and each program rule's severity as it was saved, leaving out those set as their rule's default. Existing rule settings are preserved. A project whose legacy design rules cannot be read is refused rather than silently resetting them. A payload of another `schemaVersion` is refused, naming its format number: "This project was saved by a newer version of OpenSpindle" or "…by an earlier version of OpenSpindle, which this version cannot open"; earlier versions of OpenSpindle refuse version 10 as newer. The current workspace stays as it is.

## Schema identity

The header uses:

```step
FILE_DESCRIPTION(('OpenSpindle STEP-NC project archive v1'),'2;1');
FILE_SCHEMA(('MODEL_BASED_INTEGRATED_MANUFACTURING_SCHEMA'));
```

This is the schema name introduced by AP238 edition 2, published as ISO 10303-238:2020. The first edition used `INTEGRATED_CNC_SCHEMA`. `STEP_MERGED_AP_SCHEMA`, used in STEP Tools' combined reference documentation, is not the interchange schema name for this profile. [STEP Tools edition 2 notes](https://www.steptools.com/docs/stp_aim/notes_ap238e2.html)

The writer emits one `HEADER` section and one `DATA` section, with `FILE_DESCRIPTION`, `FILE_NAME`, and `FILE_SCHEMA` in that order. `FILE_NAME` contains the project name with `.stpnc`, an ISO timestamp, author and organization lists containing an empty string, and `OpenSpindle` as both preprocessor and originating system. `APPLICATION_PROTOCOL_DEFINITION` identifies the lowercase schema name, the integer year `2020`, and status `international standard`.

## Standard entity structure

The project root follows the `MACHINING_PROJECT` → formation → product definition → process association → main workplan structure illustrated in the AP238 annotated examples. Workplan order is expressed with `MACHINING_PROCESS_SEQUENCE_RELATIONSHIP.sequence_position`; entity numbers and physical line order are not ordering mechanisms. [AP238 annotated examples, Annex J](https://stepmfg.github.io/ap238/data/annexJ.htm)

Each plate has a workplan, and each of its operations has a documentary setup-instructions entry in operation order. An operation with NC associates its exact NC text as a source document. An operation that has not generated its NC yet is a pending entry: it associates a recipe document and carries an `openspindle:operation-state` property whose single item is `state` = `pending`; it has no NC source. These instructions represent reviewing the attached source, not a fabricated AP238 machining operation.

Every `MACHINING_WORKPLAN` requires at least one sequence relationship to a `MACHINING_PROCESS_EXECUTABLE`, so an empty workplan is never written. A plate without operations gets one placeholder entry, `Empty plate`, whose operator instruction associates a `<plate ID>/archive` document of type `OpenSpindle project archive`. A project without plates uses a single root instruction, `Empty project`, associating the `openspindle-project/archive` document, with no synthetic plate or NC program: the inherited associated-document set cannot be empty. [Associated-document attribute](https://www.steptools.com/stds/stp_aim/html/t_action_method_with_associated_documents.html)

`setup instructions` is an allowed description for the executable base entity; its instruction relationships refer to `MACHINING_OPERATOR_INSTRUCTION`, which has an associated document set. [Workplan definition](https://www.steptools.com/stds/stp_aim/html/t_machining_workplan.html), [executable definition](https://steptools.com/docs/stp_aim/html/t_machining_process_executable.html), [operator instruction definition](https://www.steptools.com/stds/stp_aim/html/t_machining_operator_instruction.html), [ordered instruction relationship](https://downloads.steptools.com/docs/stp_aim/html/t_machining_operator_instruction_relationship.html)

## Exact source and project payload

The standard `ACTION_PROPERTY` → `ACTION_PROPERTY_REPRESENTATION` → `REPRESENTATION` → `DESCRIPTIVE_REPRESENTATION_ITEM` structure stores application-defined text. Names beginning `openspindle:` belong to this application profile; they are not standardized machining properties. The representation uses `REPRESENTATION_CONTEXT('','units not necessary')` because its items contain descriptive text, not geometry. `DESCRIPTIVE_REPRESENTATION_ITEM` supplies a name and text description. [Descriptive representation item](https://www.steptools.com/stds/stp_aim/html/t_descriptive_representation_item.html), [representation definition](https://www.steptools.com/stds/stp_aim/html/t_representation.html)

The main workplan has an action property named `openspindle:project`. Its representation contains:

| Item name                          | Description                                             |
| ---------------------------------- | ------------------------------------------------------- |
| `openspindle:project:manifest`     | JSON with `encoding`, `bytes`, `checksum`, and `chunks` |
| `openspindle:project:chunk:000000` | First base64 text chunk                                 |
| `openspindle:project:chunk:000001` | Second base64 text chunk, if needed                     |

`encoding` is `base64-json`. The project document JSON is encoded as UTF-8 and then base64. Base64 text is divided into chunks of at most 65,536 characters. `bytes` is the decoded UTF-8 byte length, `chunks` is the number of chunks, and `checksum` is the Adler-32 checksum of those UTF-8 bytes expressed as eight lowercase hexadecimal digits. Adler-32 detects accidental corruption; it is not a signature or proof that a file is trusted. The writer places the manifest first and the chunks after it in numeric suffix order. Although `REPRESENTATION.items` is an unordered SET in EXPRESS, this deliberately narrow importer requires that canonical aggregate order as well as the suffixes. The same base64-JSON encoding (`src/formats/base64-json.ts`) embeds plate settings in exported NC files.

Each operation's setup-instructions leaf with NC also has an `openspindle:source` action property. Its representation contains one descriptive item named `nc-source`, whose description contains the operation's exact NC text using Part 21 string escaping: line endings, tabs, quotes, backslashes, and every Unicode character round-trip byte for byte. The associated `DOCUMENT` has the ID `<plate ID>/<operation ID>/source` (`<plate ID>/<operation ID>/recipe` for a pending operation) and the operation name; its description is explanatory metadata, not an alternate content field. The payload holds the same NC texts inside the operations, and the importer requires both copies to be identical. Probing operations hold parameters instead: the method the plate's machine performs their strategy with writes their NC whenever the plate compiles, so the attached text documents what it wrote when saved, and the importer takes it as the file has it.

Both project and source representations use the same name as their owning action property (`openspindle:project` or `openspindle:source`). The project product ID is `openspindle-project`, its formation ID is `1`, and its main workplan name is the saved project name. Each plate workplan is named `Plate N: <plate name>`, or `Plate N` for a plate without a name. These identifiers are part of the OpenSpindle profile, rather than additional AP238 requirements.

Stock definitions, tool tables and library records, fixtures, work origins, anchors, operation sources and PCB recipes, and other saved application state remain application data in this profile. They are not advertised as reconstructed AP238 workpiece geometry or fully defined machining resources. Reconstructing these as interoperable semantic objects is a separate capability.

## Project document, version 10

The payload is a JSON object validated by `ProjectDocumentSchema`. Its workspace fields have exactly the types of the workspace state (`WorkspaceState`); the TypeScript type is derived from it, so the two cannot drift.

| Field                             | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schemaVersion`                   | `10`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `name`                            | Project name: 1–200 characters without control characters                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `plates`                          | The plates, in order. Each is the workspace plate aggregate itself (`PlateSchema`): its name, its setup (stock, stock anchor, the single work origin, assist policy, fixtures, device and its anchor snapshot, in bed coordinates from Anchor 1), its tool table, its operations with their sources and NC, its groups of program sections, and its notices                                                                                                                                |
| `selectedPlateId`                 | The selected plate, or `null`                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `tools`                           | The tool library                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `stocks`                          | The stock library                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `defaultToolId`, `defaultStockId` | The library defaults, or `null`                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `heightMaps`                      | Stored height maps, keyed by the device that measured them                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ruleSettings`                    | How the project reports its rules, and their limits ([design-rules.md](design-rules.md)), by rule id: `{ severity, limit }`, with `severity` `error`, `warning` or `ignore` and a limit only for a rule with one, within its range. It holds at most 200 rules, only those set differently from their defaults; a rule it does not set takes its default. A setting for a rule this version does not know is kept as it is and not checked; one for a rule a project cannot set is refused |
| `models`                          | The models the plates' fixtures use, with their meshes (below)                                                                                                                                                                                                                                                                                                                                                                                                                             |

Plate IDs, tool IDs, stock IDs and model IDs are unique; the selected plate and the library defaults must exist; each height map is filed under its own device. A plate tool-table entry may name a tool that is no longer in the library; as in the workspace, the entry is kept and blocks Run until a tool is assigned. A tool's 3D model, when it is a chosen GLB rather than a bundled path, is checked the same way importing a tool library checks one (`validateGlb`: one self-contained GLB).

An operation's source is an NC file, a PCB source and recipe, a probing operation, or an unsupported older source without NC. A file imported from Fusion 360 keeps where it came from (`origin`), to be updated from there. A PCB source keeps its original file, role, settings, selected tool and preset, last generated settings and any generation error in `data`; `nc: null` means its toolpath still needs generating and is distinct from empty NC (`""`). A probing source keeps its task, its strategy's id (what it does, such as `touch-off`), the T number of its probe and its parameters ([workspace model](workspace-model.md#operations)); the method the plate's machine performs its strategy with writes its NC from them, the plate and the library probe the plate's tool table holds for it when compiling.

The writer validates the document before encoding it and stores exactly what the schema returns. The reader validates it again, optimistically, since another version may have written it: it takes the document as the schema returns it, including anything the schema brings up to date, and leaves out fields the schema does not recognize instead of refusing the file (`readOptimistically` in `src/formats/optimistic-read.ts`). Opening then lists every field of the file that the document does not keep, whether unrecognized or removed by an upgrade, since saving the project does not keep them either. Only a payload the schema cannot read without them is refused, with the schema's reasons. The STEP-NC graph must still document the document as read, so a project, plate or operation name the schema would rewrite, such as one with surrounding spaces, still fails the graph check.

### Older operation sources

Project formats 4 through 9 are upgraded when opened. Format 6 set the project's rules by id, format 7 made PCB built in, format 8 made probing one kind of operation, format 9 has bed coordinates from Anchor 1 (an older plate's stock, work origin, fixtures and probing start heights move to them, and its program stays the same; [stored-anchors.md](stored-anchors.md#coordinate-registration)), and format 10 names a probing operation's strategy by what it does rather than by who writes its NC ([below](#probing-strategies)). Each upgrade a format needs runs in order, and none it does not.

Formats 4 through 6 held plugin and template operations. A PCB operation with a readable recipe becomes a `pcb` source and keeps its saved NC. Other plugin and template operations with generated NC become `file` sources, preserving that NC byte for byte and retaining their saved `phase` (`setup`, `machining` or `finish`). Their generator metadata is listed among the fields left out; they are ordinary NC operations after opening.

An older source without generated NC becomes `unsupported`: its complete source data and phase remain in the project. It blocks Run and NC export until the user replaces or removes the operation. An unreadable PCB recipe follows these same rules, so its NC stays available when present and a pending recipe is kept intact.

Since version 7 a project has no plugin references. References and source fields an upgrade removes appear in the opening report. These source upgrades apply to a workspace kept across a renderer reload too.

Formats before 8 had four probing kinds of their own. Each becomes a probing operation with the strategy that does what it did, selecting the probe its NC selected (`upgradePlate`, `src/formats/upgrade/plate.ts`):

- `auto-level`: task `grid`, strategy `height-map`, probe T0; `width` and `depth` become `size`, `columns` and `rows` become `points`.
- `auto-z-height`: task `touch-off`, strategy `touch-off` (Z surface), probe T0. Where it touches at a stored anchor on a plate whose program sets work X and Y from its anchors, the Z1 runs it with its firmware's Z probe, as the kind ran there; elsewhere with OpenSpindle's own touch.
- `auto-scan`: task `outline`, strategy `outline-trace`, probe T0.
- `probe-3d`: task `origin`, the strategy its `routine` parameter names (`outside-corner`, `inside-corner`, `pocket-center` or `boss-center`), probe T9999; `distanceX` and `distanceY` become `distance`, and `ballDiameter` goes, as it takes the ball of its probe.

A placement's Z becomes its `height`, and an anchor's offset its X and Y as a pair. An operation still named after its kind ("Auto-level") takes its strategy's name ("Height map"; "3D probing" takes its routine's, such as "Outside corner"). One that does not bind its probe's number binds it to the table entry of that number, which a table without one gains, holding the probe the project's tool library has for that number (`libraryPreferences`), or no tool. A notice on the plate names a probe there that the strategy cannot run with ("Auto Z-height is now Z surface, which cannot probe with …"), and a 3D probing set for another ball than its probe's, or without a probe from the library: assign the probe you use, or correct it in the tool library. Groups name a height map's grid section by its current name. A key the source already has in the current shape stays as it is, as does anything the upgrade does not recognize, which reading then leaves out and reports.

#### Probing strategies

Formats 8 and 9 named a probing operation's strategy by who wrote its NC: OpenSpindle's own (`surface-touch`, `outline-trace`) or the Z1 firmware's (`makera-z1/height-map`, `makera-z1/z-probe`, `makera-z1/routines`). Format 10 names it by what it does, and the plate's machine decides who writes its NC ([workspace model](workspace-model.md#operations)). Opening one gives each probing operation the strategy that does what its own did (`upgradeStrategies`, `src/formats/upgrade/strategies.ts`):

- `surface-touch` and `makera-z1/z-probe` become `touch-off` (Z surface);
- `makera-z1/height-map` becomes `height-map`;
- `outline-trace` stays;
- `makera-z1/routines` becomes the strategy its `routine` parameter names; one without such a routine keeps its strategy, which does not resolve (`probing-unsupported`).

An operation still named after its earlier strategy takes the new one's name, as the inspector renames an operation along with its strategy: "Surface touch" and "Z probe (Z1 firmware)" become "Z surface", "Height map (Z1 firmware)" becomes "Height map", and "3D probing (Z1 routines)" its routine's, such as "Inside corner". Its parameters stay as they are. On the Z1 a Z surface runs as the firmware's Z probe wherever it can (at a stored anchor on a plate whose program sets work X and Y from its anchors), so a Surface touch saved at such an anchor runs the Z probe now. A workspace kept across a renderer reload by a page that kept probing strategies the earlier way (its version 2) is upgraded the same way, to version 3 (`src/app/workspace/kept-workspace.ts`).

### Models

A fixture draws a model bundled with OpenSpindle or one from the [Models library](models.md). `models` holds one entry per library model that a plate's fixture uses, in first-use order:

| Field    | Content                                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| `record` | The library record (name, mesh size and triangles, bounds), with `source: null`: the uploaded file stays behind |
| `mesh`   | The display mesh: the binary glTF, base64                                                                       |

Every entry must be used by a fixture, and a project holds at most 64. Saving includes each model the library holds and names, in its message, the models it does not hold; their fixtures show as boxes of the model's size. Opening verifies each model (its ID is the SHA-256 of its mesh, and the mesh must be a valid, self-contained GLB with the triangles its record states) before adding it to the library; a model the library already holds stays as it is, with its uploaded file. A model already stored under an id but not itself readable is left as it is too, never overwritten. A model that fails verification, or finds an unreadable model already at its id, is named in a notice.

## Representation limits

An arbitrary NC file may contain interpolation, probing cycles, machine-specific commands, macros, and state that OpenSpindle cannot reconstruct completely. It must not be stored as a purported `NC_LEGACY_FUNCTION` or an `extended function` machining command. AP238's `Extended_NC_function` excludes interpolated axis motion; attaching the original source as a document avoids that incorrect meaning. [AP238 extended NC function definition, clause 4.3.152](https://stepmfg.github.io/ap238/data/clause4.htm)

The application payload is required to reopen an OpenSpindle project. A different STEP implementation can inspect the documentary graph and strings but is not expected to restore OpenSpindle-specific state or run the attached NC source. A renamed JSON file is not accepted as a STEP-NC project, and a valid external AP238 machining file without this profile is not an OpenSpindle project.

The importer reconstructs the expected documentary graph from the validated payload and compares it with the parsed entities. This detects a changed source document, extra executable entity, missing link, or mismatch between the visible structure and the archived state. It permits comments, ordinary token whitespace, a leading UTF-8 BOM, and reordered DATA entity records. It intentionally rejects entity renumbering, changed graph labels or links, reordered representation item aggregates, unsupported entity forms, and extra sections. A general-purpose STEP editor may make a semantically equivalent change that this importer rejects; that is a profile limitation, not proof that the edited file violates AP238.

## File and data limits

The Open dialog accepts `.stpnc`, `.step`, `.stp`, and `.p21`. Content must still match this profile. Empty files and literal NUL characters are rejected by the file-opening layer.

The limits are defined once, in `PROJECT_LIMITS` (`src/formats/project/step-nc.ts`); the document schema and the container check them with the same values when saving and when opening, so a project that saves also opens.

| Limit                                | Maximum                     |
| ------------------------------------ | --------------------------- |
| Complete STEP-NC file                | 100 MiB (104,857,600 bytes) |
| Decoded project JSON                 | 100 MiB                     |
| Plates                               | 100                         |
| Operations per plate                 | 100                         |
| NC text of one operation             | 10 MiB (UTF-8)              |
| Tool library entries                 | 10,000                      |
| Stock library entries                | 1,000                       |
| Fixture models, with their meshes    | 64                          |
| Stored height maps                   | 100                         |
| DATA entity records                  | 101,816                     |
| Entries in one parsed STEP aggregate | 1,601                       |
| STEP aggregate nesting               | Parser depth limit 12       |

The entity record and aggregate limits follow from the others: they are the documentary graph and the payload item list of the largest project within them. Plates also bound their own tables: at most 100 tool-table entries, 500 groups, 100 notices, and 32 fixtures.

The full-file limit applies after base64 expansion, Part 21 escaping, and the exact-source representations. Each operation's NC is stored twice (in the payload and as its source document), so a project below the decoded JSON limit may still be too large to save. Limits are checked before a project replaces the workspace. Library selections, plate references, and historic device identities are validated rather than partially imported.

## Validation scope and references

The entity signatures and relevant local constraints were reviewed against STEP Tools' published schema reference and the AP238 project/workplan examples; the exporter and importer additionally enforce the OpenSpindle profile and payload integrity. This is not full EXPRESS validation, a Protocol Implementation Conformance Statement, or certification of any AP238 conformance class.

The [AP238 edition 2 overview](https://www.ap238.org/ap238e2/) identifies the published 2020 edition. The live [STEP Manufacturing repository](https://github.com/stepmfg/ap238) documents a 2026 edition 4 draft; its links above are cross-references for the longstanding structures, not a claim that the draft is the published 2020 standard.
