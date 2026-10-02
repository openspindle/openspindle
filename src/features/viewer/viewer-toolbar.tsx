import { useState } from "react"
import {
  Cuboid,
  Cylinder,
  Layers3,
  Maximize,
  Minus,
  MousePointer2,
  Plus,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ViewMode } from "@/components/workspace/bed-viewer"
import { isVisualStyle, useVisualStyle } from "./visual-style"

/** Limits match the viewer's orbit controls, which report wheel zoom through onZoomChange. */
const ZOOM = { min: 0.2, max: 12, step: 0.25 } as const

export type ViewerCamera = {
  readonly view: ViewMode
  readonly zoom: number
  /** Changes to re-apply the view preset (and fit the bed). */
  readonly resetKey: number
  readonly setView: (view: ViewMode) => void
  readonly setZoom: (zoom: number) => void
  readonly fit: () => void
}

/** Camera state of one bed viewer: view preset, zoom and fit. */
export function useViewerCamera(): ViewerCamera {
  const [view, setViewMode] = useState<ViewMode>("perspective")
  const [zoom, setZoom] = useState(1)
  const [resetKey, setResetKey] = useState(0)
  return {
    view,
    zoom,
    resetKey,
    setView: (next) => {
      setViewMode(next)
      // Re-apply the preset even when this view is already selected.
      setResetKey((key) => key + 1)
    },
    setZoom,
    fit: () => {
      setViewMode("perspective")
      setZoom(1)
      setResetKey((key) => key + 1)
    },
  }
}

const isViewMode = (value: unknown): value is ViewMode =>
  value === "perspective" || value === "top" || value === "front"

export function ViewerToolbar({ camera }: { camera: ViewerCamera }) {
  return (
    <Card
      className="absolute top-1/2 left-4 z-10 -translate-y-1/2 gap-1 p-1"
      role="toolbar"
      aria-label="3D viewer"
      aria-orientation="vertical"
    >
      <ToggleGroup
        orientation="vertical"
        spacing={1}
        value={[camera.view]}
        onValueChange={(value) => {
          // Clicking the pressed view deselects it (an empty value): re-apply that view.
          const next = value.at(0)
          camera.setView(isViewMode(next) ? next : camera.view)
        }}
        aria-label="View"
      >
        <ToggleGroupItem value="perspective" aria-label="Perspective view">
          <MousePointer2 />
        </ToggleGroupItem>
        <ToggleGroupItem value="top" aria-label="Top view">
          <Layers3 />
        </ToggleGroupItem>
      </ToggleGroup>
      <Separator />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Zoom in"
        title="Zoom in"
        onClick={() =>
          camera.setZoom(Math.min(camera.zoom + ZOOM.step, ZOOM.max))
        }
      >
        <Plus />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Zoom out"
        title="Zoom out"
        onClick={() =>
          camera.setZoom(Math.max(camera.zoom - ZOOM.step, ZOOM.min))
        }
      >
        <Minus />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Fit bed in view"
        title="Fit bed in view"
        onClick={camera.fit}
      >
        <Maximize />
      </Button>
      <Separator />
      <VisualStyleMenu />
    </Card>
  )
}

/** The 3D views' visual style, from a menu beside the toolbar; its button shows the one chosen. */
function VisualStyleMenu() {
  const [style, setStyle] = useVisualStyle()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Visual style"
            title="Visual style"
          />
        }
      >
        {style === "edges" ? <Cuboid /> : <Cylinder />}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Visual style</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={style}
            onValueChange={(value) => {
              if (isVisualStyle(value)) setStyle(value)
            }}
          >
            <DropdownMenuRadioItem value="smooth">
              <Cylinder />
              Smooth Shades
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="edges">
              <Cuboid />
              Shaded Edges
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
