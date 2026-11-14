import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { RUN_LIMITS } from "../../contract/index.ts"
import { ProgramError } from "../adapter.ts"
import { prepareMakeraProgram } from "./dialect.ts"

const prepare = (...lines: string[]) =>
  prepareMakeraProgram(`${lines.join("\n")}\n`)

/** The lines the machine receives. */
const sent = (...lines: string[]) =>
  prepare(...lines)
    .text.split("\n")
    .slice(0, -1)

const speedChanges = (...lines: string[]) =>
  prepare(...lines).changes.filter(
    (change) => change.reason === "spindle-speed"
  )

describe("tool-change spindle interlock", () => {
  test("refuses an M3/M4 in the same block as M6", () => {
    for (const line of [
      "T2 M6 M3 S12000",
      "M6 T2 M3 S12000",
      "M3 S12000 M6 T2",
      "T2 M6 M4 S12000",
    ]) {
      assert.throws(
        () => prepare(line),
        (error) =>
          error instanceof ProgramError &&
          error.line === 1 &&
          /before tool calibration completes/.test(error.message),
        line
      )
    }
  })

  test("allows spindle start on a following line after tool change", () => {
    assert.deepEqual(sent("T2 M6", "M3 S12000"), ["T2 M6", "M3 S12000"])
  })
})

describe("spindle speed", () => {
  test("pcb2gcode's speed on a line of its own reaches its bare M3", () => {
    const program = prepare(
      "G21",
      "S12000    (RPM spindle speed.)",
      "T1",
      "M5      (Spindle stop.)",
      "M6      (Tool change.)",
      "M0      (Temporary machine stop.)",
      "M3        (Spindle on clockwise.)"
    )
    assert.deepEqual(program.text.split("\n").slice(0, -1), [
      "G21",
      "S12000",
      "T1",
      "M5",
      "M6 T1",
      "",
      "M3 S12000",
    ])
    assert.deepEqual(
      program.changes.filter((change) => change.reason === "spindle-speed"),
      [{ line: 7, before: "M3", after: "M3 S12000", reason: "spindle-speed" }]
    )
  })

  test("pcb2gcode's speed on a G0 reaches its bare M3", () => {
    assert.deepEqual(
      sent("G00 S12000     (RPM spindle speed.)", "T1", "M6", "M3").at(-1),
      "M3 S12000"
    )
  })

  test("an M3 whose command has an S is sent as written", () => {
    assert.deepEqual(
      speedChanges("S9000", "M3 S10000", "S10000 M3", "G0 S10000 M3"),
      []
    )
  })

  test("the S the program set last counts, an M3's own too", () => {
    assert.equal(sent("S10000", "S12000", "M3").at(-1), "M3 S12000")
    assert.equal(sent("M3 S9000", "M5", "M3").at(-1), "M3 S9000")
    assert.equal(sent("S012000.50", "M3").at(-1), "M3 S012000.50")
  })

  test("an S another code takes is no speed", () => {
    // M223 S is the rpm override in percent, G4 S the Z1's dwell in seconds.
    assert.equal(sent("S12000", "M223 S80", "G4 S2", "M3").at(-1), "M3 S12000")
  })

  test("an M3 before any S is sent bare", () => {
    assert.deepEqual(sent("M3", "G1 X1 F100"), ["M3", "G1 X1 F100"])
    assert.deepEqual(speedChanges("M3"), [])
  })

  test("an M4 gets the speed too", () => {
    assert.equal(sent("S12000", "M4").at(-1), "M4 S12000")
  })

  test("the speed goes where the firmware reads it with the M3", () => {
    // GcodeDispatch.cpp splits a line into commands: one starting with M ends at the next G
    // or M, one starting with T at the first S after its M code, and a G line has its G90
    // moved to the front first, which here joins M5 and T1 into one command.
    const cases = {
      "M3 G0 X1": "M3 S12000 G0 X1",
      "M3 M8": "M3 S12000 M8",
      "G0 X1 M3": "G0 X1 M3 S12000",
      "T1 M3": "T1 S12000 M3",
      "Z-1 M5 G90 T1 M3": "Z-1 M5 G90 T1 M3 S12000",
      "M3 G0 S15000": "M3 S15000 G0 S15000",
      "n10 m3": "M3 S12000",
    }
    for (const [line, expected] of Object.entries(cases))
      assert.equal(sent("S12000", line).at(-1), expected, line)
  })

  test("a line the speed takes past 63 bytes is refused", () => {
    const line = (length: number) => `G1 X${"1".repeat(length - 7)} M3`
    assert.equal(sent("S12000", line(56)).at(-1)?.length, 63)
    assert.throws(
      () => prepare("S12000", line(57)),
      (error) =>
        error instanceof ProgramError &&
        error.line === 2 &&
        /63-byte line limit/.test(error.message)
    )
  })

  test("a part after the first gets the speed an earlier part set", () => {
    const moves = Array.from(
      { length: RUN_LIMITS.fileLines * 0.6 },
      (_, index) => `G1 X${index % 10}`
    )
    const source = [
      ["G21", "G90", "S12000", "T1", "M6", "M3", "G1 X0 F100"],
      moves,
      ["M5", "T2", "M6", "M3"],
      moves,
      ["M5", "M2"],
    ].flat()
    const program = prepareMakeraProgram(`${source.join("\n")}\n`)
    const lines = program.text.split("\n")
    assert.equal(program.parts.length, 2)
    const [, second] = program.parts
    assert.equal(lines[second.startLine - 1], "M6 T2")
    assert.equal(lines[second.startLine], "M3 S12000")
    assert.deepEqual(second.before, ["G21 G90", "F100"])
  })
})
