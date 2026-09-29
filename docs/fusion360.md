# Fusion 360

The OpenSpindle Python add-in lets OpenSpindle discover NC programs in open Autodesk Fusion documents on the same computer. **Connect to OpenSpindle** in Fusion opens a pairing dialog in OpenSpindle. After connecting, choose a program in OpenSpindle and import it: the add-in posts it using its configured Fusion post processor, and OpenSpindle imports the result as it does a dropped program ([importing](step-nc-projects.md#usage)). Its operations can be updated from Fusion later. Importing never sends commands to the machine.

## Install and connect

1. In Finder, open **Applications**, right-click **OpenSpindle.app**, and choose **Show Package Contents**. Open **Contents › Resources › fusion360** to find the **OpenSpindleBridge** folder. In Fusion, open **Utilities › Add-Ins › Scripts and Add-Ins**, add an add-in from your device, and select that folder. Run **OpenSpindleBridge**. See the [add-in instructions](../integrations/fusion360/README.md) for its commands and installation details.
2. In the Manufacture workspace, generate the toolpaths and configure an NC program with the postprocessor and settings appropriate for your machine. Use a separate NC program for each setup, with a single work origin.
3. Keep OpenSpindle open and choose **OpenSpindle › Connect to OpenSpindle** in Fusion. Enter the six-digit code Fusion shows in OpenSpindle's **Fusion 360 wants to connect** dialog, then click **Connect**. The program picker opens after connection; it is also available from **File › Import from Fusion 360**.
4. Choose an NC program and click **Import**. OpenSpindle asks Fusion to post the current program and imports the resulting NC into the selected plate, or first asks which plate it goes to, how to split it and how to fix what the Z1 would not run as written. Check the tools OpenSpindle matched, the plate's stock and work origin, then review the program before running it from **Job**.

Each connection code is usable once, expires after two minutes, and is locked after five incorrect attempts. Clicking **Connect to OpenSpindle** again in Fusion creates a new request and code. Canceling the OpenSpindle dialog dismisses that request; repeated announcements do not reopen it. A request waits while an unrelated workspace dialog or plugin question is open.

OpenSpindle exchanges a valid code for a session credential, kept in its main process's memory until **Disconnect** or app exit. You do not copy or paste a bearer token. Stopping the Fusion add-in invalidates the session; start it and connect again. If an exchange is interrupted after the code is consumed, request a fresh code in Fusion. Both apps must run on the same computer.

## Programs and updates

An import can split the program into operations by tool or by toolpath, named after the post's operations. It can be undone and is kept when the project is saved.

The program picker reads NC programs from all open Fusion documents, skipping documents without CAM data. Opening the picker or clicking **Refresh** reads their names without generating toolpaths or posting NC. Refresh the list after creating, renaming or deleting an NC program, or opening or closing a document.

Each operation keeps the document and NC program it came from. After changing a design or toolpath, generate the toolpaths in Fusion and choose **Update from Fusion 360** on the operation, in the inspector or by right-clicking it in the Plates list. OpenSpindle posts the program again, takes the operation's part when the import split it, and fixes what was fixed before, asking only about new problems. Updating needs Fusion connected and the document open; imported operations stay usable without Fusion.

Each post takes the program's current state. Finish any active edit or command in Fusion first. To post a program from another open document, the add-in temporarily activates that document and restores the previous one afterward. A failed post leaves the workspace unchanged.

Tools are matched to your tool library by what the post writes of them: name, diameter, flute length and kind. The T number alone never picks a tool, so a tool without a matching description stays unassigned. Tool geometry, stock, fixtures, CAM parameters and model geometry are not transferred. The tool library separately supports Fusion library imports.

## Post compatibility

The add-in uses the NC program's configured postprocessor. It does not install a Makera post, translate a generic post to the Z1 dialect, or certify its output for the machine. Use a machine-compatible post and a single setup/work coordinate system per program. OpenSpindle's plate model has one work origin; use separate plates for separate setups.

Successful import and a visible preview do not verify every command a post emits. OpenSpindle previews three-axis machining and arcs in any plane, except arcs with absolute centres (`G90.1`); unsupported motion can be absent from the preview. Adding operations or an anchored work-origin preamble can trigger the stricter composition checks, which may reject codes emitted by a generic post. Inspect the source and machine compatibility before running.

NC is limited to 10 MiB per program. Unsupported control characters, invalid text and invalid transfer data are refused. The add-in sets the post's **Split file** property to **No splitting** for its own post and restores it afterward: OpenSpindle splits programs itself. When a post still writes several files, the add-in takes the whole program named after the NC program; posts with separate subprogram files are refused.

## Connection

The add-in serves the authenticated NC program catalog and posting requests on `127.0.0.1:38764`. While a connection request is pending, it announces its request ID and expiry to OpenSpindle on loopback UDP port `38765`. The announcement carries no code, bearer token or program data. OpenSpindle verifies the announcement against the add-in's pending request before showing the dialog, then submits the code over loopback to obtain the bearer token. Codes and tokens never appear in discovery events or program-list responses.

Requests are bounded, never redirected, and validated before data reaches the workspace. The add-in accepts no cross-origin browser requests and does not listen on the local network. Listing reads metadata; only an import or an update requests posting. Autodesk API access runs on Fusion's main thread through its custom-event mechanism, while network work runs separately. Posting does not regenerate toolpaths, save the document, or execute a machine program.

If the add-in cannot start, check whether another copy is using its port. If OpenSpindle's discovery port is occupied, close the other running OpenSpindle instance and restart the one you want to pair. If no dialog appears, open OpenSpindle, finish any open dialog, and click **Connect to OpenSpindle** in Fusion again. If a program disappears, reopen its document in Fusion and refresh the list. After updating the add-in, stop it and run it again in Fusion. Connection credentials and catalog identifiers last only for the running add-in session; updates find a program by its document's and its own ids, or by their names with an add-in older than OpenSpindle.

The bridge waits for Fusion's main-thread response to confirm completion. Some Fusion builds return `false` from `fireCustomEvent` even when the event was queued, so that return value does not reject a request. A request that receives no response still times out. If scheduling throws an exception, OpenSpindle shows its details; include the full message when reporting the problem.

## Verification

The TypeScript checks and production build validate the OpenSpindle integration; Python compilation checks syntax. An end-to-end run inside Fusion is still required to verify the add-in against the installed Fusion version and your configured post. Start with a small program, inspect its source in OpenSpindle, and confirm the stock, origin, tools and preview against Fusion before machining.
