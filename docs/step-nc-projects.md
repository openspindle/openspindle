# OpenSpindle STEP-NC project files

OpenSpindle saves projects as ISO 10303-21 text (`.stpnc`) using a small documentary profile of the AP238:2020 entity model. The file contains a machining project, ordered workplans, original NC source documents, and application properties that preserve the OpenSpindle project for reopening.

This is an archive and round-trip profile. It does **not** convert arbitrary G-code into portable STEP-NC machining features, operations, or toolpaths. No AP238 conformance class or external controller compatibility is claimed. Opening a project restores the workspace; it does not execute the NC programs. The importer supports this OpenSpindle profile, not arbitrary STEP-NC files from other applications.

## Usage

Choose **File › New Project** (⌘N) to start a new project, **File › Save Project…** (⌘S) to save the current workspace, or **File › Open Project…** (⌘O) to reopen it; dropping a single `.stpnc` file onto the window opens it too.

**File › Import…** (⇧⌘O) opens the native file window for NC programs. Plain NC is added to the selected plate, or creates a new plate if none is selected. An OpenSpindle NC export creates a new plate with its embedded setup. Dropping NC files onto the workspace creates a new plate for each file. **File › Import from Fusion 360** opens the connected program picker ([Fusion 360](fusion360.md)).

OpenSpindle starts with a new, empty project every time it opens; a project is kept only by saving it. The tool and stock libraries are the app's own: a saved project carries a copy of them, and opening one keeps yours, adding the tools its plates use that yours lacks (a tool you have stays as you have it). Before replacing a project with unsaved changes, or closing the window with them, choose **Save**, **Don't save**, or **Cancel**. OpenSpindle validates the incoming project before replacing the workspace; an invalid file leaves the current project intact. Opening restores saved workspace data without connecting to a device or executing a program.

## Two layers and their versions

A project file has two layers, versioned independently:

- The **container** is the ISO 10303-21 file described below: its header, the documentary AP238 graph with each operation's exact NC text, and the application payload stored inside it. Its profile, named in `FILE_DESCRIPTION`, is `OpenSpindle STEP-NC project archive v1`. The container does not interpret the payload. It is implemented in `src/formats/project/step-nc.ts`.
- The **project document** is the application payload: JSON whose `schemaVersion` names the project format. The current format is **version 5** (`src/formats/project/document.ts`).

`encodeProject` in `src/formats/project/project.ts` writes version 5 and `decodeProject` reads it, and reads version 4 as version 5. A payload of another `schemaVersion` is refused, naming its format number: "This project was saved by a newer version of OpenSpindle" or "…by an earlier version of OpenSpindle, which this version cannot open". The current workspace stays as it is.

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

Each plate has a workplan, and each of its operations has a documentary setup-instructions entry in operation order. An operation with NC associates its exact NC text as a source document. A plugin operation that has not generated its NC yet is a pending entry: it associates a recipe document and carries an `openspindle:operation-state` property whose single item is `state` = `pending`; it has no NC source. These instructions represent reviewing the attached source, not a fabricated AP238 machining operation.

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

Each operation's setup-instructions leaf with NC also has an `openspindle:source` action property. Its representation contains one descriptive item named `nc-source`, whose description contains the operation's exact NC text using Part 21 string escaping: line endings, tabs, quotes, backslashes, and every Unicode character round-trip byte for byte. The associated `DOCUMENT` has the ID `<plate ID>/<operation ID>/source` (`<plate ID>/<operation ID>/recipe` for a pending operation) and the operation name; its description is explanatory metadata, not an alternate content field. The payload holds the same NC texts inside the operations, and the importer requires both copies to be identical. Auto-level, auto Z-height, auto-scan and 3D probing operations hold parameters instead: their NC is generated whenever the plate compiles, so the attached text documents what they generated when saved, and the importer takes it as the file has it.

Both project and source representations use the same name as their owning action property (`openspindle:project` or `openspindle:source`). The project product ID is `openspindle-project`, its formation ID is `1`, and its main workplan name is the saved project name. Each plate workplan is named `Plate N: <plate name>`, or `Plate N` for a plate without a name. These identifiers are part of the OpenSpindle profile, rather than additional AP238 requirements.

Stock definitions, tool tables and library records, fixtures, work origins, anchors, operation sources and plugin data, and other saved application state remain application data in this profile. They are not advertised as reconstructed AP238 workpiece geometry or fully defined machining resources. Reconstructing these as interoperable semantic objects is a separate capability.

## Project document, version 5

The payload is a JSON object validated by `ProjectDocumentSchema`. Its workspace fields have exactly the types of the workspace state (`WorkspaceState`); the TypeScript type is derived from it, so the two cannot drift.

