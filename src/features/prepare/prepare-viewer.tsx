import { useEffect, useMemo, useState } from "react"
import { BedViewer } from "@/components/workspace/bed-viewer"
import type {
  ArrangeMenuRequest,
  ArrangePick,
  ArrangeView,
  PickablePart,
  ViewerGhost,
} from "@/components/workspace/bed-viewer"
import { problemMarkerId } from "@/components/workspace/bed-viewer-layout"
import type { LineRange } from "@/components/workspace/bed-viewer-layout"
import { useKeyedDiagnostics } from "@/app/workspace/use-plate-diagnostics"
import {
  useCompiledPlate,
  useSelectedPlate,
  useWorkspace,
} from "@/app/workspace/workspace-context"
import type { RowSelectionState } from "@tanstack/react-table"
import { compilePlate } from "@/domain/compile/compile"
import type { CompiledPlate } from "@/domain/compile/compile"
import { diagnosticOperation } from "@/domain/diagnostics"
import type { Operation } from "@/domain/operations/operation"
import { isSuppressed } from "@/domain/plate/active"
import type { Plate } from "@/domain/plate/plate"
import type { Diagnostic, KeyedDiagnostic } from "@/domain/diagnostics"
import {
  ViewerToolbar,
  useViewerCamera,
} from "@/features/viewer/viewer-toolbar"
import { focusProblem, useProblemFocus } from "@/features/viewer/problem-focus"
import {
  useWorkspaceProblems,
  viewerProblem,
} from "@/features/viewer/viewer-problems"
import {
  resolvedLine,
  suppressedParts,
} from "@/domain/operations/toolpath-parts"
import { plateGhosts } from "@/features/viewer/viewer-ghosts"
import { useVisualStyle } from "@/features/viewer/visual-style"
import { useWorkspaceViewerPlates } from "@/features/viewer/workspace-viewer-plates"
import {
  holdsViolation,
  shownViolation,
  useDesignRuleResults,
} from "@/features/design-rules/design-rule-check"
import { DesignRuleResults } from "@/features/design-rules/design-rule-results"
import { ArrangeHint } from "./arrange/arrange-hint"
import { ArrangeMenu } from "./arrange/arrange-menu"
import { useArrange, useArrangeTarget } from "./arrange/arrange-state"
import type { OperationPicking } from "./arrange/arrange-state"
import { outlineTarget } from "@/domain/probing/tasks/outline/params"
import { strategyById } from "@/domain/probing/strategies"
import type { ItemEdgeRef } from "@/domain/plate/item-edges"
import { pickTargets } from "@/domain/plate/pick-targets"
import type { PickTarget } from "@/domain/plate/pick-targets"
import { useArrangeEvents } from "./arrange/use-arrange-events"
import { useArrangeShortcuts } from "./arrange/use-arrange-shortcuts"
import { usePrepareSelection } from "./plate-tree/use-prepare-selection"
import {
  selectedPaths,
  selectedSections,
  useSectionSelection,
} from "./selection"
import {
  fixtureKey,
  useHiddenFixtures,
  useHiddenOperations,
} from "./visibility"
import { PrepareToolbar } from "./prepare-toolbar"
import { useShowProblem } from "./show-problem"

/** No edges: one array, so that what is drawn changes only when edges do. */
const NO_EDGES: readonly ItemEdgeRef[] = []
const NO_TARGETS: readonly PickTarget[] = []
const NO_PARTS: readonly PickablePart[] = []

const NO_PICK: ArrangePick = { from: null, notice: null }

/**
 * The problem the 3D view shows on the selected plate: one of its diagnostics, or a violation
 * its design rule check found.
 */
function useShownProblem(): KeyedDiagnostic | null {
  const plate = useSelectedPlate()
  const focus = useProblemFocus()
  const diagnostics = useKeyedDiagnostics(plate)
  const violation = shownViolation(useDesignRuleResults(), focus, plate)
  if (!plate || focus?.plateId !== plate.id) return null
  return diagnostics.find(({ key }) => key === focus.key) ?? violation
}

/**
 * The selected paths of a plate's operations, by operation: those that run as lines of its
 * compiled program, and the suppressed ones as lines of the operation's own program, which its
 * ghost draws.
 */
