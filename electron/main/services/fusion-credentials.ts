import { chmod, readFile, rm } from "node:fs/promises"
import { safeStorage } from "electron"
import { writeFileAtomic } from "./atomic-write"

/** Where the Fusion connection's token is kept between app sessions. */
export type FusionCredentials = {
  /** The token kept; null without one, or when it cannot be read. */
  readonly load: () => Promise<string | null>
  /** Keeps `token`; false when the system cannot encrypt it, so it lasts this session only. */
  readonly save: (token: string) => Promise<boolean>
  readonly clear: () => Promise<void>
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/

/**
 * The token in `filePath`, encrypted with the operating system's key store (Electron's
 * safeStorage: the macOS Keychain, Windows' DPAPI), readable by this user only. It is never
 * written unencrypted: without encryption the connection lasts for the session.
 */
export function storedFusionCredentials(filePath: string): FusionCredentials {
  return {
    async load() {
      if (!safeStorage.isEncryptionAvailable()) return null
      try {
        const token = safeStorage.decryptString(await readFile(filePath))
        return TOKEN.test(token) ? token : null
      } catch {
        return null
      }
    },
    async save(token) {
      if (!safeStorage.isEncryptionAvailable()) return false
      await writeFileAtomic(filePath, safeStorage.encryptString(token))
      await chmod(filePath, 0o600)
      return true
    },
    async clear() {
      await rm(filePath, { force: true })
    },
  }
}
