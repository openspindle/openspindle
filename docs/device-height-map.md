# Reading the current height map

Open **Measured heights** from the Device page's Height map card, then choose **Retrieve M375.1**. During a job that probes a height map the Job tab's review step reads it automatically at the review pause and analyses it ([height-map.md](height-map.md)). The view shows the device, retrieval time, colour-coded values, minimum/maximum/range, missing measurements and the original firmware output. Snapshots are kept per device for the workspace; they are not attached to a plate or used to move its planned probing grid.

`machine.readHeightMap` sends exactly `M375.1` after a fresh status: never `M375`, which loads a saved grid and enables compensation, and never a probing or motion command. The read is admitted when the machine is Idle with no program, or while a job waits at a program pause (a height map's review point). During any other program it is deferred until the program ends; the caller can cancel the deferred read.

The response has an 8 s deadline and must end with its acknowledgement. Stop cancels the read; rows that still arrive (and the late acknowledgement) are swallowed for 2 s so they cannot satisfy a later command, whose own telemetry proof is required anyway.

The firmware prints plain numeric rows or human-readable rows prefixed by Y with a divider and X labels. The parser requires the complete matrix and preserves the reported order. `nan` becomes `null`. Output is limited to 128 KiB of ASCII, 255 samples per axis and 16,384 samples; values are bounded to ±10,000 mm. Malformed data is an error, never replacement zeroes.

`heights` are relative compensation values in millimetres, not absolute machine Z. `xCoordinates`/`yCoordinates` are offsets from the grid start; plain output has none. The grid may come from an earlier probe or a loaded file: a successful read does not prove it belongs to the selected plate or that compensation is enabled. `deviceId` identifies the model/name profile. Stored snapshots are validated against the `HeightMap` schema.

Firmware evidence, in [Makera's Z1 firmware](https://github.com/MakeraInc/MakeraZ1Firmware/tree/b3a2e26a9eaa2b01358f74ccdef549b993a08175): `CartGridStrategy.cpp` lines 453–460 (display versus load), 696–699 (relative samples), 811–883 (both layouts); `GcodeDispatch.cpp` lines 389–430 (acknowledgement after handler output).
