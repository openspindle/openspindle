import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { WebGPURenderer } from "three/webgpu"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { parseGCode } from "@/domain/nc/gcode"
import type { FreecadHandoff } from "@/formats/freecad/handoff"
import type { ViewerPlate } from "@/components/workspace/viewer/viewer-input"
import type { RemovalGrid } from "@/domain/tools/material-removal"
import { RemovalStockGeometry } from "@/components/workspace/viewer/removal-stock"
import { removalSurfaces } from "@/components/workspace/viewer/removal-surface"
import { materialFinish } from "@/components/workspace/viewer/material-finish"
import { referenceObjects } from "@/components/workspace/viewer/reference-model"
import { disposeObjects } from "@/lib/three-assets"
import { FieldDescription } from "@/components/ui/field"

export function Preview({
  bundle,
  line,
}: {
  bundle: FreecadHandoff
  line: number
}) {
  const container = useRef<HTMLDivElement>(null)
  const update = useRef<(line: number) => void>(() => {})
  const [problem, setProblem] = useState("")
  useEffect(() => {
    const element = container.current!
    let disposed = false
    const renderer = new WebGPURenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    element.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const [min, max] = [bundle.stock.min, bundle.stock.max]
    const width = max[0] - min[0],
      depth = max[1] - min[1],
      height = max[2] - min[2]
    const stock = {
      id: "preview",
      name: bundle.material?.name ?? "Stock",
      material: bundle.material?.name ?? "Unknown",
      color: bundle.material?.color ?? "#aab3bb",
      width,
      depth,
      height,
      appearance: bundle.material,
    }
    const color = new THREE.Color(stock.color)
    const stockGroup = new THREE.Group()
    scene.add(stockGroup)
    const plain = new THREE.Mesh(
      new THREE.BoxGeometry(width, depth, height),
      materialFinish(stock.material, color, bundle.material)
    )
    plain.position.set(
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2
    )
    stockGroup.add(plain)
    const reference = new THREE.Group()
    reference.add(...referenceObjects(bundle.reference))
    scene.add(reference)
    const program = parseGCode(bundle.program.nc)
    const positions = program.segments.flatMap((s) => [...s.start, ...s.end])
    const pathGeometry = new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    )
    const upcoming = new THREE.LineSegments(
      pathGeometry,
      new THREE.LineBasicMaterial({
        color: 0x4694db,
        transparent: true,
        opacity: 0.2,
      })
    )
    scene.add(upcoming)
    const completedGeometry = pathGeometry.clone()
    const completed = new THREE.LineSegments(
      completedGeometry,
      new THREE.LineBasicMaterial({ color: 0x30a078 })
    )
    scene.add(completed)
    const light = new THREE.DirectionalLight(0xffffff, 4)
    light.position.set(-50, -100, 200)
    scene.add(light, new THREE.HemisphereLight(0xffffff, 0x536070, 2))
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100000)
    camera.up.set(0, 0, 1)
    const span = Math.max(width, depth, height, 20)
    camera.position.set(
      (min[0] + max[0]) / 2 + span,
      (min[1] + max[1]) / 2 - span * 1.5,
      max[2] + span * 1.6
    )
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2
    )
    controls.update()
    const resize = new ResizeObserver(() => {
      const w = element.clientWidth,
        h = element.clientHeight
      if (!w || !h) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    })
    resize.observe(element)
    const plate = { stock, stockAnchor: min } as ViewerPlate
    let sampled: THREE.Mesh<RemovalStockGeometry> | null = null
    const worker = new Worker(new URL("./removal-worker.ts", import.meta.url), {
      type: "module",
    })
    let busy = false,
      wanted = line,
      lastSent = line,
      first = true
    const post = () => {
      if (busy || disposed) return
      busy = true
      lastSent = wanted
      worker.postMessage({ line: wanted, ...(first ? { bundle } : {}) })
      first = false
    }
    worker.onmessage = (
      event: MessageEvent<{ grid?: RemovalGrid; error?: string }>
    ) => {
      busy = false
      if (disposed) return
      if (event.data.error) {
        setProblem(event.data.error)
        return
      }
      if (event.data.grid) {
        if (lastSent > wanted) {
          post()
          return
        }
        const grid = event.data.grid
        if (sampled) sampled.geometry.update(plate, grid)
        else {
          const geometry = new RemovalStockGeometry(plate, grid)
          const finish = { color, metalness: 0.55, roughness: 0.35 }
          sampled = new THREE.Mesh(
            geometry,
            removalSurfaces(stock, geometry, finish, finish)
          )
          stockGroup.remove(plain)
          disposeObjects(plain)
          stockGroup.add(sampled)
        }
      }
      if (lastSent !== wanted) post()
    }
    update.current = (next) => {
      wanted = next
      let index = program.segments.findIndex((s) => s.line > next)
      if (index < 0) index = program.segments.length
      completedGeometry.setDrawRange(0, index * 2)
      upcoming.geometry.setDrawRange(
        index * 2,
        Math.max(0, program.segments.length - index) * 2
      )
      post()
    }
    setProblem(
      program.unreadable ? "Some program lines cannot be previewed." : ""
    )
    update.current(line)
    let animation = 0
    renderer
      .init()
      .then(() => {
        if (disposed) return
        const draw = () => {
          if (disposed) return
          renderer.render(scene, camera)
          animation = requestAnimationFrame(draw)
        }
        draw()
      })
      .catch((error) => setProblem(String(error)))
    return () => {
      disposed = true
      cancelAnimationFrame(animation)
      worker.terminate()
      resize.disconnect()
      controls.dispose()
      disposeObjects(scene)
      renderer.dispose()
      renderer.domElement.remove()
      update.current = () => {}
    }
  }, [bundle])
  useEffect(() => update.current(line), [line])
  return (
    <div className="flex flex-col gap-2">
      <div ref={container} className="h-[60vh] min-h-80 w-full" />
      {problem && <FieldDescription>{problem}</FieldDescription>}
      <FieldDescription>
        Nominal work-coordinate preview · completed paths follow the host's
        reported program line.
      </FieldDescription>
    </div>
  )
}
