import { Fragment } from "react"
import { CircleAlert, RefreshCw, TriangleAlert, X } from "lucide-react"
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Toggle } from "@/components/ui/toggle"
import { ProblemText } from "@/components/workspace/problem-text"
import {
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import type { DesignRuleViolation } from "@/domain/design-rules/check"
import { plateLabel } from "@/domain/plate/plate"
import { QUICK_FIX_LABELS, useQuickFix } from "@/features/prepare/quick-fix"
import { useShowProblem } from "@/features/prepare/show-problem"
import {
  focusProblem,
  isFocused,
  useProblemFocus,
} from "@/features/viewer/problem-focus"
import {
  checkPlateDesignRules,
  closeDesignRuleResults,
  isOutOfDate,
  useDesignRuleResults,
} from "./design-rule-check"

/** "2 errors, 1 warning" with the counts as values, or that nothing breaks a rule. */
function Summary({
  violations,
}: {
  violations: readonly DesignRuleViolation[]
}) {
  const errors = violations.filter((item) => item.severity === "error").length
  const counts = [
    { noun: "error", count: errors },
    { noun: "warning", count: violations.length - errors },
  ].filter((item) => item.count > 0)
  if (!counts.length) return "No problems"
  return counts.map(({ noun, count }, index) => (
    <Fragment key={noun}>
      {index > 0 && ", "}
      <span className="font-numeric">{count}</span> {noun}
      {count === 1 ? "" : "s"}
    </Fragment>
  ))
}

/**
 * What the last design rule check found on a plate, over the 3D view's top right: each broken
 * rule per operation, with the problem and what resolves it. Show selects it and highlights it
 * in the view; Apply makes the change a machine's program rule suggests, and checks again. It
 * stays until closed, and says when the plate or the rules changed since.
 */
export function DesignRuleResults() {
  const workspace = useWorkspaceStore()
  const { result } = useDesignRuleResults()
  const focus = useProblemFocus()
  // The plate as it is named now; null once it is removed, which closes its results.
  const label = useWorkspace((state) => {
    const index = result
      ? state.plates.findIndex((plate) => plate.id === result.plate.id)
      : -1
    return index < 0 ? null : plateLabel(state.plates[index], index)
  })
  const outOfDate = useWorkspace((state) =>
    result ? isOutOfDate(result, state) : false
  )
  const showProblem = useShowProblem()
  const quickFix = useQuickFix()
  if (!result || label === null) return null
  const plateId = result.plate.id
  const { violations, notes } = result.check
  return (
    <Card
      size="sm"
      role="region"
      aria-label="Design rules"
      className="absolute top-16 right-4 z-10 max-h-[calc(100%-5rem)] w-96 max-w-[calc(100%-6rem)] shadow-lg"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Design rules
          {outOfDate && <Badge variant="outline">Out of date</Badge>}
        </CardTitle>
        <CardDescription>
          {label} · <Summary violations={violations} />
        </CardDescription>
        <CardAction className="flex gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Check again"
            title="Check again"
            onClick={() => checkPlateDesignRules(workspace.state, plateId)}
          >
            <RefreshCw />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close design rules"
            title="Close"
            onClick={closeDesignRuleResults}
          >
            <X />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-col gap-2 overflow-y-auto">
        {!violations.length && (
          <p className="text-muted-foreground">
            Nothing on this plate breaks a design rule.
          </p>
        )}
        {result.violations.map(({ key, diagnostic: violation }) => {
          const error = violation.severity === "error"
          const Icon = error ? CircleAlert : TriangleAlert
          const shown = isFocused(focus, plateId, key)
          const { fix } = violation
          return (
            <Alert key={key} variant={error ? "warning" : "default"}>
              <Icon />
              <AlertTitle>{violation.label}</AlertTitle>
              <AlertDescription>
                <ProblemText
                  problem={violation.message}
                  suggestion={violation.suggestion}
                  action={
                    fix?.kind === "resolve-rule" && (
                      <Button
                        variant={error ? "warning" : "outline"}
                        size="xs"
                        disabled={outOfDate}
                        aria-label={`Apply: ${violation.suggestion}`}
                        onClick={() => {
                          quickFix(result.plate, fix)
                          checkPlateDesignRules(workspace.state, plateId)
                        }}
                      >
                        {QUICK_FIX_LABELS[fix.kind]}
                      </Button>
                    )
                  }
                />
              </AlertDescription>
              <AlertAction>
                <Toggle
                  size="sm"
                  aria-label={`Show ${violation.label} in the 3D view`}
                  pressed={shown}
                  disabled={
                    outOfDate ||
                    (!violation.lines.length && !violation.places?.length)
                  }
                  onPressedChange={(pressed) => {
                    if (pressed) showProblem({ plateId, key }, violation)
                    else focusProblem(null)
                  }}
                >
                  Show
                </Toggle>
              </AlertAction>
            </Alert>
          )
        })}
        {notes.map((note) => (
          <p key={note} className="text-muted-foreground">
            {note}
          </p>
        ))}
      </CardContent>
    </Card>
  )
}
