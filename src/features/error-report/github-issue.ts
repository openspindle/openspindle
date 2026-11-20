import type { ErrorReport } from "@/app/errors/reports"
import type { AppInfo } from "@/platform/contract/diagnostics"

/** Spinnvill's issues; the app opens links to github.com in the browser. */
const NEW_ISSUE_URL = "https://github.com/passeride/openspindle/issues/new"
/** An issue's text travels in its URL: the stack is cut short, the error ID finds the rest. */
const STACK_LINES = 12

/** A new GitHub issue about an error, filled in with what the error dialog knows. */
export function newIssueUrl(
  report: ErrorReport,
  app: AppInfo | undefined,
  description: string
): string {
  const { name, message, stack } = report.error
  const summary = message ? `${name}: ${message}` : name
  const trace = stack
    ? stack.split("\n").slice(0, STACK_LINES).join("\n")
    : summary
  const body = [
    "### What happened",
    "",
    description.trim() ||
      "<!-- What were you doing when the error appeared? -->",
    "",
    "### Error",
    "",
    "```",
    trace,
    "```",
    "",
    `- Error ID: \`${report.eventId}\``,
    ...(app
      ? [`- Spinnvill ${app.version}, Electron ${app.electron}, ${app.os}`]
      : []),
    "",
    "<!-- Please attach the log: Download log in the error dialog, or Help › Export Log. -->",
  ].join("\n")
  const url = new URL(NEW_ISSUE_URL)
  url.searchParams.set("title", summary.slice(0, 120))
  url.searchParams.set("body", body)
  return url.toString()
}
