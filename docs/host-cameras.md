# Two cameras and job timelapses

The host browser can show **Makera camera**, **Workshop webcam**, or **Both cameras**. Each camera has independent Enable/Disable controls and job-timelapse settings. Changing the visible view, signing out or closing the browser does not disable capture or stop recording. Cameras start off after a host restart; opening the monitor or receiving a FreeCAD package never enables one.

The Makera camera uses the verified machine owner's existing camera subscription. For USB machine control, configure the separate camera network address as described in [USB serial](usb-serial.md). A machine disconnection/change closes that camera subscription and clears its cached frame. Re-enable it after reconnecting. Upload preparation can pause the machine camera; an old frame is never repeatedly added to a timelapse.

The workshop camera is a USB UVC webcam attached to the **host**, not the phone/laptop running the browser. Local capture currently targets Linux V4L2, including Raspberry Pi OS. A Raspberry Pi CSI camera that exposes a compatible V4L2 capture device may also work, but libcamera-only devices are not directly supported. macOS/Windows capture sources are not implemented in this host version.

## Host setup

Install `ffmpeg` with V4L2 input and `libx264` encoding, and optionally `v4l-utils` for identifying a camera. Run `v4l2-ctl --list-devices` and `v4l2-ctl --device=/dev/video0 --list-formats-ext` on the host to find its actual capture endpoint. Many webcams expose more than one `/dev/videoN`; select a video-capture endpoint, not its metadata endpoint.

Set these in the host's protected environment file:

```text
OPENSPINDLE_WEBCAM_DEVICE=/dev/video0
# Optional if ffmpeg is not on the service user's PATH:
OPENSPINDLE_FFMPEG=/usr/bin/ffmpeg
```

A stable `/dev/v4l/by-id/<device>` path is also accepted. Device paths come only from operator configuration; browser API requests cannot choose executables, device paths, network URLs or shell arguments. Give the service user access to the camera using the system's video group/udev policy, then restart the service. The deployment template leaves supplementary device groups to the local administrator; for example, set `SupplementaryGroups=video dialout` in a systemd override when those groups exist and both camera/serial access are needed. Do not run the controller as root. Containers require explicitly passing the video device through.

The preview uses a conservative ten-fps capture request, downsampled to **two JPEGs per second at up to 640×480**, without audio. Visible browser tiles request the latest JPEG about once per second; they do not create a capture process per viewer. There is one ffmpeg process for the webcam. Missing ffmpeg, an unavailable/busy device, permissions and a stalled image stream produce a camera error. Re-enable explicitly after correcting it; there is no camera restart loop. The Makera camera keeps its native image dimensions.

## Timelapse controls

1. Enable the camera(s) to use.
2. For each camera, select **Record job timelapse**, set **Seconds between frames** (1–300, default 10), and save.
3. Start a reviewed job through the existing host workflow. Receiving or selecting a package is not a Run.
4. In **History**, select the job. Each recorded camera gets its own frame count and **Build / refresh MP4** button. Build plays a 24-fps H.264 MP4 in the browser and enables **Download MP4**. Export works while a job is open, using the frames committed when export started; refresh it for newer frames.

Timelapse settings persist in `cameras.json`. Capture requires both an enabled camera and an opted-in recording setting. After a host restart, enable the camera again; existing jobs/recordings are never resumed automatically. Turning a camera or its recording setting off leaves existing frames intact and creates a gap; turning it back on during the same open job continues its sequence. Preparation and pauses are included while frames remain fresh. No microphone/audio is captured. Both cameras are sampled independently; this is not synchronized video, and it must not be used as proof of the machine's physical state.

Recording runs in the host even if every browser closes. Camera capture and optional one-thread MP4 encoding are separate OS processes from the machine worker. Slow disks skip capture passes instead of accumulating a queue; camera/export failures do not send machine commands. A shutdown finishes current writes and marks recordings closed. Restart recovery marks open recordings interrupted. A stale/disconnected machine remains an unknown physical outcome, regardless of camera images.

## Files and limits

Each job's `job-history/<job-id>/timelapse/machine/` and `webcam/` directories contain ordered JPEGs and `manifest.json` with source/receipt timestamps, capture intervals, byte count and closing reason. The live preview does not write JPEGs unless recording is enabled during a host-owned archived job. Existing small history screenshots remain supported separately.

A recording stops at **3,600 frames or 128 MiB per camera/job**; the host has a **1 GiB total timelapse JPEG budget**. The limit is reported in its manifest/history tile. At the default interval, 3,600 frames cover ten hours; at one second, one hour. Space for the NC/archive and temporary MP4 export is additional. No old recordings are deleted automatically. To free space, stop the host and back up/remove older inactive job directories, then restart so its usage is recounted. Back up `job-history` and `cameras.json` along with the normal host data.

Only one MP4 export runs at once, with one encoder thread, a three-minute encoding limit and a bounded download inactivity timeout. Export requires local `ffmpeg`/`libx264`, does not rewrite source frames and cleans up its temporary MP4 after transfer. Restart also cleans up interrupted temporary exports. On small Pis, large exports may exceed the limit; the source JPEGs and timestamps remain available for offline encoding.

Authenticated endpoints are `/api/cameras/{machine|webcam}/{start|stop|timelapse}`, `/api/cameras/{id}/frame`, `/api/history/{job-id}/timelapses`, `/api/history/{job-id}/timelapses/{id}/frames/{index}` and POST `/api/history/{job-id}/timelapses/{id}/export`. The recording settings endpoint takes `{enabled:boolean,intervalSeconds:integer}`. All use the same access key/origin restrictions as the monitor. Camera URLs never contain access keys. Existing `/api/camera` machine-camera routes remain compatible.

Implementation was checked through desktop/host builds, typechecking, lint/formatting and local runtime/FFmpeg inspection. A real UVC webcam, Makera stream and Raspberry Pi performance still need operator verification. No automated test suite was added or run under the repository's testing convention.

Reference: [FFmpeg V4L2 devices](https://ffmpeg.org/ffmpeg-devices.html#video4linux2_002c-v4l2).
