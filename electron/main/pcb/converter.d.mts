import type {
  PcbGeneration,
  PcbGenerationRequest,
} from "../../../src/platform/contract/pcb"

export class InputError extends Error {}
export class MultipleToolSlotsError extends InputError {
  readonly slots: string[]
}

export function generate(
  input: PcbGenerationRequest,
  options: { executable: string; signal?: AbortSignal }
): Promise<PcbGeneration>
