# OpenSpindle plate definition

An NC file exported from OpenSpindle (Prepare › operation › View source › Export NC with setup) begins with semicolon comments that carry the plate, followed by the program body exactly as Run sends it before the machine dialect:

```text
;@OPENSPINDLE|BEGIN|v=5|encoding=base64-json|bytes=<UTF-8 byte count>|checksum=<8 lowercase hex digits>
;@OPENSPINDLE|DATA|<base64, up to 120 characters per line>
;@OPENSPINDLE|END
<NC body>
```

The payload is UTF-8 JSON, base64 encoded. The checksum is Adler-32 of the decoded bytes, used to detect corruption, not to authenticate. CRLF or LF follows the body; the body itself is never changed. Firmware ignores the comments, and they configure nothing on the machine.

Invalid, incomplete, oversized or corrupted envelopes fail the import outright, and so does an envelope of a newer version of OpenSpindle, or of a version before 4. Version 4 imports as version 5, read optimistically like a project: a field the schema does not recognize is left out and named in a notice on the plate instead of refusing the file. Setup is limited to 32 MiB, the NC body to 10 MiB and the whole file to 20 MiB.

## Version 5

The payload (`PlateEnvelopeSchema`, `src/formats/plate-envelope.ts`) holds the plate aggregate of the [workspace model](workspace-model.md):

- `schemaVersion: 5` and the plate's `name` (empty for a plate without one);
- `setup`: stock, stock anchor, the single work origin, assists, fixtures (with their definition snapshots; a wasteboard is one), device id and the device's anchor snapshot ([stored-anchors.md](stored-anchors.md));
- `tools`: the plate's tool table (T number → library tool id);
- `operations`: every operation with its source (NC, with where it came from for a Fusion 360 import; template values, plugin data, or auto-level, auto Z-height, auto-scan or 3D probing parameters), its tool bindings and Pause before;
- `groups`: named selections of program sections, by stable section id;
- `bodyChecksum`: the Adler-32 of the NC body.

Importing a version 5 file restores the plate with its editable operations. When the body's checksum no longer matches (the NC was edited after export), the setup is kept but the body becomes a single program, with a notice on the plate.

Library tools are referred to by id: a tool that is not in the importing workspace's library leaves its entry dangling, which blocks Run and offers to assign another tool. Fixtures refer to their model the same way: a bundled model by its path, a [Models library](models.md) model by its id. The file carries no meshes; a fixture whose model is not in the importing library shows as a box of the model's size until the model is added (a saved project carries its models).
