import {
  Anvil,
  Box,
  Disc3,
  Grid3x3,
  Paperclip,
  Pin,
  RectangleHorizontal,
  Wind,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { FixtureKind } from "@/domain/fixtures/definitions"

/** The icon of a fixture's kind, beside its name and where it has no picture. */
export const FIXTURE_ICONS: Record<FixtureKind, LucideIcon> = {
  bed: Grid3x3,
  wasteboard: RectangleHorizontal,
  clamp: Paperclip,
  holder: Pin,
  vise: Anvil,
  "vacuum-bed": Wind,
  rotary: Disc3,
  other: Box,
}
