/** Developer switches for following a job, kept in local storage. */
export type DevFlags = {
  readonly tracker: "greedy" | "hmm"
  readonly overlay: boolean
  readonly record: boolean
}

const flag = (name: string) => localStorage.getItem(`openspindle:dev:${name}`)

/**
 * Read once: localStorage "openspindle:dev:tracker" = "greedy" follows jobs with the greedy
 * tracker instead of the HMM, ":tracker-overlay" = "1", ":tracker-record" = "1".
 */
export const devFlags: DevFlags = {
  tracker: flag("tracker") === "greedy" ? "greedy" : "hmm",
  overlay: flag("tracker-overlay") === "1",
  record: flag("tracker-record") === "1",
}
