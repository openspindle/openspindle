"""Authenticated loopback transport for Fusion main-thread program requests.

No Autodesk objects are accessed here. The only callback into Fusion is the
thread-safe fireCustomEvent method captured by the add-in on the main thread.
"""

from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
import secrets
import select
import socket
import threading
import time
import uuid


HOST = "127.0.0.1"
PORT = 38764
DISCOVERY_PORT = 38765
PAIRING_SECONDS = 120
MAX_PAIRING_ATTEMPTS = 5
MAX_PAIRING_BYTES = 1024
MAX_HTTP_REQUESTS = 8
MAX_PENDING_REQUESTS = 4
MAX_PROGRAM_BYTES = 10 * 1024 * 1024
MAX_PROGRAMS = 100
LIST_SECONDS = 8
POST_SECONDS = 120
NC_EXTENSIONS = frozenset((".nc", ".cnc", ".gcode", ".tap", ".ngc"))
_PROGRAM_PATH = re.compile(r"/v2/programs/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/post\Z")
_PAIRING_CODE = re.compile(r"[0-9]{6}\Z")


@dataclass
class PairingOffer:
    request_id: str
    code: str
    expires_at: int
    deadline: float
    attempts: int = 0

    def metadata(self):
        return {"requestId": self.request_id, "expiresAt": self.expires_at}


def _unique_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON property.")
        result[key] = value
    return result


class BridgeError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def _error_payload(message):
    text = re.sub(r"[\x00-\x1f\x7f-\x9f\ud800-\udfff]", " ", str(message)).strip()
    return {"error": text[:500] or "Fusion could not complete the request."}


def _connection_open(connection):
    try:
        readable, _, _ = select.select([connection], [], [], 0)
        # This protocol accepts exactly one request per connection, with its
        # complete body consumed before dispatch. EOF or extra input cancels it.
        return not readable
    except (OSError, ValueError):
        return False


@dataclass
class _MainThreadRequest:
    action: str
    program_id: str | None
    deadline: float
    connection: object
    done: threading.Event = field(default_factory=threading.Event)
    cancelled: bool = False
    started: bool = False
    response: tuple | None = None

    def ensure_live(self):
        if self.cancelled or not _connection_open(self.connection):
            raise BridgeError(499, "The OpenSpindle request was cancelled.")
        if time.monotonic() >= self.deadline:
            raise BridgeError(504, "Fusion did not finish in time. Finish any open Fusion dialog and try again.")


class MainThreadRequests:
    def __init__(self, fire_event):
        self._fire_event = fire_event
        self._lock = threading.Lock()
        self._pending = {}
        self._executing = False
        self._stopped = False

    def request(self, action, program_id, connection):
        request_id = str(uuid.uuid4())
        seconds = POST_SECONDS if action == "post" else LIST_SECONDS
        request = _MainThreadRequest(action, program_id, time.monotonic() + seconds, connection)
        with self._lock:
            if self._stopped:
                raise BridgeError(503, "The OpenSpindle bridge is stopping.")
            if len(self._pending) >= MAX_PENDING_REQUESTS or self._executing:
                raise BridgeError(409, "Fusion is handling another OpenSpindle request. Try again when it finishes.")
            # A second explicit import cannot queue behind an earlier import.
            if action == "post" and any(item.action == "post" for item in self._pending.values()):
                raise BridgeError(409, "An NC program import is already pending in Fusion.")
            self._pending[request_id] = request
        try:
            try:
                # Fusion 2705.1.15 on macOS queues this event but returns False.
                # Only the main-thread handler's response confirms completion;
                # an undelivered event remains bounded by the request deadline.
                self._fire_event(request_id)
            except Exception as error:
                detail = type(error).__name__ + ": " + str(error)
                raise BridgeError(503, "Fusion could not schedule the request: " + detail) from None
            while not request.done.wait(0.05):
                request.ensure_live()
            return request.response
        finally:
            with self._lock:
                request.cancelled = True
                # An executing callback retains the busy gate until its finally
                # block, even when the caller has disconnected or timed out.
                if not request.started:
                    self._pending.pop(request_id, None)

    def execute(self, request_id, handler):
        # Called only by Fusion's custom event handler on its main thread.
        with self._lock:
            request = self._pending.get(request_id)
            if request is None or self._stopped or request.started:
                return
            if self._executing:
                request.response = (409, _error_payload("Fusion is still posting an NC program. Try again when it finishes."))
                self._pending.pop(request_id, None)
                request.done.set()
                return
            request.started = True
            self._executing = True
        try:
            request.ensure_live()
            payload = handler(request.action, request.program_id, request.ensure_live)
            request.ensure_live()
            response = (200, payload)
        except BridgeError as error:
            response = (error.status, _error_payload(error))
        except ValueError as error:
            response = (422, _error_payload(error))
        except Exception as error:
            response = (500, _error_payload("Fusion could not complete the request: " + str(error)))
        finally:
            with self._lock:
                self._executing = False
                self._pending.pop(request_id, None)
        # Stop and timed-out clients discard results, including a late native
        # postProcess result. The native call itself cannot safely be interrupted.
        if not request.cancelled:
            request.response = response
            request.done.set()

    def stop(self):
        with self._lock:
            self._stopped = True
            for request in self._pending.values():
                request.cancelled = True
                request.response = (503, _error_payload("The OpenSpindle bridge is stopping."))
                request.done.set()
            self._pending.clear()


