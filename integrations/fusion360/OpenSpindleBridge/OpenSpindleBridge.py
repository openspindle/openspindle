"""Discover open Fusion NC programs and post them when OpenSpindle imports."""

import json
import os
from pathlib import Path
import re
import sys
import tempfile
import traceback
import uuid

import adsk.cam
import adsk.core
import adsk.fusion

from .bridge_server import (
    BridgeError, MAX_PROGRAM_BYTES, MAX_PROGRAMS, NC_EXTENSIONS, PAIRED, SnapshotBridge,
)


_TAB_ID = "OpenSpindleBridgeTab"
_PANEL_ID = "OpenSpindleBridgePanel"
_CONNECTION_ID = "OpenSpindleBridgeConnection"
_EVENT_ID = "OpenSpindleBridgeMainThreadRequest"
_bridge = None
_handlers = []
_catalog = {}
_custom_event = None
_custom_handler = None


def _application():
    return adsk.core.Application.get()


def _pairings_path():
    # Where the OpenSpindle apps paired with this add-in are kept across Fusion sessions: the
    # user's application data, not the add-in's own folder.
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    else:
        base = Path.home() / "Library" / "Application Support"
    return base / "OpenSpindle Bridge" / "pairings.json"


def _show_error(message):
    _application().userInterface.messageBox(message, "OpenSpindle")


def _display_name(value, fallback):
    return re.sub(r"[\x00-\x1f\x7f-\x9f\ud800-\udfff]", " ", str(value)).strip()[:200] or fallback


def _program_reference(document, program):
    # What finds the program again in a later session, when OpenSpindle updates an operation
    # imported from it: its document's lineage id (the same for all versions; None while the
    # document was never saved) and the program's id, which saving and reloading keep.
    document_id = None
    try:
        data_file = document.dataFile if document.isSaved else None
        document_id = str(data_file.id)[:500] if data_file else None
    except Exception:
        document_id = None
    try:
        operation_id = int(program.operationId)
    except Exception:
        operation_id = None
    return {"documentId": document_id, "operationId": operation_id}


def _refresh_catalog(ensure_live):
    # All Autodesk object references stay on Fusion's main thread. Read only:
    # listing never activates documents or posts/generates any toolpaths.
    global _catalog
    found = {}
    documents = _application().documents
    for document_index in range(documents.count):
        ensure_live()
        document = documents.item(document_index)
        if document is None or not document.isValid:
            continue
        # Fusion also includes design-only/reference documents in this list.
        # itemByProductType throws when CAM is absent, so inspect existing
        # products without requesting creation of a missing CAM product.
        cam = None
        for product in document.products:
            cam = adsk.cam.CAM.cast(product)
            if cam is not None:
                break
        if cam is None:
            continue
        programs = cam.ncPrograms
        for program_index in range(programs.count):
            ensure_live()
            program = programs.item(program_index)
            if program is None or not program.isValid:
                continue
            if len(found) >= MAX_PROGRAMS:
                raise ValueError("More than 100 NC programs are open in Fusion. Close some documents and refresh.")
            program_id = next((
                key for key, (previous_document, previous_program) in _catalog.items()
                if previous_document.isValid and previous_program.isValid
                and previous_document == document and previous_program == program
            ), None)
            if program_id is None:
                program_id = str(uuid.uuid4())
            found[program_id] = (document, program)
    # Dropping absent references makes closed/deleted programs unavailable. A
    # replacement with the same display name cannot inherit a stale identity.
    _catalog = found
    return [{
        "id": program_id,
        "name": _display_name(program.name, "NC program"),
        "documentName": _display_name(document.name, "Untitled"),
        **_program_reference(document, program),
    } for program_id, (document, program) in found.items()]


_SPLIT_PROPERTY = "splitFile"
_SPLIT_OUTPUT = (
    "The post wrote several files, such as one per tool or toolpath. In Fusion, set the "
    "NC program's post property Split file to No splitting and try again: OpenSpindle "
    "splits programs itself. Posts with separate subprogram files are not supported."
)
_SUBPROGRAM_CALL = re.compile(r"\b(?:M0*98|M198|G65)(?![\d.])", re.IGNORECASE)
_MOTION = re.compile(r"(?:^|\s)(?:G0*[0-3](?![\d.])|[XYZ][+-]?[\d.])", re.IGNORECASE)


