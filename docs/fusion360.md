# Fusion 360

The OpenSpindle Python add-in lets OpenSpindle discover NC programs in open Autodesk Fusion documents on the same computer. **Connect to OpenSpindle** in Fusion opens a pairing dialog in OpenSpindle. After connecting, choose a program in OpenSpindle and import it: the add-in posts it using its configured Fusion post processor, and OpenSpindle imports the result as it does a dropped program ([importing](step-nc-projects.md#usage)). Its operations can be updated from Fusion later. Importing never sends commands to the machine.

## Install and connect

1. Find the **OpenSpindleBridge** folder that comes with OpenSpindle. On macOS, in Finder, open **Applications**, right-click **OpenSpindle.app**, choose **Show Package Contents** and open **Contents › Resources › fusion360**. On Windows, it is in `%LOCALAPPDATA%\Programs\openspindle\resources\fusion360`. In Fusion, open **Utilities › Add-Ins › Scripts and Add-Ins**, add an add-in from your device, and select that folder. Run **OpenSpindleBridge**, and keep **Run on Startup** on so it starts with Fusion. See the [add-in instructions](../integrations/fusion360/README.md) for its commands and installation details.
2. In the Manufacture workspace, generate the toolpaths and configure an NC program with the postprocessor and settings appropriate for your machine. Use a separate NC program for each setup, with a single work origin.
3. Keep OpenSpindle open and choose **OpenSpindle › Connect to OpenSpindle** in Fusion. Enter the six-digit code Fusion shows in OpenSpindle's **Fusion 360 wants to connect** dialog, then click **Connect**. The program picker opens after connection; it is also available from **File › Import from Fusion 360**.
4. Choose an NC program and click **Import**. OpenSpindle asks Fusion to post the current program and imports the resulting NC into the selected plate, or first asks which plate it goes to, how to split it and how to fix what the Z1 would not run as written. Check the tools OpenSpindle matched, the plate's stock and work origin, then review the program before running it from **Job**.

Each connection code is usable once, expires after two minutes, and is locked after five incorrect attempts. Clicking **Connect to OpenSpindle** again in Fusion creates a new request and code. Canceling the OpenSpindle dialog dismisses that request; repeated announcements do not reopen it. A request waits while an unrelated workspace dialog is open.

OpenSpindle exchanges a valid code for a token of its own, which both apps keep across restarts: connecting once is enough until **Disconnect**. You do not copy or paste a bearer token. OpenSpindle keeps it encrypted with the system's key store (the macOS Keychain, Windows' data protection), and the add-in keeps only a hash of it. **Disconnect** forgets the connection in OpenSpindle and, while Fusion runs, in the add-in. The add-in keeps the four newest connections, so an installed OpenSpindle and one in development can both stay connected; a fifth pushes out the oldest, which then connects again. When Fusion no longer accepts OpenSpindle's token, OpenSpindle drops it and asks to connect again. If an exchange is interrupted after the code is consumed, request a fresh code in Fusion. Both apps must run on the same computer.

## Programs and updates

An import can split the program into operations by tool or by toolpath, named after the post's operations. It can be undone and is kept when the project is saved.

The program picker reads NC programs from all open Fusion documents, skipping documents without CAM data. Opening the picker or clicking **Refresh** reads their names without generating toolpaths or posting NC. Refresh the list after creating, renaming or deleting an NC program, or opening or closing a document.

Each operation keeps the document and NC program it came from. After changing a design or toolpath, generate the toolpaths in Fusion and choose **Update from Fusion 360** on the operation, in the inspector or by right-clicking it in the Plates list. OpenSpindle posts the program again, takes the operation's part when the import split it, and fixes what was fixed before, asking only about new problems. Updating needs Fusion connected and the document open; imported operations stay usable without Fusion.

Each post takes the program's current state. Finish any active edit or command in Fusion first. To post a program from another open document, the add-in temporarily activates that document and restores the previous one afterward. A failed post leaves the workspace unchanged.

Tools are matched to your tool library by what the post writes of them: name, diameter, flute length and kind. The T number alone never picks a tool, so a tool without a matching description stays unassigned. A new plate takes the stock the post describes, and the device's fixtures of the setup's fixtures' names ([Stock and fixtures](#stock-and-fixtures)), and is named after the NC program. Tool geometry, fixture models, CAM parameters and model geometry are not transferred. The tool library separately supports Fusion library imports.

## Stock and fixtures

A post can describe the setup's stock, and the fixtures holding it, in comments OpenSpindle reads, in millimetres along the work coordinate system's axes:

```text
;@OPENSPINDLE|STOCK|width=101|depth=71|height=1.6
;@OPENSPINDLE|WORK_ORIGIN|x=0|y=0|z=1.6
;@OPENSPINDLE|STOCK_ANCHOR|relative_to=anchor-1|x=47|y=22.01
;@OPENSPINDLE|FIXTURE|name=PCB Jig 100x70:1|x=0.49|y=0.98|z=-2.41|width=100.02|depth=78.02|height=2.42
```

- `STOCK`: the stock box's size along X, Y and Z.
- `WORK_ORIGIN`: the program's zero from the stock's front-left bottom corner; here on its top.
- `STOCK_ANCHOR`: that corner's X and Y from a stored anchor, by its id (`anchor-1` is the Z1's Anchor 1, the L-bracket's inner corner).
- `FIXTURE`, one for each fixture: its name, its box's front-left bottom corner from the stock's, and the box's size.

A plate that a program starts, dropped as a file or imported from Fusion, takes that stock with its front-left bottom corner at the anchor plus the offsets, and its work origin at the program's zero on it. Without `STOCK_ANCHOR`, with an anchor the plate does not store, or where the stock would lie outside the work area, the stock is centred instead. Without `WORK_ORIGIN`, the work origin is on the stock's top front-left corner. Placed from the anchor, the stock, the work origin and the program's fixtures stay relative to it: Run sets the machine's work X and Y (`G10 L2 P0` on G54, as Makera's controller does) at the anchor's stored machine position plus the work origin's offsets from it. The plate holds the anchors it was placed by, or Makera's factory positions when it had none; then Run asks to **Read anchors** from the connected device first. Run does not set work Z: set it on the stock top on **Device**, or with a touch-off. Otherwise the stock and the work origin are in bed coordinates, and Run leaves the machine's work offset as it is. A stock that is not a valid size or is larger than the work area is left out. A program that goes to an existing plate, or replaces an empty plate whose stock was set up, keeps that plate's setup.

Each `FIXTURE` is the fixture of that name in the bed setup of the device the new plate is for (**Device › Fixtures**), whatever its case and spacing and without Fusion's number for each use of a component (`PCB Jig 100x70:1` is **PCB Jig 100x70**). Fixtures are a device's: the empty plate a project starts with follows the connected device's default bed setup, so a program imported onto it looks there ([workspace model](workspace-model.md#plates)). The plate gets it, its own if it has one, enabled, with its box where the program has it beside the stock, as the device's fixture stands by default. A fixture under the stock keeps the program's height from it: the lowest of the stock and these fixtures rests on what carries it (the bed, or a wasteboard under it), so stock on a jig sits on the jig, and the work origin moves up with it. A fixture beside the stock rests on what carries it. A notice names the device and bed setup it looked in for a fixture they do not have ("Z1 Simulator › Default has no fixture of that name") or have without a 3D model, and for one whose size there differs from the program's by more than 0.5 mm (such as one turned another way); another names a locked fixture, which stays where it is. Beds stay as the plate has them.

### The Makera Z1 post

The Makera Z1 post (`Z1.cps`, kept with Makera's Fusion profiles rather than in this repository) writes these markers from the setup: the stock box, the WCS origin, the setup's part position on the Makera Z1 machine (**Setup › Part Position**), assuming the machine model attaches parts at Anchor 1, and the setup's fixtures (**Setup › Fixture**). Its **Part attach point X/Y from Anchor 1** properties move that point; **Write stock for OpenSpindle** turns the markers off. A setup without a machine model gets no `STOCK_ANCHOR`.

Fusion gives a post neither the part position's distances nor the setup's fixtures. When the add-in posts a program, it writes them beside it, in the folder it posts to (`openspindle-setup.json`), where the post reads them. Fusion takes the distances along the design's axes, which differ from the machine's when the WCS is turned from them, as in a design with Y up; with the distances, the post places the stock from Anchor 1 as Fusion's machine simulation does. Posting by hand in Fusion, the post has neither: it writes no `FIXTURE` markers, and for a turned WCS it warns unless the part position's distances are filled in its **Part position X/Y/Z distance** properties.

Its other properties set what the Z1 switches as it machines:

- **Air coolant**: an operation's air coolant runs the spindle fan (`M811 S<power>`, then `M812`), at **Spindle fan power for air coolant**, or nothing. The Z1 has no other coolant, so a post warns when a tool asks for flood or mist.
- **Vacuum**: the vacuum on the extend-out port (`M851 S<power>`, then `M852`) runs while the spindle runs, for operations whose coolant is **Suction**, or never, at **Vacuum power**.

## Post compatibility

The add-in uses the NC program's configured postprocessor. It does not install a Makera post, translate a generic post to the Z1 dialect, or certify its output for the machine. Use a machine-compatible post and a single setup/work coordinate system per program. OpenSpindle's plate model has one work origin; use separate plates for separate setups.

Successful import and a visible preview do not verify every command a post emits. OpenSpindle previews three-axis machining and arcs in any plane, except arcs with absolute centres (`G90.1`); unsupported motion can be absent from the preview. Adding operations or an anchored work-origin preamble can trigger the stricter composition checks, which may reject codes emitted by a generic post. Inspect the source and machine compatibility before running.

NC is limited to 10 MiB per program. Unsupported control characters, invalid text and invalid transfer data are refused. The add-in sets the post's **Split file** property to **No splitting** for its own post and restores it afterward: OpenSpindle splits programs itself. When a post still writes several files, the add-in takes the whole program named after the NC program; posts with separate subprogram files are refused.

An NC program keeps its own copy of its post's properties, so properties a post gained after the program was set up do not reach it through them; this is why the add-in hands the Z1 post the setup's part position and fixtures in a file instead. Fusion runs the post file the NC program names: after copying a post, check which one that is (Fusion's post log shows its configuration path).

## Connection

The add-in serves the authenticated NC program catalog and posting requests on `127.0.0.1:38764`. While a connection request is pending, it announces its request ID and expiry to OpenSpindle on loopback UDP port `38765`. The announcement carries no code, bearer token or program data. OpenSpindle verifies the announcement against the add-in's pending request before showing the dialog, then submits the code over loopback to obtain the bearer token. Codes and tokens never appear in discovery events or program-list responses.

Requests are bounded, never redirected, and validated before data reaches the workspace. The add-in accepts no cross-origin browser requests and does not listen on the local network. Listing reads metadata; only an import or an update requests posting. Autodesk API access runs on Fusion's main thread through its custom-event mechanism, while network work runs separately. Posting does not regenerate toolpaths, save the document, or execute a machine program.

If the add-in cannot start, check whether another copy is using its port. If OpenSpindle's discovery port is occupied, close the other running OpenSpindle instance and restart the one you want to pair. If no dialog appears, open OpenSpindle, finish any open dialog, and click **Connect to OpenSpindle** in Fusion again. If a program disappears, reopen its document in Fusion and refresh the list. After updating the add-in, stop it and run it again in Fusion. Catalog identifiers last only for the running add-in session; updates find a program by its document's and its own ids, or by their names with an add-in older than OpenSpindle. An add-in older than OpenSpindle's keeps no connection across its restarts: connect again after starting it.

Each post the add-in makes leaves lines starting `OpenSpindle:` in Fusion's log (**Text Commands › paths.get** names its file): what it handed the post of the setup, and the markers the post wrote.

The bridge waits for Fusion's main-thread response to confirm completion. Some Fusion builds return `false` from `fireCustomEvent` even when the event was queued, so that return value does not reject a request. A request that receives no response still times out. If scheduling throws an exception, OpenSpindle shows its details; include the full message when reporting the problem.

## Verification

The TypeScript checks and production build validate the OpenSpindle integration; Python compilation checks syntax. An end-to-end run inside Fusion is still required to verify the add-in against the installed Fusion version and your configured post. Start with a small program, inspect its source in OpenSpindle, and confirm the stock, origin, tools and preview against Fusion before machining.
