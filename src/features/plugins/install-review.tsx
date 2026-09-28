import { AppWindow, ShieldCheck, TriangleAlert } from "lucide-react"
import type {
  InstallReview,
  PackageOrigin,
  ViewSlot,
} from "@openspindle/plugin-core"
import { CAPABILITY_INFO } from "@openspindle/plugin-core"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { formatBytes, plural } from "@/domain/primitives"
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"

export const VIEW_SLOT_LABELS: Record<ViewSlot, string> = {
  "process.importer": "Importer in Add operation",
  "operation.editor": "Editor for its operations",
}

/**
 * Where a package came from: a repository at one commit, a development folder, or the app
 * itself.
 */
export function PluginSource({ source }: { source: PackageOrigin }) {
  if (source.kind === "bundled")
    return <FieldDescription>Comes with OpenSpindle</FieldDescription>
  if (source.kind === "folder")
    return (
      <FieldDescription className="break-all">
        Development folder {source.path}
      </FieldDescription>
    )
  return (
    <FieldDescription className="break-all">
      <a href={source.repository} target="_blank" rel="noreferrer">
        {source.repository.replace("https://github.com/", "")}
      </a>{" "}
      at {source.commit.slice(0, 7)}
    </FieldDescription>
  )
}

function Permissions({ review }: { review: InstallReview }) {
  const removed = review.removedPermissions.map(
    (capability) => CAPABILITY_INFO[capability].title
  )
  return (
    <FieldSet>
      <FieldLegend variant="label">Permissions</FieldLegend>
      {review.permissions.length > 0 ? (
        <ItemGroup>
          {review.permissions.map((permission) => (
            <Item key={permission.capability} variant="outline" size="sm">
              <ItemMedia variant="icon">
                <ShieldCheck />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{permission.title}</ItemTitle>
                <ItemDescription>{permission.description}</ItemDescription>
              </ItemContent>
              {review.previous && permission.added && (
                <ItemActions>
                  <Badge>New</Badge>
                </ItemActions>
              )}
            </Item>
          ))}
        </ItemGroup>
      ) : (
        <FieldDescription>
          No permissions: it cannot read the workspace, the tool library or the
          machine.
        </FieldDescription>
      )}
      {removed.length > 0 && (
        <FieldDescription>
          No longer asks to {removed.join(", ")}.
        </FieldDescription>
      )}
    </FieldSet>
  )
}

function Companion({
  companion,
  executables,
  source,
}: {
  companion: NonNullable<InstallReview["companion"]>
  executables: readonly string[]
  source: PackageOrigin
}) {
  const start =
    companion.activation === "on-view"
      ? "when one of its views opens"
      : "when one of its views first needs it"
  const origin = source.kind === "github" ? "this repository" : "this folder"
  return (
    <Alert>
      <TriangleAlert />
      <AlertTitle>Runs a program on this computer</AlertTitle>
      <AlertDescription>
        <p>
          Its {companion.runtime === "node" ? "Node" : "native"} companion
          starts {start} and can read and change your files like any program you
          run. Install it only if you trust {origin}.
        </p>
        {executables.length > 0 && (
          <p className="break-all">
            Programs it can run: {executables.join(", ")}
          </p>
        )}
      </AlertDescription>
    </Alert>
  )
}

/** Everything the user confirms before a plugin is installed or updated. */
export function InstallReviewDetails({ review }: { review: InstallReview }) {
  const { plugin, previous } = review
  const contents: string[] = []
  if (review.programs) contents.push(plural(review.programs, "program"))
  if (review.views.length) contents.push(plural(review.views.length, "view"))
  contents.push(plural(review.files, "file"), formatBytes(review.bytes))
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <FieldDescription>
          {previous
            ? `Version ${previous.version} is installed; this installs ${plugin.version}.`
            : `Version ${plugin.version}`}
        </FieldDescription>
        <FieldDescription>{plugin.description}</FieldDescription>
        <PluginSource source={review.source} />
      </div>
      {review.companion && (
        <Companion
          companion={review.companion}
          executables={review.executables}
          source={review.source}
        />
      )}
      <Permissions review={review} />
      <FieldSet>
        <FieldLegend variant="label">Contents</FieldLegend>
        <FieldDescription className="font-numeric">
          {contents.join(" · ")}
        </FieldDescription>
        {review.views.length > 0 && (
          <ItemGroup>
            {review.views.map((view) => (
              <Item key={view.id} variant="outline" size="sm">
                <ItemMedia variant="icon">
                  <AppWindow />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{view.title}</ItemTitle>
                  <ItemDescription>
                    {VIEW_SLOT_LABELS[view.slot]}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        )}
      </FieldSet>
    </div>
  )
}
