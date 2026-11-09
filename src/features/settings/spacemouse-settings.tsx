import { useEffect, useState } from "react"
import { OptionSelect } from "@/components/option-select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DEFAULT_SPACE_MOUSE_SETTINGS,
  useSpaceMouseSettings,
} from "@/lib/spacemouse-preferences"
import type { SpaceMouseAxis } from "@/lib/spacemouse-preferences"
import {
  centerSpaceMouse,
  spaceMouseDeviceName,
  spaceMouseInput,
  startSpaceMouse,
} from "@/platform/spacemouse"

const ZOOM_OPTIONS = [
  { value: "forward", label: "Forward / backward" },
  { value: "vertical", label: "Up / down" },
] as const

const NAVIGATION_OPTIONS = [
  ["panZoom", "Pan / zoom"],
  ["rotation", "Rotation"],
  ["dominant", "Dominant axis"],
] as const

const AXES = [
  ["x", "Left / right"],
  ["y", "Forward / back"],
  ["z", "Up / down"],
  ["pitch", "Tilt"],
  ["roll", "Roll"],
  ["yaw", "Twist"],
] as const

function readInput() {
  return {
    device: spaceMouseDeviceName(),
    axes: spaceMouseInput(performance.now()),
  }
}

function AxisMeter({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="relative h-2 w-12 rounded-full bg-muted"
      role="meter"
      aria-label={`${label} input`}
      aria-valuemin={-100}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      <span className="absolute inset-y-0 left-1/2 w-px bg-muted-foreground" />
      <span
        className="absolute inset-y-0 rounded-full bg-primary"
        style={{
          left: `${50 + Math.min(value, 0) * 50}%`,
          width: `${Math.abs(value) * 50}%`,
        }}
      />
    </div>
  )
}

export function SpaceMouseSettings() {
  const [settings, update] = useSpaceMouseSettings()
  const [input, setInput] = useState(readInput)
  const [centerMessage, setCenterMessage] = useState("")
  useEffect(() => {
    startSpaceMouse()
    const timer = window.setInterval(() => {
      const next = readInput()
      setInput((previous) =>
        next.device === previous.device &&
        AXES.every(([name]) => next.axes[name] === previous.axes[name])
          ? previous
          : next
      )
    }, 50)
    return () => window.clearInterval(timer)
  }, [])

  const updateAxis = (
    name: SpaceMouseAxis,
    change: Partial<(typeof settings.axes)[SpaceMouseAxis]>
  ) =>
    update({
      axes: { ...settings.axes, [name]: { ...settings.axes[name], ...change } },
    })

  return (
    <FieldGroup className="gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant="outline">Direct (WebHID)</Badge>
        <span className="text-muted-foreground" role="status">
          {input.device ?? "No SpaceMouse detected"}
        </span>
      </div>
      {NAVIGATION_OPTIONS.map(([name, label]) => (
        <Field key={name} orientation="horizontal">
          <FieldLabel htmlFor={`spacemouse-${name}`}>{label}</FieldLabel>
          <Switch
            id={`spacemouse-${name}`}
            checked={settings[name]}
            onCheckedChange={(checked) => update({ [name]: checked })}
          />
        </Field>
      ))}
      <Field orientation="horizontal">
        <FieldLabel htmlFor="spacemouse-zoom">Zoom direction</FieldLabel>
        <OptionSelect
          id="spacemouse-zoom"
          options={ZOOM_OPTIONS}
          value={settings.zoomAxis}
          onValueChange={(zoomAxis) => update({ zoomAxis })}
        />
      </Field>
      <Table aria-label="SpaceMouse axis settings and live input">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Axis</TableHead>
            <TableHead scope="col">Active</TableHead>
            <TableHead scope="col">Sensitivity</TableHead>
            <TableHead scope="col">Reverse</TableHead>
            <TableHead scope="col">Live</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {AXES.map(([name, label]) => {
            if (name === "roll")
              return (
                <TableRow key={name}>
                  <TableHead scope="row" className="h-auto font-normal">
                    {label}
                  </TableHead>
                  <TableCell colSpan={3} className="text-muted-foreground">
                    Horizon locked
                  </TableCell>
                  <TableCell>
                    <AxisMeter label={label} value={input.axes.roll} />
                  </TableCell>
                </TableRow>
              )
            const { enabled, reverse, sensitivity } = settings.axes[name]
            return (
              <TableRow key={name}>
                <TableHead scope="row" className="h-auto font-normal">
                  {label}
                </TableHead>
                <TableCell>
                  <Checkbox
                    aria-label={`Enable ${label} axis`}
                    checked={enabled}
                    onCheckedChange={(checked) =>
                      updateAxis(name, { enabled: checked })
                    }
                  />
                </TableCell>
                <TableCell>
                  <div className="flex min-w-22 items-center gap-2">
                    <Slider
                      min={25}
                      max={200}
                      step={5}
                      value={[sensitivity]}
                      disabled={!enabled}
                      thumbProps={{
                        "aria-label": `${label} sensitivity`,
                        "aria-valuetext": `${sensitivity}%`,
                      }}
                      onValueChange={(value) =>
                        updateAxis(name, {
                          sensitivity:
                            typeof value === "number" ? value : value[0],
                        })
                      }
                    />
                    <span className="w-8 shrink-0 text-right font-numeric">
                      {sensitivity}%
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Checkbox
                    aria-label={`Reverse ${label} axis`}
                    checked={reverse}
                    disabled={!enabled}
                    onCheckedChange={(checked) =>
                      updateAxis(name, { reverse: checked })
                    }
                  />
                </TableCell>
                <TableCell>
                  <AxisMeter label={label} value={input.axes[name]} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!input.device}
          onClick={() =>
            setCenterMessage(
              centerSpaceMouse(performance.now())
                ? "Input centered for this connection."
                : "Release the cap and try again."
            )
          }
        >
          Center input
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => update(DEFAULT_SPACE_MOUSE_SETTINGS)}
        >
          Restore defaults
        </Button>
      </div>
      <FieldDescription role="status">
        {centerMessage || "Release the cap before centering the input."}
      </FieldDescription>
    </FieldGroup>
  )
}