def _without_splitting(program):
    # Posts that can write a file per tool or toolpath (Makera's "Split file") post one file
    # for OpenSpindle, which splits programs itself when importing them. Returns what restores
    # the post's setting, or None when it has no such setting or it is off already.
    try:
        parameters = program.postParameters
        parameter = parameters.itemByName(_SPLIT_PROPERTY) if parameters else None
        if not parameter or parameter.value.value == "none":
            return None
        previous = parameter.value.value
        parameter.value.value = "none"
        if not program.updatePostParameters(parameters):
            return None
    except Exception:
        return None

    def restore():
        again = program.postParameters
        setting = again.itemByName(_SPLIT_PROPERTY)
        setting.value.value = previous
        if not program.updatePostParameters(again):
            raise RuntimeError("Fusion refused the post setting back.")

    return restore


# What OpenSpindle's Makera Z1 post reads of the setup that Fusion does not give a post, its Part
# Position distances and its fixtures: a file beside the program, in the folder it posts to.
# Fusion's API gives lengths in centimetres; the file holds millimetres.
_SETUP_FILE = "openspindle-setup.json"
_MAX_FIXTURES = 32


def _log(message, level=adsk.core.LogLevels.InfoLogLevel):
    # Fusion's own log file, where imports can be traced afterwards.
    try:
        _application().log("OpenSpindle: " + message, level, adsk.core.LogTypes.FileLogType)
    except Exception:
        pass


def _millimetres(centimetres):
    # Fusion's API gives lengths in centimetres.
    return round(float(centimetres) * 10, 4)


def _part_position(setup):
    # The setup's Part Position distances along X, Y and Z in millimetres; None without them.
    distances = []
    for name in ("job_positionXOffset", "job_positionYOffset", "job_positionZOffset"):
        parameter = setup.parameters.itemByName(name)
        if not parameter:
            return None
        distances.append(_millimetres(parameter.value.value))
    return distances


def _fixtures(setup):
    # The setup's fixtures: each its name (its occurrence's, such as "Jig:1") and its box in the
    # design's coordinates in millimetres, which the post turns into the WCS. (The setup's own
    # WCS matrix is no help: its origin is in millimetres, the design's boxes in centimetres.)
    if not setup.fixtureEnabled:
        return []
    found = []
    models = setup.fixtures
    for index in range(min(models.count, _MAX_FIXTURES)):
        model = models.item(index)
        box = model.boundingBox if model else None
        if box is None:
            continue
        occurrence = adsk.fusion.Occurrence.cast(model)
        context = occurrence or getattr(model, "assemblyContext", None)
        found.append({
            "name": _display_name(context.name if context else model.name, "Fixture"),
            "lower": [_millimetres(value) for value in box.minPoint.asArray()],
            "upper": [_millimetres(value) for value in box.maxPoint.asArray()],
        })
    return found


def _write_setup(setup, directory):
    # Writes what the post reads of the setup into the folder it posts to, and logs it. What
    # cannot be read is left out, and logged: the post then writes what it can.
    found = {}
    for key, read in (("partPosition", _part_position), ("fixtures", _fixtures)):
        try:
            value = read(setup)
            if value is not None:
                found[key] = value
        except Exception:
            _log(
                f"Could not read the setup's {key}: {traceback.format_exc()}",
                adsk.core.LogLevels.WarningLogLevel,
            )
    text = json.dumps(found)
    try:
        (Path(directory) / _SETUP_FILE).write_text(text, encoding="utf-8")
        _log("Setup for the post: " + text)
    except OSError:
        _log("Could not write the setup for the post.", adsk.core.LogLevels.WarningLogLevel)


def _whole_program(contents):
    # A program file of its own: moves in it, and no call to a subprogram in another file.
    code = [re.sub(r"\([^)]*\)|;.*$", "", line) for line in contents.splitlines()]
    return any(_MOTION.search(line) for line in code) and not any(
        _SUBPROGRAM_CALL.search(line) for line in code
    )


