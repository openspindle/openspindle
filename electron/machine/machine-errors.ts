import { RpcError } from "@openspindle/rpc"
import type { RpcErrorCode } from "@openspindle/rpc"
import { MachineError } from "../../src/machine/core/errors.ts"
import type { MachineErrorCode } from "../../src/machine/core/errors.ts"

const MACHINE_ERROR_CODES: Record<MachineErrorCode, RpcErrorCode> = {
  "not-connected": "UNAVAILABLE",
  busy: "BUSY",
  refused: "CONFLICT",
  "confirmation-required": "CONFLICT",
  rejected: "FAILED",
  timeout: "TIMEOUT",
  unverified: "FAILED",
  cancelled: "CANCELLED",
  "connection-lost": "UNAVAILABLE",
  invalid: "INVALID_PARAMS",
  permission: "PERMISSION_DENIED",
}

/** Machine failures keep their user-facing message and a matching RPC code. */
export function machineRpcError(error: unknown): unknown {
  return error instanceof MachineError
    ? new RpcError(MACHINE_ERROR_CODES[error.code], error.message, {
        machine: error.code,
      })
    : error
}

export async function machine<TResult>(
  run: () => TResult | Promise<TResult>
): Promise<TResult> {
  try {
    return await run()
  } catch (error) {
    throw machineRpcError(error)
  }
}
