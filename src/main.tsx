import "@/app/errors/instrument"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import {
  RouterProvider,
  createHashHistory,
  createRouter,
} from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen"
import { connectLog, log } from "@/app/errors/log"
import { reportRenderError } from "@/app/errors/reports"
import {
  AppErrorBoundary,
  ErrorFallback,
} from "@/features/error-report/error-fallback"
import { diagnosticsStatusQuery } from "@/platform/diagnostics"
import { HostProvider, createHost } from "@/platform/host-context"
import {
  PersistenceProvider,
  createPersistence,
} from "@/persistence/persistence"
import { bindDocument } from "@/persistence/bind-document"
import { loadDefaultLibrary, newProject } from "@/app/workspace/defaults"
import { keepWorkspaceAcrossReloads } from "@/app/workspace/kept-workspace"
import { libraryTarget } from "@/app/workspace/library-target"
import { startNewProject } from "@/app/workspace/project-session"
import { WorkspaceStore } from "@/app/workspace/store"
import { AppStoresProvider } from "@/app/stores"
import {
  FixtureLibraryStore,
  createFixtureLibrary,
  profilePlacement,
} from "@/app/fixtures/fixture-library-store"
import "./styles.css"

const host = await createHost(log)
connectLog(host.diagnostics)
const persistence = createPersistence(host.storage)
const defaultLibrary = await loadDefaultLibrary()
// Every launch starts with a new project on the kept libraries; a project is kept by saving it.
const workspace = new WorkspaceStore(newProject(defaultLibrary))
const fixtures = new FixtureLibraryStore()
bindDocument(
  persistence.library,
  libraryTarget(workspace),
  () => defaultLibrary
)
bindDocument(persistence.fixtures, fixtures, createFixtureLibrary)
const stores = { workspace, fixtures }
// The UI starts once every stored document is restored (or blocked on load issues, which
// the app shows): a drop or an open made earlier would be replaced by it.
await Promise.all(persistence.all.map((document) => document.load()))
// The new project shows the bed as its plate 1, on the selected profile's fixtures.
startNewProject(workspace, profilePlacement(fixtures.state))
// A reload (⌘R, or the dev server's after a code change) brings back the workspace it left.
await keepWorkspaceAcrossReloads(workspace, host.window)

// Host calls are IPC, not network requests: never pause them for "offline" or retry them.
// Failures show where they happen; the log keeps them too.
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) =>
      log.warn(`Query ${JSON.stringify(query.queryKey)} failed`, error),
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _result, mutation) =>
      log.warn(
        `${mutation.options.mutationKey ? JSON.stringify(mutation.options.mutationKey) : "An action"} failed`,
        error
      ),
  }),
  defaultOptions: {
    queries: { networkMode: "always", retry: false },
    mutations: { networkMode: "always", retry: false },
  },
})

// The error dialog needs to know at once whether this build reports errors.
void queryClient.prefetchQuery(diagnosticsStatusQuery(host.diagnostics))

// Hash history works for app:// and the dev server alike.
const router = createRouter({
  routeTree,
  history: createHashHistory(),
  context: { host, queryClient },
  defaultPreload: "intent",
  scrollRestoration: true,
  // A route that fails shows the error in its place, with the error dialog.
  defaultErrorComponent: ErrorFallback,
  defaultOnCatch: (error, info) =>
    reportRenderError(error, info.componentStack),
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

const root = document.getElementById("app")
if (!root) throw new Error("The #app element is missing.")

createRoot(root, {
  onUncaughtError: (error, info) =>
    reportRenderError(error, info.componentStack),
}).render(
  <StrictMode>
    <HostProvider host={host}>
      <PersistenceProvider persistence={persistence}>
        <AppStoresProvider value={stores}>
          <QueryClientProvider client={queryClient}>
            <AppErrorBoundary>
              <RouterProvider router={router} />
            </AppErrorBoundary>
          </QueryClientProvider>
        </AppStoresProvider>
      </PersistenceProvider>
    </HostProvider>
  </StrictMode>
)