def _post_snapshot(document, program, program_id, ensure_live):
    if not program.isValid:
        raise ValueError("The NC program is no longer available. Refresh the program list in OpenSpindle.")
    if program.postConfiguration is None:
        raise ValueError("Choose a machine post processor in the NC program first.")
    setups = {}
    for entry in program.operations:
        setup = adsk.cam.Setup.cast(entry)
        if setup is None:
            setup = entry.parentSetup
        if setup is None:
            raise ValueError("Every NC program operation must belong to one setup.")
        setups[setup.operationId] = setup
    if len(setups) != 1:
        raise ValueError("Import an NC program containing exactly one setup, using G54.")
    (setup,) = setups.values()

    parameters = program.parameters
    file_parameter = parameters.itemByName("nc_program_filename")
    folder_parameter = parameters.itemByName("nc_program_output_folder")
    editor_parameter = parameters.itemByName("nc_program_openInEditor")
    if not file_parameter or not folder_parameter or not editor_parameter:
        raise ValueError("This NC program does not expose the required posting parameters.")

    extension_parameter = parameters.itemByName("nc_program_nc_extension")
    extension = extension_parameter.value.value if extension_parameter else ""
    if not extension:
        extension = program.postConfiguration.extension
    extension = "." + str(extension).lstrip(".").lower()
    if extension not in NC_EXTENSIONS:
        raise ValueError("Choose a post that outputs .nc, .cnc, .gcode, .tap, or .ngc files.")

    original_name = str(file_parameter.value.value)
    stem = re.sub(r"[^A-Za-z0-9 ._-]", "_", original_name).strip(" ._")
    if not stem or not stem[0].isalnum():
        stem = "program_" + stem
    stem = stem[:180]
    program_name = _display_name(program.name, "NC program")
    document_name = _display_name(document.name, "Untitled")
    overrides = []
    restore_splitting = None

    with tempfile.TemporaryDirectory(prefix="openspindle-fusion-") as directory:
        values = [
            (folder_parameter, directory.replace("\\", "/")),
            (file_parameter, stem),
            (editor_parameter, False),
        ]
        # Keep the export local and preserve a saved NC program after posting.
        # Older Fusion releases may not expose these optional parameters.
        for name, value in (
            ("nc_program_postToFusionTeam", False),
            ("nc_program_createInBrowser", True),
        ):
            parameter = parameters.itemByName(name)
            if parameter:
                values.append((parameter, value))
        try:
            ensure_live()
            if _application().activeDocument != document or not program.isValid:
                raise BridgeError(410, "The selected Fusion document or NC program changed. Refresh and try again.")
            for parameter, value in values:
                overrides.append((parameter, parameter.value.value))
                parameter.value.value = value
            restore_splitting = _without_splitting(program)
            _write_setup(setup, directory)
            options = adsk.cam.NCProgramPostProcessOptions.create()
            options.postProcessExecutionBehavior = (
                adsk.cam.PostProcessExecutionBehaviors.PostProcessExecutionBehavior_Fail
            )
            options.isFailOnToolNumberDuplication = True
            ensure_live()
            if not program.postProcess(options):
                raise ValueError("Fusion could not post this NC program.")
        finally:
            restore_errors = []
            if restore_splitting is not None:
                try:
                    restore_splitting()
                except Exception:
                    restore_errors.append(_SPLIT_PROPERTY)
            for parameter, value in reversed(overrides):
                try:
                    parameter.value.value = value
                except Exception:
                    restore_errors.append(parameter.name)
            if restore_errors:
                raise RuntimeError(
                    "Could not restore NC program settings: " + ", ".join(restore_errors)
                    + ". Review the NC program settings in Fusion before posting again."
                )

        files = [
            path for path in Path(directory).rglob("*")
            if path.is_file() and path.suffix.lower() != ".log" and path.name != _SETUP_FILE
        ]
        programs = [path for path in files if path.suffix.lower() in NC_EXTENSIONS]
        if not programs:
            raise ValueError(
                "The post wrote no NC file. Choose a post that outputs .nc, .cnc, .gcode, .tap, or .ngc files."
            )
        path = programs[0]
        if len(programs) > 1:
            # Split despite the setting: the whole program, if the post writes it at all, is
            # the file named after the NC program; the others are its parts.
            named = [
                item for item in programs
                if item.name.lower() == (stem + extension).lower()
            ]
            if not named:
                raise ValueError(_SPLIT_OUTPUT)
            path = named[0]
        if path.is_symlink() or not path.resolve().is_relative_to(Path(directory).resolve()):
            raise ValueError("The posted NC file must be inside the temporary export folder.")
        with path.open("rb") as output:
            encoded = output.read(MAX_PROGRAM_BYTES + 1)
        if len(encoded) > MAX_PROGRAM_BYTES:
            raise ValueError("The posted NC program exceeds 10 MiB.")
        try:
            contents = encoded.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise ValueError("The post must produce UTF-8 or ASCII NC text.") from error
        if not contents.strip() or "\x00" in contents:
            raise ValueError("The posted NC program is empty or contains NUL bytes.")
        # What the program tells OpenSpindle of its setup, as the post wrote it.
        markers = [line.strip() for line in contents.splitlines() if line.startswith(";@OPENSPINDLE")]
        _log("Program markers: " + (" ".join(markers[:40])[:4000] or "none"))
        # Other files beside it are its parts or subprograms: it must hold the whole program.
        if len(files) > 1 and not _whole_program(contents):
            raise ValueError(_SPLIT_OUTPUT)
        return {
            "id": program_id,
            "name": program_name,
            "documentName": document_name,
            **_program_reference(document, program),
            "fileName": stem + path.suffix.lower(),
            "contents": contents,
        }