function selectedPathLines(
  plate: Plate,
  compiled: CompiledPlate,
  selection: Readonly<RowSelectionState>
) {
  const running: LineRange[] = []
  const suppressed = new Map<string, LineRange[]>()
  for (const [operationId, indices] of selectedPaths(plate, selection)) {
    const operation = plate.operations.find(({ id }) => id === operationId)
    const found = operation && suppressedParts(operation)
    if (!operation || !found) continue
    const span = compiled.spans.find((item) => item.operationId === operationId)
    for (const part of found.parts) {
      if (!indices.has(part.index)) continue
      const own = { start: part.startLine, end: part.endLine }
      if (isSuppressed(operation) || found.matched.has(part.index) || !span)
        suppressed.set(operationId, [
          ...(suppressed.get(operationId) ?? []),
          own,
        ])
      else {
        // An operation's resolved lines are its compiled body's, one for one.
        const shift = span.bodyStartLine - 1
        const start = resolvedLine(operation, own.start)
        const end = resolvedLine(operation, own.end)
        if (start !== null && end !== null)
          running.push({ start: start + shift, end: end + shift })
      }
    }
  }
  return { running, suppressed, any: running.length > 0 || suppressed.size > 0 }
}

/**
 * Program lines to highlight: the selected sections, else the selected paths that run, else
 * those of the problem shown while its operation stays selected, else the selected operation.
 */
function useHighlightedLines(shown: Diagnostic | null) {
  const plate = useSelectedPlate()
  const compiled = useCompiledPlate(plate)
  const selection = useSectionSelection()
  const { operationId } = usePrepareSelection()
  return useMemo(() => {
    if (!plate || !compiled) return []
    const sections = selectedSections(plate, compiled, selection)
    if (sections.length)
      return sections.map((section) => ({
        start: section.startLine,
        end: section.endLine,
      }))
    const paths = selectedPathLines(plate, compiled, selection)
    if (paths.any) return paths.running
    if (shown?.lines && diagnosticOperation(shown) === operationId)
      return shown.lines.map((lines) => ({ ...lines }))
    const span = compiled.spans.find((item) => item.operationId === operationId)
    return span ? [{ start: span.startLine, end: span.endLine }] : []
  }, [plate, compiled, selection, operationId, shown])
}

/** The program lines of hidden operations, by plate: what the Prepare view leaves out. */
function useHiddenLines(): Readonly<Record<string, LineRange[]>> {
  const hidden = useHiddenOperations()
  const plates = useWorkspace((state) => state.plates)
  const tools = useWorkspace((state) => state.tools)
  return useMemo(
    () =>
      Object.fromEntries(
        plates.map((plate) => [
          plate.id,
          compilePlate(plate, tools)
            .spans.filter((span) => hidden.has(span.operationId))
            .map((span) => ({ start: span.startLine, end: span.endLine })),
        ])
      ),
    [hidden, plates, tools]
  )
}

/**
 * What each plate leaves out of its program, drawn faint, but for hidden operations; on the
 * selected plate, with the suppressed paths selected in the plate tree.
 */
function useGhosts(): Readonly<Record<string, readonly ViewerGhost[]>> {
  const hidden = useHiddenOperations()
  const plates = useWorkspace((state) => state.plates)
  const tools = useWorkspace((state) => state.tools)
  const selectedPlate = useSelectedPlate()
  const compiled = useCompiledPlate(selectedPlate)
  const selection = useSectionSelection()
  return useMemo(() => {
    const selected =
      selectedPlate && compiled
        ? selectedPathLines(selectedPlate, compiled, selection).suppressed
        : null
    return Object.fromEntries(
      plates.map((plate) => {
        const shown = plateGhosts(plate, tools).filter(
          (ghost) => !hidden.has(ghost.operationId)
        )
        if (plate.id !== selectedPlate?.id || !selected?.size)
          return [plate.id, shown]
        return [
          plate.id,
          shown.map((ghost) => {
            const lines = selected.get(ghost.operationId)
            return lines ? { ...ghost, selected: lines } : ghost
          }),
        ]
      })
    )
  }, [hidden, plates, tools, selectedPlate, compiled, selection])
}

