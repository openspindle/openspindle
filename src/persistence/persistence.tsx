import { createContext, useContext } from "react"
import type { ReactNode } from "react"
import { Store, useSelector } from "@tanstack/react-store"
import type { SavedProcess } from "@/domain/workspace/processes"
import { processRepository } from "./process-document"
import { bindDocument } from "./bind-document"
import type { StoragePort } from "@/platform/host"
import { PersistedDocument } from "./document"
import type { DocumentState } from "./document"
import { fixtureRepository } from "./fixture-document"
import { libraryRepository } from "./library-document"

/**
 * Every persisted document of the app, loaded once at startup: the tool and stock libraries
 * and the fixture library. A project is not one: the app starts with a new project, and
 * projects are saved as files.
 */
export type Persistence = ReturnType<typeof createPersistence>

export function createPersistence(storage: StoragePort) {
  const documents = {
    library: new PersistedDocument(libraryRepository(storage)),
    fixtures: new PersistedDocument(fixtureRepository(storage)),
    processes: new PersistedDocument(processRepository(storage)),
  }
  const processStore = new Store<SavedProcess[]>([])
  bindDocument(
    documents.processes,
    {
      get state() {
        return processStore.state
      },
      hydrate: (value) => processStore.setState(() => value),
      subscribe: (listener) => {
        const subscription = processStore.subscribe(() =>
          listener(processStore.state)
        )
        return () => subscription.unsubscribe()
      },
    },
    () => []
  )
  const all = Object.values(documents)
  for (const document of all) void document.load()
  // Pending debounced saves are written before the page goes away.
  window.addEventListener("pagehide", () => {
    for (const document of all) void document.flush()
  })
  return { ...documents, processStore, all }
}

const PersistenceContext = createContext<Persistence | null>(null)

export function PersistenceProvider({
  persistence,
  children,
}: {
  persistence: Persistence
  children: ReactNode
}) {
  return (
    <PersistenceContext.Provider value={persistence}>
      {children}
    </PersistenceContext.Provider>
  )
}

export function usePersistence(): Persistence {
  const persistence = useContext(PersistenceContext)
  if (!persistence) throw new Error("PersistenceProvider is missing.")
  return persistence
}

export function useDocumentState<TValue>(
  document: PersistedDocument<TValue>
): DocumentState<TValue> {
  return useSelector(document.state)
}