class _SnapshotRequestHandler(BaseHTTPRequestHandler):
    # One request per connection; no keep-alive sockets survive add-in stop.
    protocol_version = "HTTP/1.0"
    server_version = "OpenSpindleBridge/2"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, _format, *_args):
        # Never put pairing credentials or document paths in HTTP logs.
        pass

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
        except (OSError, ValueError):
            pass

    def _is_local_request(self):
        if self.server.bridge.is_stopping():
            self._send_json(503, {"error": "The OpenSpindle bridge is stopping."})
            return False
        if self.headers.get_all("Host") != [f"{HOST}:{PORT}"]:
            self._send_json(403, {"error": "Invalid host."})
            return False
        if self.headers.get_all("Origin") is not None:
            self._send_json(403, {"error": "Browser requests are not supported."})
            return False
        return True

    def _is_authorized(self):
        authorization = self.headers.get_all("Authorization", [])
        expected = ("Bearer " + self.server.bridge.token).encode("utf-8")
        if len(authorization) != 1 or not secrets.compare_digest(
            authorization[0].encode("utf-8"), expected
        ):
            self._send_json(401, {"error": "Invalid session token."})
            return False
        return True

    def _fusion_request(self, action, program_id=None):
        try:
            status, result = self.server.bridge.requests.request(action, program_id, self.connection)
        except BridgeError as error:
            status, result = error.status, _error_payload(error)
        self._send_json(status, result)

    def do_GET(self):
        if not self._is_local_request():
            return
        if self.path == "/v1/pairing":
            offer = self.server.bridge.pending_pairing()
            if offer is None:
                self._send_json(404, {"error": "No connection request is pending."})
            else:
                self._send_json(200, offer)
            return
        if not self._is_authorized():
            return
        if self.path == "/v2/programs":
            if (
                self.headers.get_all("Transfer-Encoding") is not None
                or self.headers.get_all("Content-Length", ["0"]) != ["0"]
            ):
                self._send_json(400, {"error": "The program list request must not contain a body."})
                return
            self._fusion_request("list")
            return
        self._send_json(404, {"error": "Unknown route. Update the OpenSpindle app and Fusion add-in together."})

    def _read_json(self):
        if self.headers.get_all("Content-Type") != ["application/json"]:
            raise BridgeError(415, "The request requires application/json.")
        lengths = self.headers.get_all("Content-Length", [])
        if (
            self.headers.get_all("Transfer-Encoding") is not None
            or len(lengths) != 1
            or not re.fullmatch(r"[0-9]{1,4}", lengths[0])
        ):
            raise BridgeError(400, "Invalid request length.")
        length = int(lengths[0])
        if not 0 < length <= MAX_PAIRING_BYTES:
            raise BridgeError(413, "The request is too large.")
        try:
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError("Incomplete request.")
            return json.loads(body.decode("utf-8", errors="strict"), object_pairs_hook=_unique_json_object)
        except (ValueError, UnicodeError, OSError):
            raise BridgeError(400, "Invalid JSON request.") from None

    def do_POST(self):
        if not self._is_local_request():
            return
        pairing = self.path == "/v1/pairing"
        if not pairing and not self._is_authorized():
            return
        match = _PROGRAM_PATH.fullmatch(self.path)
        if not pairing and not match:
            self._send_json(404, {"error": "Unknown route. Update the OpenSpindle app and Fusion add-in together."})
            return
        try:
            payload = self._read_json()
            if not pairing:
                if not isinstance(payload, dict) or payload:
                    raise BridgeError(400, "Posting requires an empty JSON object.")
                self._fusion_request("post", match.group(1))
                return
            if (
                not isinstance(payload, dict)
                or set(payload) != {"requestId", "code"}
                or not isinstance(payload["requestId"], str)
                or len(payload["requestId"]) != 36
                or not isinstance(payload["code"], str)
                or not _PAIRING_CODE.fullmatch(payload["code"])
            ):
                raise BridgeError(400, "Invalid pairing request.")
            status, result = self.server.bridge.complete_pairing(payload["requestId"], payload["code"])
            self._send_json(status, result)
        except BridgeError as error:
            self._send_json(error.status, _error_payload(error))


