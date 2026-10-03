import { useEffect, useState } from "react"
import { useAppearance } from "@/components/appearance-provider"
import type { FixtureKit } from "@/domain/fixtures/fixture-kit"
import type { ProbingStrategy } from "@/domain/probing/strategy"
import type { Tool } from "@/domain/tools/tool"
import { strategyPicture } from "./strategy-picture"
import { strategyScene } from "./strategy-scene"

/**
 * A picture of how a strategy probes on its kit's machine with `tool` (`strategyScene`), once it
 * is drawn; null until then, without a tool, or where it cannot be drawn. Drawn once per key:
 * another library holding the same tool reuses the picture.
 */
export function useStrategyPicture(
  strategy: ProbingStrategy,
  tool: Tool | null,
  kit: FixtureKit,
  library: readonly Tool[]
): string | null {
  // Drawn in the theme's colours: once for each appearance.
  const { resolvedAppearance } = useAppearance()
  const key = tool
    ? `${kit.id}:${strategy.id}:${tool.id}:${tool.diameter ?? ""}:${resolvedAppearance ?? ""}`
    : null
  const [picture, setPicture] = useState<{ key: string; url: string } | null>(
    null
  )
  useEffect(() => {
    if (!key || !tool) return
    let current = true
    void strategyPicture(key, () =>
      strategyScene(strategy, tool, kit, library)
    ).then((url) => {
      if (current && url) setPicture({ key, url })
    })
    return () => {
      current = false
    }
  }, [key, strategy, tool, kit, library])
  return picture?.key === key ? picture.url : null
}
