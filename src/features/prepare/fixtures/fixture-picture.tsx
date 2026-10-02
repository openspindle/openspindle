import { cn } from "cn"
import { Skeleton } from "@/components/ui/skeleton"
import type {
  FixtureDefinition,
  FixtureModel,
} from "@/domain/fixtures/definitions"
import { FIXTURE_ICONS } from "./fixture-icon"
import { useFixtureThumbnail } from "./fixture-thumbnails"

/** A model's box as width × depth × height, in millimetres. */
export function modelSize({ bounds: { min, max } }: FixtureModel) {
  return max
    .map((value, axis) =>
      (value - min[axis]).toLocaleString("en-US", {
        useGrouping: false,
        maximumFractionDigits: 1,
      })
    )
    .join(" × ")
}

/** The fixture's model as a picture, its kind's icon without one, a placeholder while drawn. */
export function FixturePicture({
  definition,
  className,
}: {
  definition: FixtureDefinition
  className?: string
}) {
  return (
    <div
      className={cn(
        "grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-sm bg-muted/40",
        className
      )}
    >
      <PictureContent definition={definition} />
    </div>
  )
}

function PictureContent({ definition }: { definition: FixtureDefinition }) {
  const picture = useFixtureThumbnail(definition)
  if (picture === undefined) return <Skeleton className="size-full" />
  if (picture === null) {
    const Icon = FIXTURE_ICONS[definition.kind]
    return <Icon className="size-8 text-muted-foreground" aria-hidden />
  }
  return (
    <img
      className="size-full object-contain"
      src={picture}
      alt=""
      draggable={false}
    />
  )
}
