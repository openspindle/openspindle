import { useEffect, useRef } from "react"

/** Leaving a Fusion panel cancels its requests and workspace mutations waiting to start. */
export function useFusionLifetime() {
  const lifetime = useRef(new AbortController())
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => lifetime.current.abort()
  }, [])
  return lifetime
}
