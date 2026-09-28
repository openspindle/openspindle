import { constants } from "node:fs"
import { access, stat } from "node:fs/promises"
import path from "node:path"
import { RpcError } from "@openspindle/rpc"
import type {
  InstalledPluginRecord,
  SettingDeclaration,
} from "@openspindle/plugin-core"

/** One of the settings the plugin's manifest declares. */
export function declaredSetting(
  record: InstalledPluginRecord,
  settingId: string
): SettingDeclaration {
  const setting = record.manifest.settings.find((item) => item.id === settingId)
  if (!setting)
    throw new RpcError(
      "NOT_FOUND",
      `${record.manifest.name} has no such setting.`
    )
  return setting
}

/**
 * The value stored for a setting, once checked. An executable is a program the user can
 * run, by its full path, kept as entered: a link to it (such as a package manager's) keeps
 * working when it moves on to a newer version.
 */
export async function checkedSetting(
  setting: SettingDeclaration,
  value: string
): Promise<string> {
  const file = value.trim()
  if (!path.isAbsolute(file))
    throw new RpcError(
      "INVALID_PARAMS",
      `Enter the full path of ${setting.label}.`
    )
  const info = await stat(file).catch(() => null)
  if (!info?.isFile())
    throw new RpcError("INVALID_PARAMS", `There is no program at ${file}.`)
  try {
    await access(file, constants.X_OK)
  } catch {
    throw new RpcError(
      "INVALID_PARAMS",
      `${file} is not a program you can run.`
    )
  }
  return file
}
