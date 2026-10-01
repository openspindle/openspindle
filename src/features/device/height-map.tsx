import { useState } from "react"
import { Grid3X3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { HeightMap } from "@/machine/contract"
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardContent,
  CardDescription,
} from "@/components/ui/card"
import { FieldDescription, FieldError } from "@/components/ui/field"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  formatHeight,
  formatSpan,
  heightStatistics,
} from "@/domain/probing/tasks/grid/analysis"
import {
  HeightMapFacts,
  HeightMapGrid,
} from "@/components/workspace/height-map-grid"
import { ReasonButton } from "@/components/workspace/reason-button"

export function HeightMapCard({
  map,
  onOpen,
}: {
  map?: HeightMap
  onOpen: () => void
}) {
  return (
    <Card size="sm" role="region" className="min-w-0" aria-label="Height map">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Grid3X3 size={16} />
          Height map
        </CardTitle>
        <CardAction>
          <Button size="sm" variant="outline" onClick={onOpen}>
            Measured heights
          </Button>
        </CardAction>
      </CardHeader>
      {map && (
        <CardContent>
          <CardDescription className="font-numeric">
            {map.columns} × {map.rows} points ·{" "}
            {new Date(map.receivedAt).toLocaleTimeString()}
          </CardDescription>
        </CardContent>
      )}
    </Card>
  )
}

export function HeightMapView({
  map,
  deviceName,
  readError,
  deferred,
  reading,
  onRetrieve,
}: {
  map?: HeightMap
  deviceName?: string
  readError: string | null
  /** The read waits until the running program ends. */
  deferred: boolean
  reading: boolean
  onRetrieve: () => Promise<void>
}) {
  const [error, setError] = useState("")
  const [view, setView] = useState<"map" | "source">("map")
  const statistics = map ? heightStatistics(map.heights) : null
  const retrieve = async () => {
    setError("")
    try {
      await onRetrieve()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not retrieve the height map."
      )
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3>{deviceName ?? "No device connected"}</h3>
          {map && (
            <>
              <FieldDescription>
                Device grid · process not reported
              </FieldDescription>
              <FieldDescription className="font-numeric">
                <time dateTime={new Date(map.receivedAt).toISOString()}>
                  Retrieved {new Date(map.receivedAt).toLocaleString()}
                </time>
              </FieldDescription>
            </>
          )}
        </div>
        <ReasonButton
          label="Retrieve height map"
          reason={readError}
          disabled={reading}
          onClick={() => void retrieve()}
        >
          {reading
            ? "Retrieving…"
            : `Retrieve M375.1${deferred ? " after the program" : ""}`}
        </ReasonButton>
      </div>
      {error && <FieldError>{error}</FieldError>}
      {!map ? (
        <FieldDescription className="py-8 text-center">
          {readError ?? "No height map retrieved."}
        </FieldDescription>
      ) : (
        <>
          <HeightMapFacts
            facts={[
              { label: "Grid", value: `${map.columns} × ${map.rows}` },
              {
                label: "Minimum",
                value: statistics ? `${formatHeight(statistics.min)} mm` : "—",
              },
              {
                label: "Maximum",
                value: statistics ? `${formatHeight(statistics.max)} mm` : "—",
              },
              {
                label: "Range",
                value: statistics ? `${formatSpan(statistics.range)} mm` : "—",
              },
            ]}
          />
          <Tabs
            value={view}
            onValueChange={(value) => {
              if (value === "map" || value === "source") setView(value)
            }}
          >
            <TabsList variant="line" aria-label="Height map view">
              <TabsTrigger value="map">Height map</TabsTrigger>
              <TabsTrigger value="source">Firmware output</TabsTrigger>
            </TabsList>
            <TabsContent value="source" aria-label="Firmware output">
              <pre className="mt-3 max-h-[440px] overflow-auto">{map.raw}</pre>
            </TabsContent>
            <TabsContent value="map" aria-label="Measured height map">
              <HeightMapGrid map={map} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
