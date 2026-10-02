import { useEffect, useMemo, useState } from "react"
import { BedViewer } from "@/components/workspace/bed-viewer"
import type {
  ArrangeMenuRequest,
  ArrangePick,
  ArrangeView,
} from "@/components/workspace/bed-viewer"
import { problemMarkerId } from "@/components/workspace/bed-viewer-layout"
import type { LineRange } from "@/components/workspace/bed-viewer-layout"
import { useKeyedDiagnostics } from "@/app/workspace/use-plate-diagnostics"
import {
  useCompiledPlate,
  useSelectedPlate,
  useWorkspace,
} from "@/app/workspace/workspace-context"
import { compilePlate } from "@/domain/compile/compile"
import { diagnosticOperation } from "@/domain/diagnostics"
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
import { selectedSections, useSectionSelection } from "./selection"
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
 * Program lines to highlight: the selected sections, else those of the problem shown while its
 * operation stays selected, else the selected operation.
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
  const arrangement = useMemo<ArrangeView>(() => {
    const { picking } = arrange
    return {
      selection: target ? arrange.selection : null,
      moving: arrange.moving && !picking && !!target && !target.item.fixed,
      axes: arrange.axes,
      snap: arrange.snap,
      picking:
        picking &&
        (picking.kind === "point"
          ? {
              kind: "point",
              plateId: picking.plateId,
              targets: pickedTargets,
            }
          : {
              kind: "edges",
              plateId: picking.plateId,
              edges: pickedEdges,
            }),
    }
  }, [target, arrange, pickedEdges, pickedTargets])
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
