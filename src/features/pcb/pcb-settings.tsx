import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { usePcb } from "./use-pcb"

/** The converter installed on this computer, shared by every PCB operation. */
export function PcbSettings() {
  const pcb = usePcb()
  const status = pcb.status.data
  const busy =
    pcb.check.isPending || pcb.choose.isPending || pcb.automatic.isPending
  const error =
    pcb.status.error ??
    pcb.check.error ??
    pcb.choose.error ??
    pcb.automatic.error
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="pcb-executable">pcb2gcode executable</FieldLabel>
        <Input
          id="pcb-executable"
          readOnly
          value={status?.executable ?? "Automatic detection"}
        />
        <FieldDescription>
          {pcb.status.isPending ? "Checking pcb2gcode…" : status?.message}
        </FieldDescription>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => pcb.choose.mutate()}
          >
            Choose executable
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => pcb.check.mutate()}
          >
            {pcb.check.isPending ? "Checking…" : "Check again"}
          </Button>
          {status?.executable && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => pcb.automatic.mutate()}
            >
              Use automatic detection
            </Button>
          )}
        </div>
        {error && <FieldError>{error.message}</FieldError>}
      </Field>
    </FieldGroup>
  )
}
