# Fusion 360 bridge

The OpenSpindle Bridge is a Python add-in installed in Autodesk Fusion.
OpenSpindle discovers NC programs in open Fusion documents and requests their
posted output when you import them or update an operation imported from them.
Fusion keeps responsibility for CAM generation and the machine post processor;
OpenSpindle imports the resulting G-code into the workspace.

## Install

1. Find the **OpenSpindleBridge** folder that comes with OpenSpindle. On macOS,
   in Finder, open **Applications**, right-click **OpenSpindle.app**, choose
   **Show Package Contents** and open **Contents → Resources → fusion360**. On
   Windows, it is in `%LOCALAPPDATA%\Programs\openspindle\resources\fusion360`.
   In Fusion, open **Utilities → Scripts and Add-Ins**, choose **+ → Script or
   add-in from device**, and select that folder. In older Fusion versions, use
   the **Add-Ins** tab and its **+** button.
2. Find **OpenSpindleBridge** and click **Run**. Keep **Run on Startup** on (the
   manifest's default) so the bridge starts with Fusion; for an add-in added
   before, turn it on there.

Fusion supplies Python and the Autodesk API. No separate Python installation or
third-party packages are required. Use a current Fusion release on Windows or macOS.

## Connect and import

1. In Fusion's **Manufacture** workspace, generate the toolpaths, create an NC
   program containing one setup, and configure its machine and post processor.
   Use the G54 work coordinate system for that setup.
2. Keep the OpenSpindle app open, then choose **OpenSpindle → Connect to
   OpenSpindle** in Fusion. Fusion displays a six-digit connection code.
3. OpenSpindle automatically opens **Fusion 360 wants to connect**. Enter the
   six-digit code to connect. The program picker lists NC programs from your open
   Fusion documents; it is also available from **File > Import from Fusion 360**.
4. Choose an NC program and click **Import**. The bridge posts the current
   program to a temporary folder using its post settings, with **Split file** set
   to **No splitting**, and returns the NC directly to OpenSpindle.

Connecting once is enough: OpenSpindle and the bridge both keep the connection
across their restarts, until **Disconnect** in OpenSpindle.

The code can be used once and expires after two minutes. If it expires or five
incorrect codes are entered, choose **Connect to OpenSpindle** again in Fusion.
Each click replaces any previous connection request. The Fusion code dialog
closes by itself once OpenSpindle connects.

The picker reads live program metadata without posting. Click **Refresh** after
adding or renaming programs, or opening or closing documents. After changing
toolpaths, generate them in Fusion and choose **Update from Fusion 360** on the
operation in OpenSpindle, which posts the program again. Nothing updates
automatically. Importing does not run a machine program.

The NC output must be UTF-8 or ASCII text with an `.nc`, `.cnc`, `.gcode`, `.tap`,
or `.ngc` extension, at most 10 MiB. When a post writes several files (apart from
the post log), the bridge takes the one named after the NC program if it holds the
whole program; posts with separate subprogram files are rejected.
NC programs containing multiple setups are rejected. The catalog supports up to
100 NC programs across open documents. Closing a document removes its programs
from the catalog. While Fusion is closed or the add-in stopped, OpenSpindle
cannot list or import programs; it stays connected for when the add-in runs
again. Imported plates remain usable.

Before posting, the bridge writes `openspindle-setup.json` into the temporary
folder: the setup's **Part Position** distances and its fixtures, each a name and
a box in the design's coordinates, in millimetres. Fusion gives a post neither;
OpenSpindle's Makera Z1 post reads them there to place the stock from Anchor 1 and
to name the fixtures in its markers
([docs/fusion360.md](../../docs/fusion360.md#stock-and-fixtures)). Other posts
ignore the file.

Finish any active Fusion edit or command before importing. For a program in another
open document, the add-in temporarily activates that document and restores the
previous one afterward. It never cancels an unrelated command to start a post.

The bridge rejects toolpath errors, out-of-date toolpaths, and duplicate tool
numbers during posting instead of silently omitting affected operations. The
program's output folder, filename, editor preference, Fusion Hub posting flag,
create-in-browser flag and the post's Split file property are restored after
posting. Fusion may mark the document as modified because the API temporarily
changes these parameters.

## Connection details

The add-in listens only on `127.0.0.1:38764`. While a connection request is pending,
it announces that request to OpenSpindle on `127.0.0.1:38765` once per second. The
announcement contains only a request ID and expiry time. It never contains the
code, a token, or program contents, and it is never sent onto the local network.

After checking the one-time code, the bridge gives that OpenSpindle a bearer
token of its own. That token authorizes catalog reads and explicit posting
requests for NC programs in open documents. Both keep it across restarts:
OpenSpindle encrypted with the system's key store, the bridge only as a SHA-256
hash, in `pairings.json` in **OpenSpindle Bridge** under the user's application
data (`~/Library/Application Support` on macOS, `%APPDATA%` on Windows), readable
by the user only. The bridge keeps the four newest tokens; a fifth pairing forgets
the oldest. Existing connections keep working if a new code is requested or
entered incorrectly. When the file cannot be written, a connection lasts until
the add-in stops. OpenSpindle cannot remotely
generate toolpaths or execute a machine program. HTTP requests queue catalog reads
and posting on Fusion's main thread using custom events; the worker threads only
use the documented thread-safe event signal, never document or CAM APIs.

Pending work is bounded and discarded if its caller disconnects or times out
before execution. A post already running in Fusion cannot be interrupted by the
HTTP client; its output is discarded after cancellation and the add-in still
restores the program settings. Posting requests are never retried automatically.

If startup reports that the port is in use, stop the bridge in other Fusion
instances before starting it here. If OpenSpindle cannot connect, check that the
add-in is running, open OpenSpindle, and choose **Connect to OpenSpindle** in Fusion.
Each post leaves lines starting `OpenSpindle:` in Fusion's log: the setup handed to
the post, and the OpenSpindle markers the post wrote.
If importing fails, open the NC program in Fusion, address its posting/toolpath
errors, and import again. After updating the add-in, stop it and run it again in
Fusion. Stopping the add-in closes its local listeners and removes its toolbar.
Startup also removes any leftover OpenSpindle panel, tab, and connection command
from an earlier session, so a failed start does not require restarting Fusion to
clear a duplicate toolbar ID.

Pairing uses `/v1/` routes and announcement `version: 1`; live program access uses
`/v2/` routes:

- UDP announcements are `{ type: "openspindle.fusion.pairing", version: 1,
requestId, expiresAt }`, where `requestId` is a UUID and `expiresAt` is Unix
  time in milliseconds.
- `GET /v1/pairing` returns `{ requestId, expiresAt }` for a pending request,
  or 404 when none is available. It does not require a bearer token.
- `POST /v1/pairing` accepts exactly `{ requestId, code }` as an
  `application/json` body of at most 1 KiB. A correct six-digit code returns
  `{ token }` and consumes the request. A wrong code returns 401; the fifth wrong
  attempt locks the request and returns 429. An expired, consumed, or replaced
  request returns 410. A locked request also returns 429 until expiry.
- `DELETE /v1/pairing` with the bearer token and no body makes the bridge forget
  that token, returning `{}`; OpenSpindle sends it on **Disconnect** and when it
  replaces its token by connecting again.
- `GET /v2/programs` returns `{ programs: [{ id, name, documentName, documentId,
operationId }] }` from open Fusion documents without posting or changing their
  settings. `documentId` is the saved document's lineage id (null before its first
  save) and `operationId` the NC program's id in it.
- `POST /v2/programs/{id}/post` with an `application/json` body of `{}` posts the
  selected NC program and returns `{ id, name, documentName, documentId,
operationId, fileName, contents }`.
- Program requests require `Authorization: Bearer <token>`; an unknown token
  returns 401, which makes OpenSpindle drop it and ask to connect again. All HTTP requests
  require exactly `Host: 127.0.0.1:38764`. Requests with an `Origin` header are
  rejected, and the server does not enable CORS.

## Autodesk API references

- [NCProgram.postProcess](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/cam_NCProgram_postProcess.htm)
  generates machine-specific NC code from an existing NC program.
- [Post-process execution behavior](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/cam_PostProcessExecutionBehaviors.htm)
  defines the strict failure option used by the bridge.
- [Post Toolpaths sample](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/PostToolpaths_Sample_Sample.htm)
  demonstrates the output-folder and filename parameters.
- [Managing scripts and add-ins](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/WritingDebugging_UM.htm)
  covers folder installation, manifests, and start/stop behavior.
- [Fusion threading guidance](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/Threading_UM.htm)
  requires Autodesk API calls to stay on Fusion's main thread.
- [Custom event sample](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/CustomEventSample_Sample.htm)
  demonstrates signaling the main thread from a worker thread.

This integration imports posted machine instructions. It does not transfer
editable Fusion CAM operations, native toolpath geometry, or fixture models. A
plate gets the stock, and the device's fixtures of the setup's fixtures' names,
only as the post describes them in OpenSpindle's markers
([docs/fusion360.md](../../docs/fusion360.md#stock-and-fixtures)).