def _handle_request(action, program_id, ensure_live):
    if action == "list":
        return {"programs": _refresh_catalog(ensure_live)}
    app = _application()
    ui = app.userInterface
    # The connection-code command has no model edits and may still be open
    # after pairing. Never cancel a user's unrelated Fusion command.
    if ui.activeCommand == _CONNECTION_ID:
        ui.commandDefinitions.itemById("SelectCommand").execute()
    if ui.activeCommand != "SelectCommand":
        raise BridgeError(409, "Finish or cancel the active command in Fusion, then try again.")
    _refresh_catalog(ensure_live)
    entry = _catalog.get(program_id)
    if entry is None:
        raise BridgeError(410, "This NC program was deleted or its document was closed. Refresh the program list.")
    document, program = entry
    previous_document = app.activeDocument
    try:
        ensure_live()
        if previous_document != document and not document.activate():
            raise BridgeError(409, "Fusion could not activate the selected NC program's document.")
        ensure_live()
        if app.activeDocument != document or not document.isValid or not program.isValid:
            raise BridgeError(410, "The selected Fusion document or NC program is no longer available.")
        if ui.activeCommand != "SelectCommand":
            raise BridgeError(409, "Finish or cancel the active command in Fusion, then try again.")
        return _post_snapshot(document, program, program_id, ensure_live)
    finally:
        # Even a cancelled/timed-out HTTP caller cannot bypass restoration after
        # Fusion's synchronous native postProcess call returns.
        if (
            previous_document is not None and previous_document.isValid
            and previous_document != document and app.activeDocument == document
        ):
            if not previous_document.activate():
                raise BridgeError(500, "The NC program was posted, but Fusion could not restore the previously active document.")


def _close_connection_dialog():
    # A pending request means Connect was clicked again: its dialog shows a new code.
    if _bridge is None or _bridge.pending_pairing() is not None:
        return
    ui = _application().userInterface
    try:
        # Only the code dialog closes, never a command the user started since.
        if ui.activeCommand == _CONNECTION_ID:
            ui.terminateActiveCommand()
    except Exception:
        pass


class _MainThreadHandler(adsk.core.CustomEventHandler):
    def __init__(self, requests):
        super().__init__()
        self.requests = requests

    def notify(self, args):
        if args.additionalInfo == PAIRED:
            _close_connection_dialog()
            return
        self.requests.execute(args.additionalInfo, _handle_request)


