import { useEffect, useMemo, useState } from "react"
import type { FrameSource } from "@/app/job/frame"
import { usePlanIndex } from "@/app/job/use-plan"
import { useWorkspace } from "@/app/workspace/workspace-context"
import { facingToolIssue } from "@/domain/operations/facing"
import type {
  RemovalGrid,
  RemovalInput,
  RemovalCursor,
} from "@/domain/tools/material-removal"
import type { JobSubject } from "@/features/job/job-view"
import type { GCodeProgram } from "@/domain/nc/gcode"
import type { Tool } from "@/domain/tools/tool"
import { readNcBlock } from "@/machine/contract"
import { PLAIN_NC, readNcUnit } from "@/domain/compile/nc-unit"
import { kitForPlate } from "@/domain/fixtures/catalog"
import { implicitToolMoves } from "@/domain/tools/implicit-tool"
import { toViewerPlate } from "@/features/viewer/viewer-plate"

function removalInput(
  shown: JobSubject | null,
  program: GCodeProgram | undefined,
  tools: readonly Tool[]
): { input: RemovalInput | null; problem: string | null } {
  if (!shown || !program)
    return {
      input: null,
      problem: "Choose a compiled plate with a motion preview.",
    }
  const { plate } = shown
  const kit = kitForPlate(plate)
  const stock = plate.setup.stock
  if (!stock)
    return { input: null, problem: "Specify stock dimensions in Guided setup." }
  if (program.unreadable)
    return {
      input: null,
      problem:
        "The preview omits unsupported program lines. Removal is unavailable.",
    }
  if (program.segments.length > 50000)
    return {
      input: null,
      problem: "Removal supports at most 50,000 preview segments per plate.",
    }
  for (const operation of plate.operations) {
    const source = operation.source
    if (source.kind === "probing" || source.kind === "unsupported")
      return {
        input: null,
        problem:
          "Probing, compensation and unavailable operations are outside this removal model. Preview a machining-only plate.",
      }
    if (source.kind === "facing") continue
    const nc = source.nc
    if (!nc)
      return {
        input: null,
        problem: "Generate the operation's program before previewing removal.",
      }
    const supported = readNcUnit(nc, PLAIN_NC, false, (words, state) =>
      kit.readNcBlock(words, state)
    )
    if (!supported.ok)
      return {
        input: null,
        problem: `Removal does not support ${operation.name}, line ${supported.error.line}: ${supported.error.message}`,
      }
    for (const line of nc.split(/\r?\n/)) {
      const block = readNcBlock(line)
      if (block.problem)
        return {
          input: null,
          problem: "A program line cannot be interpreted for removal.",
        }
      if (
        block.words.some(
          ({ letter, value }) =>
            ["A", "B", "C"].includes(letter) ||
            (letter === "G" &&
              ([
                10, 18, 19, 41, 42, 50, 51, 52, 55, 56, 57, 58, 59, 68, 69, 92,
              ].includes(value) ||
                (value > 59 && value < 60) ||
                (value > 92 && value < 93)))
        )
      )
        return {
          input: null,
          problem:
            "Rotary motion, coordinate changes, non-XY arcs or cutter compensation are outside this removal model.",
        }
    }
  }
  const min = plate.setup.stockAnchor.map(
    (value, axis) => value - plate.setup.workOrigin[axis]
  ) as [number, number, number]
  const max: [number, number, number] = [
    min[0] + stock.width,
    min[1] + stock.depth,
    min[2] + stock.height,
  ]
  const segments: RemovalInput["segments"] = []
  const implicitMoves = implicitToolMoves(
    program,
    toViewerPlate(plate, shown.compiled, tools).tools
  )
  for (const [move, segment] of program.segments.entries()) {
    let radius: number | null = null
    if (
      !segment.rapid &&
      !segment.routine &&
      Math.min(segment.start[2], segment.end[2]) < max[2]
    ) {
      if (segment.probing || segment.machine)
        return {
          input: null,
          problem:
            "A probing or machine-coordinate feed enters the modeled stock.",
        }
      const number =
        move < implicitMoves || segment.tool < 0 ? null : segment.tool
      const toolId = plate.tools.find(
        (entry) => entry.number === number
      )?.toolId
      const tool = tools.find((item) => item.id === toolId)
      const issue = facingToolIssue(tool)
      if (issue)
        return {
          input: null,
          problem: `Tool ${number ?? "implicit"}: ${issue} Removal needs known straight, flat-ended cutters.`,
        }
      if (segment.spindle <= 0)
        return {
          input: null,
          problem:
            "A feed below stock top has no running spindle. Review the program before previewing removal.",
        }
      if (
        tool &&
        max[2] - Math.min(segment.start[2], segment.end[2]) >
          (tool.geometry.fluteLength ?? 0)
      )
        return {
          input: null,
          problem:
            "A cut extends deeper than the known cutter length from stock top; removal cannot establish engagement there.",
        }
      radius = (tool?.diameter ?? 0) / 2
    }
    segments.push({ start: segment.start, end: segment.end, radius })
  }
  return { input: { min, max, segments }, problem: null }
}