| Field                             | Content                                                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                   | `5`                                                                                                                                                                                                                                                                                                                       |
| `name`                            | Project name: 1–200 characters without control characters                                                                                                                                                                                                                                                                 |
| `plates`                          | The plates, in order. Each is the workspace plate aggregate itself (`PlateSchema`): its name, its setup (stock, stock anchor, the single work origin, assist policy, fixtures, device and its anchor snapshot), its tool table, its operations with their sources and NC, its groups of program sections, and its notices |
| `selectedPlateId`                 | The selected plate, or `null`                                                                                                                                                                                                                                                                                             |
| `tools`                           | The tool library                                                                                                                                                                                                                                                                                                          |
| `stocks`                          | The stock library                                                                                                                                                                                                                                                                                                         |
| `defaultToolId`, `defaultStockId` | The library defaults, or `null`                                                                                                                                                                                                                                                                                           |
| `heightMaps`                      | Stored height maps, keyed by the device that measured them                                                                                                                                                                                                                                                                |
| `designRules`                     | The design rules the plates are checked against (Check design rules): each rule's limit and severity ([design-rules.md](design-rules.md)); a project saved without them opens with the defaults                                                                                                                           |
| `plugins`                         | References to the plugins the operations use (below)                                                                                                                                                                                                                                                                      |
| `models`                          | The models the plates' fixtures use, with their meshes (below)                                                                                                                                                                                                                                                            |

Plate IDs, tool IDs, stock IDs, plugin reference IDs and model IDs are unique; the selected plate and the library defaults must exist; each height map is filed under its own device. A plate tool-table entry may name a tool that is no longer in the library; as in the workspace, the entry is kept and blocks Run until a tool is assigned. A tool's 3D model, when it is a chosen GLB rather than a bundled path, is checked the same way importing a tool library checks one (`validateGlb`: one self-contained GLB).

An operation's source is a file, a plugin template, or plugin-owned data. Template and plugin sources keep the plugin ID and version they were generated with; a plugin operation that has not generated its NC yet has `nc: null`, which is distinct from empty NC (`""`).

The writer validates the document before encoding it and stores exactly what the schema returns. The reader validates it again, optimistically, since another version may have written it: it takes the document as the schema returns it, including anything the schema brings up to date, and leaves out fields the schema does not recognize instead of refusing the file (`readOptimistically` in `src/formats/optimistic-read.ts`). Opening then lists every field of the file that the document does not keep, whether unrecognized or removed by an upgrade, since saving the project does not keep them either. Only a payload the schema cannot read without them is refused, with the schema's reasons. The STEP-NC graph must still document the document as read, so a project, plate or operation name the schema would rewrite, such as one with surrounding spaces, still fails the graph check.

### Plugin references

A project never contains plugin code. `plugins` lists one reference per plugin that an operation uses, in first-use order:

| Field     | Content                                                 |
| --------- | ------------------------------------------------------- |
| `id`      | The plugin ID the operations name                       |
| `name`    | The plugin name when the project was saved              |
| `version` | The installed plugin version when the project was saved |
| `source`  | Where the plugin comes from                             |

`source.kind` is `github` (with the canonical `repository` URL `https://github.com/<owner>/<repository>` and the full 40-character `commit` it was installed from) or `folder` (loaded from a local folder; it cannot be installed automatically). Every reference must be used by an operation.

`referencedPlugins(plates, installed, retained)` builds the references: an installed plugin describes itself, and the references of the project last opened or saved (`retained`, kept in the workspace as `project.plugins`) keep describing plugins that are not installed, so saving never forgets where a missing plugin came from. `decodeProject` reports the references whose plugin is not installed as `missingPlugins`, so the workspace can offer to install them. Operations of a missing plugin keep their saved NC and settings.

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
| Plugin references                    | 32                          |
| Fixture models, with their meshes    | 64                          |
| Stored height maps                   | 100                         |
| DATA entity records                  | 101,816                     |
| Entries in one parsed STEP aggregate | 1,601                       |
| STEP aggregate nesting               | Parser depth limit 12       |

The entity record and aggregate limits follow from the others: they are the documentary graph and the payload item list of the largest project within them. Plates also bound their own tables: at most 100 tool-table entries, 500 groups, 100 notices, and 32 fixtures.

The full-file limit applies after base64 expansion, Part 21 escaping, and the exact-source representations. Each operation's NC is stored twice (in the payload and as its source document), so a project below the decoded JSON limit may still be too large to save. Limits are checked before a project replaces the workspace. Library selections, plate references, plugin references, and historic device identities are validated rather than partially imported.

## Validation scope and references

The entity signatures and relevant local constraints were reviewed against STEP Tools' published schema reference and the AP238 project/workplan examples; the exporter and importer additionally enforce the OpenSpindle profile and payload integrity. This is not full EXPRESS validation, a Protocol Implementation Conformance Statement, or certification of any AP238 conformance class.

The [AP238 edition 2 overview](https://www.ap238.org/ap238e2/) identifies the published 2020 edition. The live [STEP Manufacturing repository](https://github.com/stepmfg/ap238) documents a 2026 edition 4 draft; its links above are cross-references for the longstanding structures, not a claim that the draft is the published 2020 standard.