/** The hidden fixtures (their ids), by plate: what the Prepare view leaves out. */
function useHiddenFixtureIds(): Readonly<Record<string, string[]>> {
  const hidden = useHiddenFixtures()
  const plates = useWorkspace((state) => state.plates)
  return useMemo(
    () =>
      Object.fromEntries(
        plates.map((plate) => [
          plate.id,
          plate.setup.fixtures
            .filter((fixture) => hidden.has(fixtureKey(plate.id, fixture.id)))
            .map((fixture) => fixture.id),
        ])
      ),
    [hidden, plates]
  )
}

/** The parts of the toolpath whose parts are picked, where they cut on its plate's bed. */
function usePickableParts(
  picking: OperationPicking | null
): readonly PickablePart[] {
  const parts = picking?.kind === "parts" ? picking : null
  const plate = useWorkspace(
    (state) =>
      (parts && state.plates.find(({ id }) => id === parts.plateId)) ?? null
  )
  const operation =
    (parts && plate?.operations.find(({ id }) => id === parts.operationId)) ??
    null
  return plate && operation ? pickablePaths(plate, operation) : NO_PARTS
}

/** The paths of the selected plate's operations a click selects, but for hidden operations'. */
function useSelectableParts(): readonly PickablePart[] {
  const plate = useSelectedPlate()
  const hidden = useHiddenOperations()
  return useMemo(() => {
    if (!plate) return NO_PARTS
    const parts = plate.operations.flatMap((operation) =>
      hidden.has(operation.id) ? [] : pickablePaths(plate, operation)
    )
    return parts.length ? parts : NO_PARTS
  }, [plate, hidden])
}

/** Each operation's paths as the 3D view picks them, with the work origin they are placed at. */
const pickable = new WeakMap<
  Operation,
  {
    readonly origin: Plate["setup"]["workOrigin"]
    readonly parts: readonly PickablePart[]
  }
>()

/** An operation's paths where they cut on its plate's bed; none for one without paths. */
function pickablePaths(
  plate: Plate,
  operation: Operation
): readonly PickablePart[] {
  const origin = plate.setup.workOrigin
  const saved = pickable.get(operation)
  if (saved?.origin === origin) return saved.parts
  const found = suppressedParts(operation)
  const [x, y, z] = origin
  const parts = (found?.parts ?? []).map((part): PickablePart => ({
    operationId: operation.id,
    index: part.index,
    label: `Path ${part.index + 1}${isSuppressed(operation) || found?.matched.has(part.index) ? " (suppressed)" : ""}`,
    min: [x + part.min[0], y + part.min[1], z],
    max: [x + part.max[0], y + part.max[1], z],
    cuts: part.cuts,
    origin: [x, y],
  }))
  pickable.set(operation, { origin, parts })
  return parts
}

/**
 * What a point picked for an operation snaps to: the targets its strategy offers on its plate,
 * but for those of fixtures hidden in the view, which offer none.
 */
function usePickTargets(
  picking: OperationPicking | null
): readonly PickTarget[] {
  const hidden = useHiddenFixtures()
  const point = picking?.kind === "point" ? picking : null
  const plateId = point?.plateId ?? null
  const setup = useWorkspace(
    (state) => state.plates.find(({ id }) => id === plateId)?.setup ?? null
  )
  const strategy = useWorkspace((state) => {
    const source =
      point &&
      state.plates
        .find(({ id }) => id === point.plateId)
        ?.operations.find(({ id }) => id === point.operationId)?.source
    return source?.kind === "probing" ? source.strategy : null
  })
  return useMemo(() => {
    const id = strategy && strategyById(strategy)?.id
    if (!plateId || !setup || !id) return NO_TARGETS
    return pickTargets(setup, id).filter(
      ({ item }) =>
        item?.kind !== "fixture" || !hidden.has(fixtureKey(plateId, item.id))
    )
  }, [plateId, setup, strategy, hidden])
}

/**
 * Every plate on the bed; the selected plate's operation or sections are highlighted. Its
 * setup items can be selected, and moved with the move tool. Problems with a place on a bed are
 * marked there: picking one selects what it is about and shows it.
 */