class _SnapshotHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = False
    daemon_threads = True
    block_on_close = False

    def __init__(self, *args):
        self._requests_lock = threading.Lock()
        self._requests = set()
        self._request_slots = threading.BoundedSemaphore(MAX_HTTP_REQUESTS)
        super().__init__(*args)

    def get_request(self):
        request, address = super().get_request()
        with self._requests_lock:
            self._requests.add(request)
        return request, address

    def process_request(self, request, address):
        if not self._request_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except Exception:
            self._request_slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self._request_slots.release()

    def close_request(self, request):
        try:
            super().close_request(request)
        finally:
            with self._requests_lock:
                self._requests.discard(request)

    def server_close(self):
        super().server_close()
        # shutdown() stops acceptance before this runs. Interrupt reads from
        # clients that trickle bytes so they cannot keep the add-in alive.
        with self._requests_lock:
            requests = list(self._requests)
            self._requests.clear()
        for request in requests:
            try:
                request.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            request.close()

    def handle_error(self, _request, _client_address):
        # Socket timeouts and disconnected clients need no Fusion UI action.
        pass


class SnapshotBridge:
    def __init__(self, fire_event):
        self.token = secrets.token_urlsafe(32)
        self.requests = MainThreadRequests(fire_event)
        self._pairing_lock = threading.Lock()
        self._pairing = None
        self._stopping = threading.Event()
        self._announcement_changed = threading.Event()
        self._server = _SnapshotHTTPServer((HOST, PORT), _SnapshotRequestHandler)
        self._server.bridge = self
        self._thread = threading.Thread(
            target=self._server.serve_forever,
            name="OpenSpindleFusionBridge",
            daemon=True,
        )
        self._announcement_thread = threading.Thread(
            target=self._announce_pairing,
            name="OpenSpindlePairingAnnouncements",
            daemon=True,
        )

    def begin_pairing(self):
        with self._pairing_lock:
            if self._stopping.is_set():
                raise ValueError("The OpenSpindle bridge is stopping.")
            offer = PairingOffer(
                str(uuid.uuid4()),
                f"{secrets.randbelow(1_000_000):06d}",
                int(time.time() * 1000) + PAIRING_SECONDS * 1000,
                time.monotonic() + PAIRING_SECONDS,
            )
            self._pairing = offer
        self._announcement_changed.set()
        return offer.code

    def is_stopping(self):
        return self._stopping.is_set()

    def _active_pairing(self):
        # Called only while holding _pairing_lock. Wall-clock changes must not
        # extend the time in which a six-digit code can be guessed.
        if self._pairing is not None and time.monotonic() >= self._pairing.deadline:
            self._pairing = None
        return self._pairing

    def pending_pairing(self):
        with self._pairing_lock:
            offer = self._active_pairing()
            if offer is None or offer.attempts >= MAX_PAIRING_ATTEMPTS:
                return None
            return offer.metadata()

    def complete_pairing(self, request_id, code):
        with self._pairing_lock:
            offer = self._active_pairing()
            if offer is None or offer.request_id != request_id:
                return 410, {"error": "The connection request expired or is no longer available."}
            if offer.attempts >= MAX_PAIRING_ATTEMPTS:
                return 429, {"error": "Too many attempts. Connect to OpenSpindle again in Fusion."}
            if not secrets.compare_digest(offer.code, code):
                offer.attempts += 1
                if offer.attempts >= MAX_PAIRING_ATTEMPTS:
                    self._announcement_changed.set()
                    return 429, {"error": "Too many attempts. Connect to OpenSpindle again in Fusion."}
                return 401, {"error": "The code does not match the one shown in Fusion."}
            self._pairing = None
            self._announcement_changed.set()
            # One bearer belongs to this Fusion session. Opening or failing a
            # new connection request cannot revoke an already paired app.
            return 200, {"token": self.token}

    def _announce_pairing(self):
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as announcement:
            announcement.bind((HOST, 0))
            announcement.settimeout(1)
            while not self._stopping.is_set():
                self._announcement_changed.clear()
                offer = self.pending_pairing()
                if offer is not None:
                    payload = {
                        "type": "openspindle.fusion.pairing",
                        "version": 1,
                        **offer,
                    }
                    try:
                        announcement.sendto(
                            json.dumps(payload, separators=(",", ":")).encode("utf-8"),
                            (HOST, DISCOVERY_PORT),
                        )
                    except OSError:
                        # OpenSpindle may not be running yet. The next tick
                        # retries the announcement without extending its life.
                        pass
                self._announcement_changed.wait(timeout=1)

    def start(self):
        self._thread.start()
        self._announcement_thread.start()

    def stop(self):
        self._stopping.set()
        self.requests.stop()
        self._announcement_changed.set()
        with self._pairing_lock:
            self._pairing = None
        if self._announcement_thread.is_alive():
            self._announcement_thread.join(timeout=2)
        if self._thread.is_alive():
            self._server.shutdown()
            self._thread.join(timeout=6)
        self._server.server_close()
