import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { FieldDescription, FieldGroup } from "@/components/ui/field"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  selectedPlate,
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { targetPlate } from "@/app/workspace/defaults"
import type { PlateSetup } from "@/domain/plate/plate"
import { touchesOffWorkZ } from "@/domain/plate/work-origin"
import { useImportContext } from "@/features/shell/use-import"
import { AppDialog } from "@/features/shell/app-dialog"
import { openDialog } from "@/features/shell/dialogs"
import { StockFields } from "@/features/prepare/inspector/stock-fields"
import {
  StockPlacementFields,
  WorkOriginFields,
} from "@/features/prepare/inspector/setup-fields"
import { PlateFixturesPanel } from "@/features/prepare/inspector/plate-fixtures-panel"
import { PlateToolsPanel } from "@/features/prepare/inspector/plate-tools-panel"
import { HeightMapFacts } from "@/components/workspace/height-map-grid"

const STEPS = [
  {
    id: "stock",
    name: "Stock",
    explanation:
      "Stock is the uncut material. Enter its measured size and material, then place its front-left bottom corner on the bed.",
  },
  {
    id: "workholding",
    name: "Workholding",
    explanation:
      "Place the modeled bed and clamps where you will install them. Check that the real stock is secure and the tool can reach its cuts. The model does not confirm physical clamping.",
  },
  {
    id: "origin",
    name: "Work zero",
    explanation:
      "Work zero is the point your G-code calls X0 Y0 Z0. Choose the same corner or center used in your CAM export. Bed coordinates describe the setup; machine coordinates describe the axes. Choosing a model origin does not probe or set physical Z.",
  },
  {
    id: "tools",
    name: "Tools",
    explanation:
      "Match each operation's tool number to the actual cutter. Check diameter, cutting length and holder dimensions in the library; unknown dimensions cannot establish clearance.",
  },
  {
    id: "review",
    name: "Review",
    explanation:
      "Review the committed setup below, play the program on Job, and inspect the run checklist. Setup edits apply to the project and can be undone; closing this guide keeps them.",
  },
] as const

export function GuidedSetup({ onClose }: { onClose: () => void }) {
  const workspace = useWorkspaceStore()
  const selected = useWorkspace(selectedPlate)
  const context = useImportContext()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const current = STEPS[step]
  const [plateId, setPlateId] = useState(() => selected?.id ?? null)
  const plate = useWorkspace((state) =>
    state.plates.find((item) => item.id === plateId)
  )
  if (!plate)
    return (
      <AppDialog title="Guided setup" onClose={onClose}>
        <FieldDescription>Create a plate to begin its setup.</FieldDescription>
        <Button
          onClick={() => {
            const created = targetPlate(null, context(), true)
            const result = workspace.dispatch({
              type: "plates.add",
              plates: [created],
              select: true,
            })
            if (!result.ok) {
              toast.error(result.error)
              return
            }
            setPlateId(created.id)
          }}
        >
          Create plate
        </Button>
      </AppDialog>
    )
  const change = (patch: Partial<PlateSetup>) => {
    const result = workspace.dispatch({
      type: "plate.setup",
      plateId: plate.id,
      patch,
    })
    if (!result.ok) toast.error(result.error)
  }
  const stock = plate.setup.stock
  const zLock =
    stock && touchesOffWorkZ(plate)
      ? "Touch-off sets work Z0 on the stock top."
      : undefined
  return (
    <AppDialog
      title="Guided setup"
      width="wide"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-between gap-2">
          <Button
            variant="outline"
            disabled={step === 0}
            onClick={() => setStep(step - 1)}
          >
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep(step + 1)}>Next</Button>
          ) : (
            <Button
              onClick={() => {
                onClose()
                void navigate({ to: "/job" })
              }}
            >
              Review on Job
            </Button>
          )}
        </div>
      }
    >
      <FieldGroup>
        <Tabs
          value={current.id}
          onValueChange={(value) => {
            const next = STEPS.findIndex((item) => item.id === value)
            if (next >= 0) setStep(next)
          }}
        >
          <TabsList>
            {STEPS.map((item) => (
              <TabsTrigger key={item.id} value={item.id}>
                {item.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <FieldDescription>{current.explanation}</FieldDescription>
        {current.id === "stock" && (
          <>
            <StockFields
              plateId={plate.id}
              setup={plate.setup}
              onChange={change}
            />
            <StockPlacementFields setup={plate.setup} onChange={change} />
          </>
        )}
        {current.id === "workholding" && <PlateFixturesPanel plate={plate} />}
        {current.id === "origin" && (
          <>
            <WorkOriginFields
              setup={plate.setup}
              onChange={change}
              zLock={zLock}
            />
            <Button
              variant="outline"
              onClick={() => openDialog({ kind: "probing" })}
            >
              Choose a probing operation
            </Button>
          </>
        )}
        {current.id === "tools" && (
          <>
            <PlateToolsPanel plate={plate} />
            <Button
              variant="outline"
              onClick={() => openDialog({ kind: "tools" })}
            >
              Open tool library
            </Button>
          </>
        )}
        {current.id === "review" && (
          <HeightMapFacts
            facts={[
              {
                label: "Stock",
                value: stock
                  ? `${stock.material} · ${stock.width} × ${stock.depth} × ${stock.height} mm`
                  : "Not specified",
              },
              {
                label: "Stock corner · bed mm",
                value: plate.setup.stockAnchor
                  .map((value) => value.toFixed(3))
                  .join(" / "),
              },
              {
                label: "Work zero · bed mm",
                value: plate.setup.workOrigin
                  .map((value) => value.toFixed(3))
                  .join(" / "),
              },
              {
                label: "Fixtures enabled",
                value: String(
                  plate.setup.fixtures.filter((item) => item.enabled).length
                ),
              },
              {
                label: "Tools assigned",
                value: `${plate.tools.filter((item) => item.toolId).length} / ${plate.tools.length}`,
              },
              { label: "Operations", value: String(plate.operations.length) },
              {
                label: "Origin source",
                value: plate.setup.anchors?.source ?? "Entered setup",
              },
              {
                label: "Last measured XY application",
                value: plate.setup.lastMeasurement
                  ? `${plate.setup.lastMeasurement.source} · ${plate.setup.lastMeasurement.mode} · ${new Date(plate.setup.lastMeasurement.appliedAt).toLocaleString()}`
                  : "None",
              },
            ]}
          />
        )}
      </FieldGroup>
    </AppDialog>
  )
}
