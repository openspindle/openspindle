export class RuntimeError extends Error {}
export class SetupNeededError extends RuntimeError {}

export type PcbRuntime = {
  executable: string
  version: string
  found: boolean
}

export function findRuntime(
  setting: string | null,
  options?: { signal?: AbortSignal; installed?: string[] }
): Promise<PcbRuntime>
