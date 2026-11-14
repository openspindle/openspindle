import { z } from "zod"
import { createTool, toolKindKey } from "@/domain/tools/tool"
import type { Tool } from "@/domain/tools/tool"
import { webCryptoSha256 } from "@/lib/sha256"

export const SharedToolSchema = z
  .object({
    id: z.uuid(),
    revision: z.string().regex(/^[a-f\d]{64}$/),
    name: z.string().min(1).max(200),
    kind: z.enum(["flat", "ball", "v-bit", "drill"]),
    diameter: z.number().positive().max(1000),
    shankDiameter: z.number().positive().max(1000),
    fluteLength: z.number().positive().max(10000),
    overallLength: z.number().positive().max(10000),
    flutes: z.int().min(1).max(100),
    tipDiameter: z.number().min(0).max(1000).nullable(),
    pointAngle: z.number().positive().max(180).nullable(),
    manufacturer: z.string().max(200).nullable(),
    productId: z.string().max(200).nullable(),
  })
  .superRefine((tool, ctx) => {
    if (
      tool.fluteLength > tool.overallLength ||
      (tool.tipDiameter !== null && tool.tipDiameter > tool.diameter) ||
      (tool.kind === "v-bit" &&
        (tool.tipDiameter === null || tool.pointAngle === null))
    )
      ctx.addIssue({
        code: "custom",
        message: "Inconsistent shared cutter geometry.",
      })
  })
export type SharedTool = z.infer<typeof SharedToolSchema>
export const SharedLibrarySchema = z
  .object({
    schema: z.literal("openspindle-shared-tools/1"),
    units: z.literal("mm"),
    tools: z.array(SharedToolSchema).max(10000),
  })
  .superRefine((library, ctx) => {
    if (new Set(library.tools.map((t) => t.id)).size !== library.tools.length)
      ctx.addIssue({
        code: "custom",
        message: "Shared tool IDs must be unique.",
      })
  })

function kindOf(tool: Tool): SharedTool["kind"] | null {
  const kind = toolKindKey(tool.kind)
  if (kind === "flat end mill") return "flat"
  if (kind === "ball end mill") return "ball"
  if (
    ["chamfer mill", "engraving", "engraving bit", "countersink"].includes(kind)
  )
    return "v-bit"
  if (kind === "drill") return "drill"
  return null
}
function entryFields(tool: Tool) {
  const kind = kindOf(tool)
  if (!kind)
    throw new Error(`${tool.name}: unsupported cutter kind ${tool.kind}.`)
  return {
    id: tool.shared?.id ?? crypto.randomUUID(),
    name: tool.name,
    kind,
    diameter: tool.diameter,
    shankDiameter: tool.geometry.shankDiameter,
    fluteLength: tool.geometry.fluteLength,
    overallLength: tool.geometry.overallLength,
    flutes: tool.flutes ?? tool.geometry.numberOfTeeth,
    tipDiameter: kind === "v-bit" ? tool.geometry.tipDiameter : null,
    pointAngle:
      tool.geometry.pointAngle ??
      (tool.geometry.taperAngle ? tool.geometry.taperAngle * 2 : null),
    manufacturer: tool.vendor,
    productId: tool.productId,
  }
}
export function sharedGeometryMatches(tool: Tool, entry: SharedTool) {
  try {
    const local = entryFields(tool)
    return Object.entries(local).every(
      ([key, value]) =>
        JSON.stringify(value) === JSON.stringify(entry[key as keyof SharedTool])
    )
  } catch {
    return false
  }
}
export async function sharedEntry(tool: Tool): Promise<SharedTool> {
  const entry = entryFields(tool)
  const revision = await webCryptoSha256(
    new TextEncoder().encode(JSON.stringify(entry))
  )
  return SharedToolSchema.parse({ ...entry, revision })
}
export function fromShared(entry: SharedTool, existing: readonly Tool[]): Tool {
  const tool = createTool(existing)
  const kinds = {
    flat: "flat end mill",
    ball: "ball end mill",
    "v-bit": "chamfer mill",
    drill: "drill",
  }
  return {
    ...tool,
    id: crypto.randomUUID(),
    shared: { id: entry.id, revision: entry.revision },
    name: entry.name,
    kind: kinds[entry.kind],
    diameter: entry.diameter,
    flutes: entry.flutes,
    vendor: entry.manufacturer,
    productId: entry.productId,
    geometry: {
      ...tool.geometry,
      shankDiameter: entry.shankDiameter,
      fluteLength: entry.fluteLength,
      overallLength: entry.overallLength,
      tipDiameter: entry.tipDiameter,
      pointAngle: entry.pointAngle,
      numberOfTeeth: entry.flutes,
    },
  }
}
