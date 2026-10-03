import { useEffect, useRef, useState } from "react"
import { RotateCcw, RotateCw } from "lucide-react"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldTitle } from "@/components/ui/field"
import { fixtureModelMountPoints } from "@/domain/fixtures/catalog"
import type { ModelId } from "@/domain/models/model"
import { orientedFixtureModel } from "@/domain/fixtures/definitions"
import type { FixtureModel } from "@/domain/fixtures/definitions"
import type { SurfaceFinish } from "@/domain/materials/surface-material"
import type { Point3 } from "@/domain/nc/gcode"
import { disposeObjects, glbInBedSpace } from "@/lib/three-assets"
import { useHost } from "@/platform/host-context"
import { FixtureModelScene } from "./fixture-model-scene"

const AS_AUTHORED: Point3 = [0, 0, 0]

/**
 * How a Models library model stands in its fixture: a preview of it on the surface under it,
 * with its origin and mount points. Clicking a face stands it on that face, and Turn turns it
 * a quarter turn; its box, origin and points follow.
 */
export function FixtureOrientationField({
  name,
  color,
  finish,
  model,
  modelId,
  onChange,
}: {
  name: string
  color: string
  /** How shiny it is drawn, as on the plate. */
  finish: SurfaceFinish
  model: FixtureModel
  modelId: ModelId
  onChange: (model: FixtureModel) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<FixtureModelScene | null>(null)
  const models = useHost().models
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")
  // The scene reports turns through the ref, so they reach the latest model.
  const orient = useRef((_orientation: Point3) => {})
  useEffect(() => {
    orient.current = (orientation) => {
      const turned = sceneRef.current?.turnedBounds(orientation)
      if (turned) onChange(orientedFixtureModel(model, orientation, turned))
    }
  }, [model, onChange])

  useEffect(() => {
    if (!container.current) return
    const scene = FixtureModelScene.create(container.current, {
      orient: (orientation) => orient.current(orientation),
      unavailable: () => setError("3D view unavailable."),
    })
    sceneRef.current = scene
    return () => {
      scene.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const abort = new AbortController()
    // A function, so narrowing never assumes a cancel that happened meanwhile impossible.
    const cancelled = () => abort.signal.aborted
    setLoaded(false)
    setError("")
    scene.setMesh(null)
    void (async () => {
      const mesh = await models.mesh(modelId)
      if (!mesh) throw new Error("The model is not in the Models library.")
      const gltf = await new GLTFLoader().parseAsync(
        new Uint8Array(mesh).buffer,
        ""
      )
      if (cancelled()) {
        disposeObjects(gltf.scene)
        return
      }
      scene.setMesh(glbInBedSpace(gltf.scene))
      setLoaded(true)
    })().catch(() => {
      if (!cancelled()) setError("The model could not be shown.")
    })
    return () => abort.abort()
  }, [models, modelId])

  useEffect(() => {
    sceneRef.current?.show({
      model,
      points: fixtureModelMountPoints(model),
      color,
      finish,
    })
  }, [model, color, finish])

  return (
    <Field>
      <FieldTitle>Orientation</FieldTitle>
      <div
        ref={container}
        className="relative h-56 overflow-hidden rounded-md border bg-muted/40 [&>canvas]:block"
        aria-label={`${name} model, standing as it does on the bed`}
      >
        {error && (
          <p className="absolute inset-0 grid place-items-center p-4 text-center text-xs text-muted-foreground">
            {error}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1">
        <FieldDescription className="min-w-0 flex-1">
          Click the face it stands on.
        </FieldDescription>
        <Button
          variant="ghost"
          size="sm"
          title="Turn it 90° about Z"
          aria-label={`Turn ${name} 90°`}
          disabled={!loaded}
          onClick={() => sceneRef.current?.turn()}
        >
          <RotateCw data-icon="inline-start" />
          Turn
        </Button>
        <Button
          variant="ghost"
          size="sm"
          title="Stand it as its file has it"
          aria-label={`Reset ${name} orientation`}
          disabled={!loaded || !model.orientation}
          onClick={() => orient.current(AS_AUTHORED)}
        >
          <RotateCcw data-icon="inline-start" />
          Reset
        </Button>
      </div>
    </Field>
  )
}
