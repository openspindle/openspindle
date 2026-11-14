import { useForm } from "@tanstack/react-form"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldDescription,
} from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import { FilePicker } from "@/components/file-picker"
import { AppDialog } from "@/features/shell/app-dialog"
import {
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { MODEL_ACCEPT } from "@/domain/models/model"
import { ReferenceModelSchema } from "@/domain/models/reference"
import type { ReferenceModel } from "@/domain/models/reference"
import {
  MaterialAppearanceSchema,
  resolvedAppearance,
} from "@/domain/materials/appearance"
import type { MaterialAppearance } from "@/domain/materials/appearance"
import type { Plate } from "@/domain/plate/plate"
import { importReference } from "./import-reference"

function PlacementForm({
  plate,
  model,
}: {
  plate: Plate
  model: ReferenceModel
}) {
  const workspace = useWorkspaceStore()
  const form = useForm({
    defaultValues: {
      offset: model.offset,
      rotation: model.rotation,
      scale: model.scale,
    },
    validators: {
      onSubmit: ReferenceModelSchema.pick({
        offset: true,
        rotation: true,
        scale: true,
      }),
    },
    onSubmit: ({ value }) => {
      const current = workspace.state.plates.find((p) => p.id === plate.id)
      if (current?.setup.reference !== model) {
        toast.error("The model changed. Reopen its settings.")
        return
      }
      const result = workspace.dispatch({
        type: "plate.setup",
        plateId: plate.id,
        patch: { reference: { ...model, ...value } },
      })
      if (!result.ok) toast.error(result.error)
    },
  })
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <FieldGroup>
        {(["offset", "rotation"] as const).map((kind) => (
          <FieldGroup className="grid grid-cols-3" key={kind}>
            {([0, 1, 2] as const).map((axis) => (
              <form.Field name={`${kind}[${axis}]`} key={axis}>
                {(field) => (
                  <Field data-invalid={field.state.meta.errors.length > 0}>
                    <FieldLabel htmlFor={`reference-${kind}-${axis}`}>
                      {kind === "offset" ? "Offset" : "Rotation"} {"XYZ"[axis]}{" "}
                      ({kind === "offset" ? "mm" : "°"})
                    </FieldLabel>
                    <Input
                      id={`reference-${kind}-${axis}`}
                      type="number"
                      step="any"
                      value={
                        Number.isNaN(field.state.value) ? "" : field.state.value
                      }
                      onBlur={field.handleBlur}
                      onChange={(e) =>
                        field.handleChange(e.target.valueAsNumber)
                      }
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>
            ))}
          </FieldGroup>
        ))}
        <form.Field name="scale">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="reference-scale">Scale</FieldLabel>
              <Input
                id="reference-scale"
                type="number"
                step="any"
                min={0.001}
                max={1000}
                value={Number.isNaN(field.state.value) ? "" : field.state.value}
                onChange={(e) => field.handleChange(e.target.valueAsNumber)}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
      </FieldGroup>
      <Button type="submit">Apply placement</Button>
    </form>
  )
}

function MaterialForm({ plate }: { plate: Plate }) {
  const workspace = useWorkspaceStore()
  const stock = plate.setup.stock!
  const resolved = resolvedAppearance(stock.material, stock.appearance)
  const initial: MaterialAppearance = {
    ...stock.appearance,
    name: stock.appearance?.name ?? stock.material,
    family: resolved.family,
    color: stock.appearance?.color ?? stock.color,
    roughness: resolved.roughness,
    metalness: resolved.metalness,
    opacity: resolved.opacity,
    texture: resolved.texture,
    textureSize: resolved.textureSize,
    textureStrength: resolved.textureStrength,
  }
  const form = useForm({
    defaultValues: initial,
    validators: { onSubmit: MaterialAppearanceSchema },
    onSubmit: ({ value }) => {
      const current = workspace.state.plates.find((p) => p.id === plate.id)
      if (current?.setup.stock !== stock) {
        toast.error("The material changed. Reopen its settings.")
        return
      }
      const result = workspace.dispatch({
        type: "plate.setup",
        plateId: plate.id,
        patch: {
          stock: {
            ...stock,
            material: value.name,
            color: value.color ?? stock.color,
            appearance: { ...value, source: "manual" },
          },
        },
      })
      if (!result.ok) toast.error(result.error)
    },
  })
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <FieldGroup>
        <form.Field name="name">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="appearance-name">Material</FieldLabel>
              <Input
                id="appearance-name"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
        <form.Field name="family">
          {(field) => (
            <Field>
              <FieldLabel>Surface family</FieldLabel>
              <OptionSelect
                value={field.state.value ?? "matte"}
                options={["metal", "wood", "plastic", "matte"].map((value) => ({
                  value,
                  label: value,
                }))}
                onValueChange={(v) => {
                  if (v) field.handleChange(v as MaterialAppearance["family"])
                }}
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="color">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="appearance-color">Colour</FieldLabel>
              <Input
                id="appearance-color"
                type="color"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </Field>
          )}
        </form.Field>
        <FieldGroup className="grid grid-cols-2">
          {(
            [
              "roughness",
              "metalness",
              "opacity",
              "textureSize",
              "textureStrength",
            ] as const
          ).map((name) => (
            <form.Field name={name} key={name}>
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={`appearance-${name}`}>
                    {
                      {
                        roughness: "Roughness",
                        metalness: "Metalness",
                        opacity: "Opacity",
                        textureSize: "Texture size (mm)",
                        textureStrength: "Texture strength",
                      }[name]
                    }
                  </FieldLabel>
                  <Input
                    id={`appearance-${name}`}
                    type="number"
                    step="any"
                    value={
                      Number.isNaN(field.state.value) ? "" : field.state.value
                    }
                    onChange={(e) => field.handleChange(e.target.valueAsNumber)}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
          ))}
        </FieldGroup>
        <form.Field name="texture">
          {(field) => (
            <Field>
              <FieldLabel>Texture</FieldLabel>
              <OptionSelect
                value={field.state.value ?? "fine"}
                options={["none", "fine", "brushed", "grain"].map((value) => ({
                  value,
                  label: value,
                }))}
                onValueChange={(v) => {
                  if (v) field.handleChange(v as MaterialAppearance["texture"])
                }}
              />
            </Field>
          )}
        </form.Field>
        {stock.appearance?.densityKgM3 && (
          <FieldDescription>
            Density: {stock.appearance.densityKgM3} kg/m³
          </FieldDescription>
        )}
        {stock.appearance?.properties?.map((p) => (
          <FieldDescription key={p.name}>
            {p.name}: {p.value}
          </FieldDescription>
        ))}
      </FieldGroup>
      <Button type="submit">Apply material</Button>
    </form>
  )
}

export function ReferenceDialog({
  plateId,
  onClose,
}: {
  plateId: string
  onClose: () => void
}) {
  const workspace = useWorkspaceStore()
  const plate = useWorkspace((state) =>
    state.plates.find((p) => p.id === plateId)
  )
  const importing = useMutation({
    mutationFn: async (file: File) => {
      const before = workspace.state.plates.find((p) => p.id === plateId)?.setup
        .reference
      const model = await importReference(file)
      if (
        workspace.state.plates.find((p) => p.id === plateId)?.setup
          .reference !== before
      )
        throw new Error("The reference changed during import. Try again.")
      const result = workspace.dispatch({
        type: "plate.setup",
        plateId,
        patch: { reference: model },
      })
      if (!result.ok) throw new Error(result.error)
    },
    onError: (error) => toast.error(error.message),
  })
  return (
    <AppDialog title="Finished model and material" onClose={onClose}>
      <div className="flex flex-col gap-5">
        <FilePicker
          accept={MODEL_ACCEPT}
          aria-label="Finished model"
          onSelect={(files) => {
            if (files[0]) importing.mutate(files[0])
          }}
        >
          {(open) => (
            <Button onClick={open} disabled={importing.isPending || !plate}>
              {importing.isPending ? "Importing model…" : "Import STEP / GLB"}
            </Button>
          )}
        </FilePicker>
        {plate?.setup.reference && (
          <>
            <FieldDescription>
              {plate.setup.reference.name} · mm · work coordinates
            </FieldDescription>
            <PlacementForm
              key={JSON.stringify([
                plate.setup.reference.offset,
                plate.setup.reference.rotation,
                plate.setup.reference.scale,
              ])}
              plate={plate}
              model={plate.setup.reference}
            />
            <Button
              variant="outline"
              onClick={() =>
                workspace.dispatch({
                  type: "plate.setup",
                  plateId,
                  patch: { reference: null },
                })
              }
            >
              Remove reference
            </Button>
          </>
        )}
        {plate?.setup.stock && (
          <MaterialForm
            key={JSON.stringify(plate.setup.stock.appearance)}
            plate={plate}
          />
        )}
      </div>
    </AppDialog>
  )
}