type State = {
  input: RemovalInput | null
  grid: RemovalGrid | null
  problem: string | null
  pending: boolean
}

export function useMaterialRemoval(
  shown: JobSubject | null,
  frames: FrameSource,
  enabled: boolean
) {
  const index = usePlanIndex(shown)
  const library = useWorkspace((state) => state.tools)
  const prepared = useMemo(
    () =>
      enabled
        ? removalInput(shown, index?.plan.program, shown?.tools ?? library)
        : { input: null, problem: null },
    [enabled, shown, index, library]
  )
  const [state, setState] = useState<State>({
    input: null,
    grid: null,
    problem: null,
    pending: false,
  })
  useEffect(() => {
    const input = prepared.input
    if (!input || !index) return
    const worker = new Worker(new URL("./removal-worker.ts", import.meta.url), {
      type: "module",
      name: "Material removal",
    })
    let timer: ReturnType<typeof setTimeout> | null = null
    let serial = 0
    let busy = false
    let stopped = false
    let first = true
    let offPlan = false
    let sent: RemovalCursor | null = null
    let wanted: RemovalCursor = { move: input.segments.length, fraction: 1 }
    const post = () => {
      if (
        offPlan ||
        busy ||
        stopped ||
        (sent?.move === wanted.move && sent.fraction === wanted.fraction)
      )
        return
      busy = true
      sent = wanted
      setState((previous) => ({
        input,
        grid: previous.input === input ? previous.grid : null,
        problem: null,
        pending: true,
      }))
      worker.postMessage({
        id: ++serial,
        cursor: wanted,
        input: first ? input : undefined,
      })
      first = false
    }
    const update = () => {
      if (stopped) return
      const frame = frames.get()
      if (frame && frame.index.plan !== index.plan) return
      if (frame?.offPlan) {
        offPlan = true
        // Keep the busy request's cursor so its reply can still be checked after a seek.
        if (!busy) sent = null
        wanted = { move: 0, fraction: 0 }
        setState({
          input,
          grid: null,
          problem:
            "The live tool is off the planned path. Return to playback to preview removal.",
          pending: false,
        })
        return
      }
      offPlan = false
      const next = frame
        ? { move: frame.move, fraction: frame.fraction }
        : { move: input.segments.length, fraction: 1 }
      if (
        next.move < wanted.move ||
        (next.move === wanted.move && next.fraction < wanted.fraction)
      )
        setState({ input, grid: null, problem: null, pending: true })
      wanted = next
      if (!timer)
        timer = setTimeout(() => {
          timer = null
          post()
        }, 100)
    }
    worker.addEventListener(
      "message",
      (
        event: MessageEvent<{
          id: number
          grid: RemovalGrid | null
          error: string | null
        }>
      ) => {
        if (stopped || event.data.id !== serial) return
        busy = false
        if (offPlan) {
          sent = null
          return
        }
        if (event.data.error) {
          stopped = true
          setState({
            input,
            grid: null,
            problem: event.data.error,
            pending: false,
          })
          return
        }
        const current =
          sent?.move === wanted.move && sent.fraction === wanted.fraction
        const ahead =
          sent !== null &&
          (sent.move > wanted.move ||
            (sent.move === wanted.move && sent.fraction > wanted.fraction))
        setState({
          input,
          grid: ahead ? null : event.data.grid,
          problem: null,
          pending: !current,
        })
        post()
      }
    )
    worker.addEventListener("error", () => {
      stopped = true
      setState({
        input,
        grid: null,
        problem: "The material-removal worker could not start.",
        pending: false,
      })
    })
    update()
    const unsubscribe = frames.subscribe(update)
    return () => {
      stopped = true
      unsubscribe()
      if (timer) clearTimeout(timer)
      worker.terminate()
    }
  }, [prepared.input, index, frames])
  if (!enabled) return { grid: null, problem: null, pending: false }
  if (!prepared.input)
    return { grid: null, problem: prepared.problem, pending: false }
  if (state.input !== prepared.input)
    return { grid: null, problem: null, pending: true }
  return state
}