class _ConnectionCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        command = args.command
        command.okButtonText = "Close"
        command.isCancelButtonVisible = False
        command.commandInputs.addTextBoxCommandInput(
            "pairingCode", "Connection code", _bridge.begin_pairing(), 1, True
        )
        command.commandInputs.addTextBoxCommandInput(
            "pairingInstructions", "",
            "Enter this code in the OpenSpindle connection dialog. "
            "Keep OpenSpindle open on this computer. The code expires in two minutes.",
            3, True,
        )


def _remove_ui(ui):
    errors = []
    # Panel IDs are global. Deleting a tab alone can leave its panel behind,
    # so also find panels orphaned by an interrupted or older add-in session.
    for collection_name, item_id, label in (
        ("allToolbarPanels", _PANEL_ID, "toolbar panel"),
        ("allToolbarTabs", _TAB_ID, "toolbar tab"),
        ("commandDefinitions", _CONNECTION_ID, "connection command"),
    ):
        try:
            item = getattr(ui, collection_name).itemById(item_id)
            if item is not None and not item.deleteMe():
                raise ValueError("Fusion refused to delete the " + label + ".")
        except Exception as error:
            errors.append(label + ": " + str(error))
    return errors


def _cleanup():
    global _bridge, _custom_event, _custom_handler
    errors = []
    if _bridge is not None:
        # Wake workers before unregistering their main-thread event.
        try:
            _bridge.stop()
        except Exception as error:
            errors.append("local connection: " + str(error))
        finally:
            _bridge = None
    app = _application()
    if _custom_event is not None:
        try:
            if _custom_handler is not None:
                _custom_event.remove(_custom_handler)
        except Exception as error:
            errors.append("request handler: " + str(error))
        try:
            if not app.unregisterCustomEvent(_EVENT_ID):
                raise ValueError("Fusion refused to unregister the request event.")
        except Exception as error:
            errors.append("request event: " + str(error))
        finally:
            _custom_event = None
            _custom_handler = None
    # A transport or event error must not skip UI cleanup.
    errors.extend(_remove_ui(app.userInterface))
    _handlers.clear()
    _catalog.clear()
    return errors


def run(_context):
    global _bridge, _custom_event, _custom_handler
    if _bridge is not None:
        return
    try:
        app = _application()
        _custom_event = app.registerCustomEvent(_EVENT_ID)
        if _custom_event is None:
            raise ValueError("Fusion could not register the OpenSpindle request event.")
        # Capture the one documented thread-safe API method on the main thread.
        fire_event = app.fireCustomEvent
        _bridge = SnapshotBridge(
            lambda request_id: fire_event(_EVENT_ID, request_id), _pairings_path()
        )
        _custom_handler = _MainThreadHandler(_bridge.requests)
        if not _custom_event.add(_custom_handler):
            raise ValueError("Fusion could not attach the OpenSpindle request handler.")
        ui = app.userInterface
        cleanup_errors = _remove_ui(ui)
        if cleanup_errors:
            raise ValueError("Could not remove the previous OpenSpindle toolbar.\n" + "\n".join(cleanup_errors))
        workspace = ui.workspaces.itemById("CAMEnvironment")
        tab = workspace.toolbarTabs.add(_TAB_ID, "OpenSpindle")
        panel = tab.toolbarPanels.add(_PANEL_ID, "OpenSpindle")
        handler = _ConnectionCreatedHandler()
        definition = ui.commandDefinitions.addButtonDefinition(
            _CONNECTION_ID, "Connect to OpenSpindle",
            "Request a connection and show its one-time code.",
        )
        if not definition.commandCreated.add(handler):
            raise ValueError("Fusion could not attach the OpenSpindle connection command.")
        _handlers.append(handler)
        control = panel.controls.addCommand(definition)
        control.isPromoted = True
        # Only accept requests once the event handler and UI are ready.
        _bridge.start()
    except Exception as error:
        cleanup_errors = _cleanup()
        message = "OpenSpindle Bridge could not start.\n\n" + str(error)
        if cleanup_errors:
            message += "\n\nCleanup also reported:\n" + "\n".join(cleanup_errors)
        _show_error(message)


def stop(_context):
    errors = _cleanup()
    if errors:
        _show_error("OpenSpindle Bridge cleanup could not finish.\n\n" + "\n".join(errors))