export function PrepareViewer() {
  const plates = useWorkspaceViewerPlates()
  const plate = useSelectedPlate()
  const selection = usePrepareSelection()
  const camera = useViewerCamera()
  const [style] = useVisualStyle()
  const focus = useProblemFocus()
  const shown = useShownProblem()
  const highlighted = useHighlightedLines(shown?.diagnostic ?? null)
  const hidden = useHiddenLines()
  const hiddenFixtures = useHiddenFixtureIds()
  const ghosts = useGhosts()
  const marked = useWorkspaceProblems()
  const results = useDesignRuleResults()
  const showProblem = useShowProblem()
  // A design rule violation is marked while it is shown.
  const problems = useMemo(() => {
    const violation =
      shown && plate && viewerProblem(plate.id, shown.key, shown.diagnostic)
    return violation && !marked.diagnostics.has(problemMarkerId(violation))
      ? [...marked.problems, violation]
      : marked.problems
  }, [shown, plate, marked])
  // A problem that is gone stops being shown, so that it does not show again by itself when it
  // comes back.
  useEffect(() => {
    if (
      focus &&
      !marked.diagnostics.has(problemMarkerId(focus)) &&
      !holdsViolation(results, focus)
    )
      focusProblem(null)
  }, [focus, marked, results])
  const arrange = useArrange()
  const target = useArrangeTarget()
  const [menu, setMenu] = useState<ArrangeMenuRequest | null>(null)
  const [pick, setPick] = useState<ArrangePick>(NO_PICK)
  const events = useArrangeEvents({ menu: setMenu, pick: setPick })
  // The edges a trace follows so far, drawn while its edges are picked.
  const pickedEdges = useWorkspace((state) => {
    const { picking } = arrange
    if (picking?.kind !== "edges") return NO_EDGES
    const source = state.plates
      .find(({ id }) => id === picking.plateId)
      ?.operations.find(({ id }) => id === picking.operationId)?.source
    if (source?.kind !== "probing" || source.task !== "outline") return NO_EDGES
    const traced = outlineTarget(source.params)
    return traced.kind === "edges" ? traced.edges : NO_EDGES
  })
  const pickedTargets = usePickTargets(arrange.picking)
  const pickableParts = usePickableParts(arrange.picking)
  const selectableParts = useSelectableParts()
  const arrangement = useMemo<ArrangeView>(() => {
    const { picking } = arrange
    const moving = arrange.moving && !picking && !!target && !target.item.fixed
    const picked = (): ArrangeView["picking"] => {
      if (!picking) return null
      const { plateId } = picking
      switch (picking.kind) {
        case "point":
          return { kind: "point", plateId, targets: pickedTargets }
        case "edges":
          return { kind: "edges", plateId, edges: pickedEdges }
        case "parts":
          return { kind: "parts", plateId, parts: pickableParts }
      }
    }
    return {
      selection: target ? arrange.selection : null,
      moving,
      axes: arrange.axes,
      snap: arrange.snap,
      picking: picked(),
      // Clicks select paths unless they move a setup item.
      paths:
        plate && !moving && selectableParts.length
          ? { plateId: plate.id, parts: selectableParts }
          : null,
    }
  }, [
    target,
    arrange,
    pickedEdges,
    pickedTargets,
    pickableParts,
    selectableParts,
    plate,
  ])
  useArrangeShortcuts(target)
  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-muted/20">
      <BedViewer
        plates={plates}
        selectedPlateId={plate?.id ?? null}
        onSelectPlate={selection.selectPlate}
        selectedLineRanges={highlighted}
        hiddenLineRanges={hidden}
        hiddenFixtures={hiddenFixtures}
        ghosts={ghosts}
        progress={100}
        showRapids={false}
        showStock
        view={camera.view}
        style={style}
        resetKey={camera.resetKey}
        zoom={camera.zoom}
        onZoomChange={camera.setZoom}
        arrangement={arrangement}
        onArrange={events}
        problems={problems}
        shownProblem={focus}
        onSelectProblem={(problem) =>
          showProblem(
            problem,
            marked.diagnostics.get(problemMarkerId(problem)) ??
              (shown?.key === problem.key ? shown.diagnostic : null)
          )
        }
      />
      <PrepareToolbar />
      <DesignRuleResults />
      <ViewerToolbar camera={camera} />
      <ArrangeHint target={target} pick={pick} />
      <ArrangeMenu
        request={menu}
        target={target}
        onClose={() => setMenu(null)}
      />
    </div>
  )
}
