import { useLocation, useNavigate } from "@tanstack/react-router"
import { Cpu, Layers3, Play } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { isJobActive } from "@/machine/contract"
import { useMachineSnapshot } from "@/platform/machine"

const SECTIONS = ["prepare", "job", "device"] as const
type Section = (typeof SECTIONS)[number]

const isSection = (value: unknown): value is Section =>
  SECTIONS.some((section) => section === value)

/**
 * The workspace sections as tabs over routes: the URL is the source of truth. A red dot beside
 * Job shows that a job is under way.
 */
export function WorkspaceTabs() {
  const section = useLocation({
    select: (location) => location.pathname.split("/")[1],
  })
  const navigate = useNavigate()
  const running = isJobActive(useMachineSnapshot().job)
  return (
    <Tabs
      value={isSection(section) ? section : "prepare"}
      onValueChange={(value) => {
        if (isSection(value)) void navigate({ to: `/${value}` })
      }}
    >
      <TabsList variant="line" className="h-12" aria-label="Workspace">
        <TabsTrigger value="prepare" className="px-4">
          <Layers3 />
          Prepare
        </TabsTrigger>
        <TabsTrigger value="job" className="px-4">
          <Play />
          Job
          {running && (
            <>
              <span
                aria-hidden="true"
                className="size-2 rounded-full bg-destructive"
              />
              <span className="sr-only">(running)</span>
            </>
          )}
        </TabsTrigger>
        <TabsTrigger value="device" className="px-4">
          <Cpu />
          Device
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
