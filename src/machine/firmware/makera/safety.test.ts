import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { Telemetry } from "../../contract/index.ts"
import { MachineError } from "../../core/errors.ts"
import { toolResetForRun } from "../../core/operations/job-runner.ts"
import { makeraAdapter } from "./adapter.ts"
import { makeraRules } from "./commands.ts"
import { prepareMakeraProgram } from "./dialect.ts"

/** Only the fields these safety rules inspect are needed. */
const ready = (changes: Partial<Telemetry> = {}): Telemetry => {
  return {
    state: "Idle",
    job: null,
    estop: false,
    spindleOn: false,
    spindleRpm: 0,
    laserMode: false,
    bedCleanAuto: false,
    toolSetterTriggered: false,
    tool: 2,
    ...changes,
  } as Telemetry
}

const manualZ1 = { model: "Z1", atc: false }
const atcZ1 = { model: "Z1", atc: true }
const job = makeraAdapter.job
const toolChange = prepareMakeraProgram("M5\nT2 M6\nM3 S12000\n")
const spindleOnly = prepareMakeraProgram("M3 S12000\nM5\n")

describe("tool-setter safety", () => {
  test("Run and spindle start require the tool setter released", () => {
    assert.equal(makeraRules.run(ready()), null)
    assert.equal(
      makeraRules.command({ type: "spindleStart", rpm: 10000 }, ready()),
      null
    )
    for (const triggered of [true, null] as const) {
      const status = ready({ toolSetterTriggered: triggered })
      assert.match(makeraRules.run(status) ?? "", /tool.sett(er|er state)/i)
      assert.match(
        makeraRules.command({ type: "spindleStart", rpm: 10000 }, status) ?? "",
        /tool.sett(er|er state)/i
      )
    }
  })

  test("a manual M6 requires a verified tool reset before playing", () => {
    const reset = toolResetForRun(job, toolChange, manualZ1, ready())
    assert.ok(reset)
    assert.equal(reset.frame.payload, "M493.2 T-1")
    assert.equal(reset.applied(ready({ tool: -1 })), true)
  })

  test("Keep tool cannot bypass M6 calibration", () => {
    assert.throws(
      () => toolResetForRun(job, toolChange, manualZ1, ready(), true),
      (error) =>
        error instanceof MachineError &&
        error.code === "refused" &&
        /tool-setter measurement/.test(error.message)
    )
  })

  test("no reset for forgotten tool, ATC, or program without M6", () => {
    const forgotten = ready({ tool: -1 })
    assert.equal(
      toolResetForRun(job, toolChange, manualZ1, forgotten, true),
      null
    )
    assert.equal(toolResetForRun(job, toolChange, atcZ1, ready()), null)
    assert.equal(
      toolResetForRun(job, spindleOnly, manualZ1, ready(), true),
      null
    )
  })
})
