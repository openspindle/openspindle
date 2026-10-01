/** Types for manifest.mjs, which the TypeScript views import. */

export type GroupId = "board" | "isolation" | "drilling" | "outline"
export type InputId = "front" | "back" | "outline" | "drill"
/** How a drill operation makes its holes: one drill per size, or one end mill for all. */
export type DrillMethod = "drill" | "mill"

export type InputDefinition = {
  readonly id: InputId
  readonly label: string
  /** Comma-separated file extensions. */
  readonly accept: string
  readonly multiple?: boolean
  readonly detect: {
    readonly suffixes: readonly string[]
    readonly contentIncludesAll: readonly string[]
  }
}

type ParameterBase = {
  readonly id: string
  readonly label: string
  readonly group: GroupId
  /** The only drill method that uses this value; without one, every method does. */
  readonly method?: DrillMethod
}

export type NumberParameter = ParameterBase & {
  readonly type: "number"
  readonly default: number
  readonly min: number
  readonly max: number
  readonly step: number
  readonly unit?: string
}

export type BooleanParameter = ParameterBase & {
  readonly type: "boolean"
  readonly default: boolean
}

export type SelectParameter = ParameterBase & {
  readonly type: "select"
  readonly default: string
  readonly options: readonly {
    readonly value: string
    readonly label: string
  }[]
}

export type ParameterDefinition =
  NumberParameter | BooleanParameter | SelectParameter

export declare const inputs: readonly InputDefinition[]
export declare function isDrillFile(file: {
  name: string
  content: string
}): boolean
export declare const parameters: readonly ParameterDefinition[]
export declare const LIMITS: Readonly<{
  inputFile: number
  inputTotal: number
  outputFile: number
  outputTotal: number
  outputCount: number
  log: number
  timeout: number
}>
