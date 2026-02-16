import { Delaunay } from 'd3-delaunay'

interface Point {
  x: number
  y: number
}

interface PrimalEdge {
  u: number
  v: number
}

interface Face {
  vertices: number[]
  edges: number[]
}

interface MedialEdge {
  a: number
  b: number
  control: Point
}

interface CubicCurve {
  p0: Point
  p1: Point
  p2: Point
  p3: Point
}

interface RenderCurve {
  curve: CubicCurve
  path: string
  startHalfId: number
  endHalfId: number
}

interface IncidentStub {
  halfId: number
  control: Point
  outer: boolean
}

class UnionFind {
  private parent: Int32Array
  private rank: Int8Array

  constructor(size: number) {
    this.parent = new Int32Array(size)
    this.rank = new Int8Array(size)
    for (let i = 0; i < size; i += 1) {
      this.parent[i] = i
    }
  }

  find(x: number): number {
    let root = x
    while (this.parent[root] !== root) {
      root = this.parent[root]
    }
    while (this.parent[x] !== x) {
      const next = this.parent[x]
      this.parent[x] = root
      x = next
    }
    return root
  }

  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) {
      return
    }

    const rankA = this.rank[ra]
    const rankB = this.rank[rb]

    if (rankA < rankB) {
      this.parent[ra] = rb
      return
    }

    this.parent[rb] = ra
    if (rankA === rankB) {
      this.rank[ra] = (rankA + 1) as number
    }
  }
}

export interface GenerateOptions {
  crossings: number
  seed: string | number
  width?: number
  height?: number
  padding?: number
  cornerInset?: number
  strokeWidth?: number
  crossingGapScale?: number
  useArcGuideLayout?: boolean
  maxAttempts?: number
}

export interface Diagram {
  width: number
  height: number
  requestedCrossings: number
  crossings: number
  components: number
  seed: number
  strokeWidth: number
  haloWidth: number
  basePaths: string[]
  basePathComponents: number[]
  overPaths: string[]
  overPathComponents: number[]
  crossingRadius: number
  minCrossingAngleDeg: number
  qualityScore: number
  attempts: number
  primalVertices: number
  hullVertices: number
  warning?: string
}

export interface SvgOptions {
  strokeWidth?: number
  strokeColor?: string
  backgroundColor?: string
  colorByComponent?: boolean
  componentPalette?: string[]
}

const TAU = Math.PI * 2
const GOLDEN_GAMMA = 0x9e3779b9
const DEFAULT_COMPONENT_PALETTE = [
  '#1f3f99',
  '#b24a00',
  '#00705a',
  '#6a2fb8',
  '#b22266',
  '#3c6e00',
  '#b0302a',
  '#005f99',
]

export function colorForComponent(componentId: number, palette: string[] = DEFAULT_COMPONENT_PALETTE): string {
  if (palette.length > 0) {
    if (componentId >= 0 && componentId < palette.length) {
      return palette[componentId] as string
    }
    if (componentId >= 0) {
      const hue = (componentId * 137.50776405003785) % 360
      return `hsl(${formatNum(hue)} 62% 40%)`
    }
  }
  return DEFAULT_COMPONENT_PALETTE[0]
}

function hashSeed(seed: string | number): number {
  if (typeof seed === 'number') {
    const normalized = seed >>> 0
    return normalized === 0 ? 1 : normalized
  }

  let h = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }

  const normalized = h >>> 0
  return normalized === 0 ? 1 : normalized
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let x = Math.imul(t ^ (t >>> 15), 1 | t)
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function lerp(a: Point, b: Point, t: number): Point {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  }
}

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y }
}

function scale(a: Point, k: number): Point {
  return { x: a.x * k, y: a.y * k }
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y
}

function length(a: Point): number {
  return Math.hypot(a.x, a.y)
}

function normalize(a: Point): Point {
  const len = length(a)
  if (len < 1e-9) {
    return { x: 1, y: 0 }
  }
  return { x: a.x / len, y: a.y / len }
}

function formatNum(value: number): string {
  return value.toFixed(3)
}

function curveToPath(curve: CubicCurve): string {
  return `M ${formatNum(curve.p0.x)} ${formatNum(curve.p0.y)} C ${formatNum(curve.p1.x)} ${formatNum(curve.p1.y)} ${formatNum(curve.p2.x)} ${formatNum(curve.p2.y)} ${formatNum(curve.p3.x)} ${formatNum(curve.p3.y)}`
}

function cubicPoint(curve: CubicCurve, t: number): Point {
  const u = 1 - t
  const uu = u * u
  const tt = t * t
  const uuu = uu * u
  const ttt = tt * t

  return {
    x: uuu * curve.p0.x + 3 * uu * t * curve.p1.x + 3 * u * tt * curve.p2.x + ttt * curve.p3.x,
    y: uuu * curve.p0.y + 3 * uu * t * curve.p1.y + 3 * u * tt * curve.p2.y + ttt * curve.p3.y,
  }
}

function distanceSquared(a: Point, b: Point): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

function segmentDistanceSquared(a0: Point, a1: Point, b0: Point, b1: Point): number {
  const eps = 1e-9
  const u = sub(a1, a0)
  const v = sub(b1, b0)
  const w = sub(a0, b0)

  const a = dot(u, u)
  const b = dot(u, v)
  const c = dot(v, v)
  const d = dot(u, w)
  const e = dot(v, w)
  const denom = a * c - b * b

  let sNumerator = 0
  let sDenominator = denom
  let tNumerator = 0
  let tDenominator = denom

  if (denom < eps) {
    sNumerator = 0
    sDenominator = 1
    tNumerator = e
    tDenominator = c
  } else {
    sNumerator = b * e - c * d
    tNumerator = a * e - b * d

    if (sNumerator < 0) {
      sNumerator = 0
      tNumerator = e
      tDenominator = c
    } else if (sNumerator > sDenominator) {
      sNumerator = sDenominator
      tNumerator = e + b
      tDenominator = c
    }
  }

  if (tNumerator < 0) {
    tNumerator = 0
    if (-d < 0) {
      sNumerator = 0
    } else if (-d > a) {
      sNumerator = sDenominator
    } else {
      sNumerator = -d
      sDenominator = a
    }
  } else if (tNumerator > tDenominator) {
    tNumerator = tDenominator
    if (-d + b < 0) {
      sNumerator = 0
    } else if (-d + b > a) {
      sNumerator = sDenominator
    } else {
      sNumerator = -d + b
      sDenominator = a
    }
  }

  const s = Math.abs(sNumerator) < eps ? 0 : sNumerator / sDenominator
  const t = Math.abs(tNumerator) < eps ? 0 : tNumerator / tDenominator
  const delta = sub(add(w, scale(u, s)), scale(v, t))

  return dot(delta, delta)
}

function hasUnwantedIntersections(curves: RenderCurve[], strokeWidth: number): boolean {
  if (curves.length < 2) {
    return false
  }

  interface SegmentSample {
    curveIndex: number
    t0: number
    t1: number
    a: Point
    b: Point
    minX: number
    maxX: number
    minY: number
    maxY: number
  }

  const fullClearance = Math.max(0.9, strokeWidth * 0.09 + 0.65)
  const endpointClearance = Math.max(0.65, fullClearance * 0.55)
  const endpointSlackT = clamp(0.095 + strokeWidth * 0.0032, 0.1, 0.2)
  const endpointBandT = clamp(0.14 + strokeWidth * 0.0026, 0.14, 0.22)
  const cellSize = Math.max(14, fullClearance * 1.42)
  const segments: SegmentSample[] = []

  for (let i = 0; i < curves.length; i += 1) {
    const curve = curves[i].curve
    const approxLength = length(sub(curve.p1, curve.p0)) + length(sub(curve.p2, curve.p1)) + length(sub(curve.p3, curve.p2))
    const steps = clamp(Math.ceil(approxLength / Math.max(8, fullClearance * 0.62)), 10, 44)

    let prevPoint = curve.p0
    let prevT = 0
    for (let k = 1; k <= steps; k += 1) {
      const t = k / steps
      const point = k === steps ? curve.p3 : cubicPoint(curve, t)
      if (distanceSquared(prevPoint, point) > 1e-8) {
        segments.push({
          curveIndex: i,
          t0: prevT,
          t1: t,
          a: prevPoint,
          b: point,
          minX: Math.min(prevPoint.x, point.x),
          maxX: Math.max(prevPoint.x, point.x),
          minY: Math.min(prevPoint.y, point.y),
          maxY: Math.max(prevPoint.y, point.y),
        })
      }
      prevPoint = point
      prevT = t
    }
  }

  const bucket = new Map<string, number[]>()
  const checkedPairs = new Set<string>()

  const nearSharedEndpoint = (
    segment: SegmentSample,
    curve: RenderCurve,
    sharedHalfId: number,
  ): boolean => {
    if (curve.startHalfId === sharedHalfId && segment.t1 <= endpointSlackT) {
      return true
    }
    if (curve.endHalfId === sharedHalfId && segment.t0 >= 1 - endpointSlackT) {
      return true
    }
    return false
  }

  const bboxDistanceSq = (left: SegmentSample, right: SegmentSample): number => {
    const dx = Math.max(0, Math.max(left.minX - right.maxX, right.minX - left.maxX))
    const dy = Math.max(0, Math.max(left.minY - right.maxY, right.minY - left.maxY))
    return dx * dx + dy * dy
  }

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]
    const minX = segment.minX - fullClearance
    const maxX = segment.maxX + fullClearance
    const minY = segment.minY - fullClearance
    const maxY = segment.maxY + fullClearance
    const gx0 = Math.floor(minX / cellSize)
    const gx1 = Math.floor(maxX / cellSize)
    const gy0 = Math.floor(minY / cellSize)
    const gy1 = Math.floor(maxY / cellSize)

    for (let gx = gx0; gx <= gx1; gx += 1) {
      for (let gy = gy0; gy <= gy1; gy += 1) {
        const key = `${gx},${gy}`
        const seen = bucket.get(key)
        if (!seen) {
          continue
        }

        for (let idx = 0; idx < seen.length; idx += 1) {
          const otherIndex = seen[idx] as number
          const pairKey = `${otherIndex}:${i}`
          if (checkedPairs.has(pairKey)) {
            continue
          }
          checkedPairs.add(pairKey)

          const other = segments[otherIndex] as SegmentSample
          if (segment.curveIndex === other.curveIndex) {
            continue
          }
          const curve = curves[segment.curveIndex] as RenderCurve
          const otherCurve = curves[other.curveIndex] as RenderCurve
          const sharedStart = curve.startHalfId
          const sharedEnd = curve.endHalfId

          let sharedHalfId = -1
          if (sharedStart === otherCurve.startHalfId || sharedStart === otherCurve.endHalfId) {
            sharedHalfId = sharedStart
          } else if (sharedEnd === otherCurve.startHalfId || sharedEnd === otherCurve.endHalfId) {
            sharedHalfId = sharedEnd
          }

          if (
            sharedHalfId >= 0 &&
            nearSharedEndpoint(segment, curve, sharedHalfId) &&
            nearSharedEndpoint(other, otherCurve, sharedHalfId)
          ) {
            continue
          }

          const nearEndpoint =
            segment.t0 <= endpointBandT ||
            segment.t1 >= 1 - endpointBandT ||
            other.t0 <= endpointBandT ||
            other.t1 >= 1 - endpointBandT
          const clearance = nearEndpoint ? endpointClearance : fullClearance
          const clearanceSq = clearance * clearance
          if (bboxDistanceSq(segment, other) >= clearanceSq) {
            continue
          }

          if (segmentDistanceSquared(segment.a, segment.b, other.a, other.b) < clearanceSq) {
            return true
          }
        }
      }
    }

    for (let gx = gx0; gx <= gx1; gx += 1) {
      for (let gy = gy0; gy <= gy1; gy += 1) {
        const key = `${gx},${gy}`
        const list = bucket.get(key)
        if (list) {
          list.push(i)
        } else {
          bucket.set(key, [i])
        }
      }
    }
  }

  return false
}

function edgeKey(u: number, v: number): string {
  return u < v ? `${u}:${v}` : `${v}:${u}`
}

function normalizeRequestedCrossings(raw: number): { target: number; warning?: string } {
  const rounded = Math.max(1, Math.round(raw))
  if (rounded <= 3) {
    return {
      target: 3,
      warning: rounded === 3 ? undefined : `Crossing count ${rounded} is too small for this constructor, using 3.`,
    }
  }
  if (rounded === 4) {
    return {
      target: 5,
      warning: 'Crossing count 4 is not realizable by this triangulation-medial constructor, using 5.',
    }
  }
  return { target: rounded }
}

function choosePrimalSize(targetCrossings: number): { primalVertices: number; hullVertices: number } {
  const minVertices = Math.ceil((targetCrossings + 6) / 3)
  const maxVertices = Math.floor((targetCrossings + 3) / 2)

  if (minVertices > maxVertices) {
    throw new Error('Unable to choose a valid primal graph size for the requested crossing count.')
  }

  const desiredHull = clamp(Math.round(Math.sqrt(targetCrossings) + 4), 3, maxVertices)
  const desiredInterior = Math.max(1, Math.round(Math.sqrt(targetCrossings) * 0.45))

  let best: { primalVertices: number; hullVertices: number; score: number } | null = null

  for (let primalVertices = minVertices; primalVertices <= maxVertices; primalVertices += 1) {
    const hullVertices = 3 * primalVertices - 3 - targetCrossings
    if (hullVertices < 3 || hullVertices > primalVertices) {
      continue
    }

    const interiorVertices = primalVertices - hullVertices
    const hullPenalty = Math.abs(hullVertices - desiredHull)
    const interiorPenalty = interiorVertices < desiredInterior ? (desiredInterior - interiorVertices) * 1.35 : 0
    const score = hullPenalty + interiorPenalty

    if (
      !best ||
      score < best.score ||
      (score === best.score && hullVertices > best.hullVertices) ||
      (score === best.score && hullVertices === best.hullVertices && primalVertices < best.primalVertices)
    ) {
      best = { primalVertices, hullVertices, score }
    }
  }

  if (!best) {
    throw new Error('Failed to solve primal hull size constraints.')
  }

  return { primalVertices: best.primalVertices, hullVertices: best.hullVertices }
}

function outerFaceControl(
  prev: Point,
  current: Point,
  next: Point,
  viewportCenter: Point,
  cornerInset: number,
  padding: number,
): Point {
  const towardPrev = normalize(sub(prev, current))
  const towardNext = normalize(sub(next, current))

  let inwardBisector = add(towardPrev, towardNext)
  if (length(inwardBisector) < 1e-9) {
    inwardBisector = normalize(sub(viewportCenter, current))
  } else {
    inwardBisector = normalize(inwardBisector)
  }

  const outwardBisector = scale(inwardBisector, -1)
  const localScale = Math.min(length(sub(prev, current)), length(sub(next, current)))
  const inset01 = clamp((cornerInset - 0.04) / 0.86, 0, 1)
  const easedInset = inset01 * inset01 * (3 - 2 * inset01)
  const minOffset = Math.max(5, localScale * 0.11)
  const softCap = Math.max(minOffset + 1, padding * (0.95 + easedInset * 2.65))
  const desiredOffset = localScale * (0.16 + easedInset * 0.92)
  const offset = clamp(desiredOffset, minOffset, softCap)

  return add(current, scale(outwardBisector, offset))
}

function generatePoints(
  primalVertices: number,
  hullVertices: number,
  width: number,
  height: number,
  padding: number,
  rng: () => number,
): Point[] {
  const cx = width / 2
  const cy = height / 2
  const rx = Math.max(8, width / 2 - padding)
  const ry = Math.max(8, height / 2 - padding)

  const points: Point[] = []
  const phase = rng() * TAU
  const wobblePhase = rng() * TAU

  for (let i = 0; i < hullVertices; i += 1) {
    const theta = phase + (TAU * i) / hullVertices
    const wobble = 1 + 0.035 * Math.sin(theta * 3 + wobblePhase)
    points.push({
      x: cx + rx * wobble * Math.cos(theta),
      y: cy + ry * wobble * Math.sin(theta),
    })
  }

  const interiorCount = primalVertices - hullVertices
  const hull = points.slice(0, hullVertices)

  const fanAreas: number[] = []
  let totalFanArea = 0
  for (let i = 1; i < hullVertices - 1; i += 1) {
    const a = hull[0] as Point
    const b = hull[i] as Point
    const c = hull[i + 1] as Point
    const doubleArea = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
    fanAreas.push(doubleArea)
    totalFanArea += doubleArea
  }

  for (let i = 0; i < interiorCount; i += 1) {
    let tri = 0
    let pick = rng() * totalFanArea
    while (tri < fanAreas.length - 1 && pick > fanAreas[tri]) {
      pick -= fanAreas[tri] as number
      tri += 1
    }

    const a = hull[0] as Point
    const b = hull[tri + 1] as Point
    const c = hull[tri + 2] as Point

    let u = rng()
    let v = rng()
    if (u + v > 1) {
      u = 1 - u
      v = 1 - v
    }

    const sample = {
      x: a.x + u * (b.x - a.x) + v * (c.x - a.x),
      y: a.y + u * (b.y - a.y) + v * (c.y - a.y),
    }

    const inwardPull = 0.04 + rng() * 0.06
    points.push(lerp(sample, { x: cx, y: cy }, inwardPull))
  }

  return points
}

function buildPrimalGraph(
  points: Point[],
  targetCrossings: number,
  expectedHull: number,
): { edges: PrimalEdge[]; faces: Face[] } | null {
  const delaunay = Delaunay.from(
    points,
    (p) => p.x,
    (p) => p.y,
  )

  const hull = Array.from(delaunay.hull)
  if (hull.length !== expectedHull) {
    return null
  }

  const edges: PrimalEdge[] = []
  const edgeMap = new Map<string, number>()

  const edgeId = (u: number, v: number): number => {
    const key = edgeKey(u, v)
    const existing = edgeMap.get(key)
    if (existing !== undefined) {
      return existing
    }
    const id = edges.length
    edges.push({
      u: Math.min(u, v),
      v: Math.max(u, v),
    })
    edgeMap.set(key, id)
    return id
  }

  const faces: Face[] = []
  const tris = delaunay.triangles
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i] as number
    const b = tris[i + 1] as number
    const c = tris[i + 2] as number

    faces.push({
      vertices: [a, b, c],
      edges: [edgeId(a, b), edgeId(b, c), edgeId(c, a)],
    })
  }

  const outerEdges: number[] = []
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i] as number
    const b = hull[(i + 1) % hull.length] as number
    outerEdges.push(edgeId(a, b))
  }
  faces.push({ vertices: hull, edges: outerEdges })

  if (edges.length !== targetCrossings) {
    return null
  }

  return { edges, faces }
}

interface ArcGuideSample {
  u: number
  v: number
  t: number
}

function clampInsideEllipse(point: Point, cx: number, cy: number, rx: number, ry: number): Point {
  const dx = point.x - cx
  const dy = point.y - cy
  const norm = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)
  if (norm <= 1) {
    return point
  }
  const factor = 1 / Math.sqrt(norm)
  return {
    x: cx + dx * factor,
    y: cy + dy * factor,
  }
}

function relaxWithArcGuideNodes(
  pointsInput: Point[],
  edges: PrimalEdge[],
  hullVertices: number,
  width: number,
  height: number,
  padding: number,
): Point[] {
  if (pointsInput.length <= hullVertices + 1 || edges.length === 0) {
    return pointsInput
  }

  const points = pointsInput.map((point) => ({ ...point }))
  const count = points.length
  const cx = width * 0.5
  const cy = height * 0.5
  const rx = Math.max(14, width * 0.5 - padding - 4)
  const ry = Math.max(14, height * 0.5 - padding - 4)

  const samplesPerEdge = 2
  const sampleEdgeBudget = count <= 260 ? edges.length : 220
  const edgeStride = Math.max(1, Math.ceil(edges.length / sampleEdgeBudget))
  const samples: ArcGuideSample[] = []
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += edgeStride) {
    const edge = edges[edgeIndex] as PrimalEdge
    for (let i = 1; i <= samplesPerEdge; i += 1) {
      samples.push({
        u: edge.u,
        v: edge.v,
        t: i / (samplesPerEdge + 1),
      })
    }
  }

  const ghostPoints: Point[] = Array.from({ length: samples.length }, () => ({ x: 0, y: 0 }))
  const forces: Point[] = Array.from({ length: count }, () => ({ x: 0, y: 0 }))
  const velocities: Point[] = Array.from({ length: count }, () => ({ x: 0, y: 0 }))

  const meanEdgeLength =
    edges.reduce((sum, edge) => sum + length(sub(points[edge.u] as Point, points[edge.v] as Point)), 0) / edges.length
  const targetEdgeLength = Math.max(6, meanEdgeLength)

  const drawableArea = Math.max(1, (width - padding * 2) * (height - padding * 2))
  const spacing = Math.sqrt(drawableArea / Math.max(1, count + samples.length * 0.85))

  const springK = 0.0065
  const repulseVV = spacing * spacing * 0.018
  const repulseVG = spacing * spacing * 0.046
  const repulseGG = spacing * spacing * 0.07
  const centerK = 0.0012
  const boundaryK = 0.11
  const ghostReaction = 0.72
  const softness = 36
  const runVertexRepulsion = count <= 420
  const runGhostGhost = samples.length <= 560
  const iterations = count <= 220 ? 24 : count <= 600 ? 14 : 9

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let i = 0; i < count; i += 1) {
      forces[i].x = 0
      forces[i].y = 0
    }

    for (const edge of edges) {
      const u = edge.u
      const v = edge.v
      const delta = sub(points[v] as Point, points[u] as Point)
      const dist = Math.max(1e-6, length(delta))
      const dir = scale(delta, 1 / dist)
      const mag = (dist - targetEdgeLength) * springK
      const fx = dir.x * mag
      const fy = dir.y * mag
      forces[u].x += fx
      forces[u].y += fy
      forces[v].x -= fx
      forces[v].y -= fy
    }

    if (runVertexRepulsion) {
      for (let i = 0; i < count; i += 1) {
        for (let j = i + 1; j < count; j += 1) {
          const dx = points[i].x - points[j].x
          const dy = points[i].y - points[j].y
          const distSq = dx * dx + dy * dy + softness
          const invDist = 1 / Math.sqrt(distSq)
          const mag = repulseVV / distSq
          const fx = dx * invDist * mag
          const fy = dy * invDist * mag
          forces[i].x += fx
          forces[i].y += fy
          forces[j].x -= fx
          forces[j].y -= fy
        }
      }
    }

    for (let i = 0; i < samples.length; i += 1) {
      const sample = samples[i] as ArcGuideSample
      ghostPoints[i] = lerp(points[sample.u] as Point, points[sample.v] as Point, sample.t)
    }

    for (let vertex = 0; vertex < count; vertex += 1) {
      for (let i = 0; i < samples.length; i += 1) {
        const sample = samples[i] as ArcGuideSample
        if (vertex === sample.u || vertex === sample.v) {
          continue
        }

        const dx = points[vertex].x - ghostPoints[i].x
        const dy = points[vertex].y - ghostPoints[i].y
        const distSq = dx * dx + dy * dy + softness
        const invDist = 1 / Math.sqrt(distSq)
        const mag = repulseVG / distSq
        const fx = dx * invDist * mag
        const fy = dy * invDist * mag

        forces[vertex].x += fx
        forces[vertex].y += fy

        const backFx = -fx * ghostReaction
        const backFy = -fy * ghostReaction
        const uWeight = 1 - sample.t
        const vWeight = sample.t
        forces[sample.u].x += backFx * uWeight
        forces[sample.u].y += backFy * uWeight
        forces[sample.v].x += backFx * vWeight
        forces[sample.v].y += backFy * vWeight
      }
    }

    if (runGhostGhost) {
      for (let i = 0; i < samples.length; i += 1) {
        const left = samples[i] as ArcGuideSample
        for (let j = i + 1; j < samples.length; j += 1) {
          const right = samples[j] as ArcGuideSample
          if (
            (left.u === right.u && left.v === right.v) ||
            (left.u === right.v && left.v === right.u)
          ) {
            continue
          }

          const dx = ghostPoints[i].x - ghostPoints[j].x
          const dy = ghostPoints[i].y - ghostPoints[j].y
          const distSq = dx * dx + dy * dy + softness
          const invDist = 1 / Math.sqrt(distSq)
          const mag = repulseGG / distSq
          const fx = dx * invDist * mag
          const fy = dy * invDist * mag

          forces[left.u].x += fx * (1 - left.t)
          forces[left.u].y += fy * (1 - left.t)
          forces[left.v].x += fx * left.t
          forces[left.v].y += fy * left.t

          forces[right.u].x -= fx * (1 - right.t)
          forces[right.u].y -= fy * (1 - right.t)
          forces[right.v].x -= fx * right.t
          forces[right.v].y -= fy * right.t
        }
      }
    }

    for (let i = hullVertices; i < count; i += 1) {
      const towardCenter = sub({ x: cx, y: cy }, points[i] as Point)
      forces[i].x += towardCenter.x * centerK
      forces[i].y += towardCenter.y * centerK

      const dx = points[i].x - cx
      const dy = points[i].y - cy
      const radial = Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry))
      if (radial > 0.95) {
        const inward = (radial - 0.95) * boundaryK
        forces[i].x -= dx * inward
        forces[i].y -= dy * inward
      }
    }

    for (let i = hullVertices; i < count; i += 1) {
      velocities[i].x = velocities[i].x * 0.78 + forces[i].x * 0.68
      velocities[i].y = velocities[i].y * 0.78 + forces[i].y * 0.68

      const maxStep = Math.max(2.3, spacing * 0.065)
      const speed = Math.hypot(velocities[i].x, velocities[i].y)
      if (speed > maxStep) {
        const scaleStep = maxStep / speed
        velocities[i].x *= scaleStep
        velocities[i].y *= scaleStep
      }

      const moved = {
        x: points[i].x + velocities[i].x,
        y: points[i].y + velocities[i].y,
      }
      points[i] = clampInsideEllipse(moved, cx, cy, rx, ry)
    }
  }

  return points
}

function smoothEdgeCurve(
  start: Point,
  end: Point,
  guide: Point,
  startOutDir: Point,
  endOutDir: Point,
  crossingRadius: number,
): CubicCurve {
  const chord = sub(end, start)
  const chordLength = Math.max(1e-6, length(chord))

  const startDir = normalize(startOutDir)
  const endDir = normalize(endOutDir)

  const minHandle = Math.max(1.2, crossingRadius * 0.38)
  const maxHandle = Math.max(minHandle, Math.min(chordLength * 0.49, crossingRadius * 3.1))

  const guideProjectionStart = Math.max(0.05, dot(sub(guide, start), startDir))
  const guideProjectionEnd = Math.max(0.05, dot(sub(guide, end), endDir))
  const guideDistanceFromChord =
    Math.abs(chord.x * (guide.y - start.y) - chord.y * (guide.x - start.x)) / chordLength

  const chordBlend = chordLength * 0.32 + guideDistanceFromChord * 0.24
  const startReach = Math.max(0, dot(chord, startDir))
  const endReach = Math.max(0, dot(scale(chord, -1), endDir))

  const startHandleLength = clamp(
    Math.max(chordBlend * 0.58, guideProjectionStart * 0.7, startReach * 0.28),
    minHandle,
    maxHandle,
  )
  const endHandleLength = clamp(
    Math.max(chordBlend * 0.58, guideProjectionEnd * 0.7, endReach * 0.28),
    minHandle,
    maxHandle,
  )

  return {
    p0: start,
    p1: add(start, scale(startDir, startHandleLength)),
    p2: add(end, scale(endDir, endHandleLength)),
    p3: end,
  }
}

function smoothOverpassCurve(
  start: Point,
  end: Point,
  center: Point,
  startTangent: Point,
  endTangent: Point,
  crossingRadius: number,
): CubicCurve {
  const chord = sub(end, start)
  const chordLength = Math.max(1e-6, length(chord))

  const startDir = normalize(startTangent)
  const endDir = normalize(endTangent)

  const minHandle = Math.max(1.15, crossingRadius * 0.42)
  const maxHandle = Math.max(minHandle, Math.min(chordLength * 0.46, crossingRadius * 2.2))
  const centerReach = Math.abs(dot(sub(center, start), startDir)) + Math.abs(dot(sub(center, end), endDir))
  const chordReach = chordLength * 0.34
  const targetHandle = Math.max(crossingRadius * 0.56, Math.min(chordReach, centerReach * 0.31))
  const startHandleLength = clamp(targetHandle, minHandle, maxHandle)
  const endHandleLength = clamp(targetHandle, minHandle, maxHandle)

  return {
    p0: start,
    p1: add(start, scale(startDir, startHandleLength)),
    p2: sub(end, scale(endDir, endHandleLength)),
    p3: end,
  }
}

function buildComponentMap(
  medialEdges: MedialEdge[],
  sortedStubsByCrossing: IncidentStub[][],
): { count: number; halfIdToComponent: Int32Array } {
  const halfEdgeCount = medialEdges.length * 2
  const dsu = new UnionFind(halfEdgeCount)

  for (let i = 0; i < medialEdges.length; i += 1) {
    dsu.union(i * 2, i * 2 + 1)
  }

  for (let i = 0; i < sortedStubsByCrossing.length; i += 1) {
    const stubs = sortedStubsByCrossing[i]
    if (stubs.length !== 4) {
      continue
    }
    dsu.union(stubs[0].halfId, stubs[2].halfId)
    dsu.union(stubs[1].halfId, stubs[3].halfId)
  }

  const rootToComponent = new Map<number, number>()
  const halfIdToComponent = new Int32Array(halfEdgeCount)
  for (let i = 0; i < halfEdgeCount; i += 1) {
    const root = dsu.find(i)
    let componentId = rootToComponent.get(root)
    if (componentId === undefined) {
      componentId = rootToComponent.size
      rootToComponent.set(root, componentId)
    }
    halfIdToComponent[i] = componentId
  }

  return { count: rootToComponent.size, halfIdToComponent }
}

export function generateDiagram(options: GenerateOptions): Diagram {
  const width = options.width ?? 1280
  const height = options.height ?? 920
  const padding = options.padding ?? 56
  const cornerInset = clamp(options.cornerInset ?? 0.2, 0.04, 0.9)
  const strokeWidth = clamp(options.strokeWidth ?? 2.8, 1, 20)
  const crossingGapScale = clamp(options.crossingGapScale ?? 1.25, 0.6, 3.4)
  const useArcGuideLayout = options.useArcGuideLayout ?? false
  const haloClearance = clamp(strokeWidth * 0.11 + cornerInset * 0.28 + 0.36, 0.7, 3.8) * crossingGapScale
  const haloWidth = strokeWidth + 2 * haloClearance
  const viewportCenter = { x: width * 0.5, y: height * 0.5 }

  const normalized = normalizeRequestedCrossings(options.crossings)
  const maxAttempts =
    options.maxAttempts ??
    Math.round(44 + Math.sqrt(normalized.target) * 4.5 + Math.max(0, strokeWidth - 6) * 7)
  const { primalVertices, hullVertices } = choosePrimalSize(normalized.target)

  const baseSeed = hashSeed(options.seed)
  let bestDiagram: Diagram | null = null
  let bestQuality = Number.POSITIVE_INFINITY

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const attemptSeed = (baseSeed + Math.imul(attempt + 1, GOLDEN_GAMMA)) >>> 0
    const rng = mulberry32(attemptSeed)
    const rawPoints = generatePoints(primalVertices, hullVertices, width, height, padding, rng)
    let points = rawPoints
    let primal = buildPrimalGraph(points, normalized.target, hullVertices)

    if (!primal) {
      continue
    }

    if (useArcGuideLayout) {
      const relaxedPoints = relaxWithArcGuideNodes(points, primal.edges, hullVertices, width, height, padding)
      const relaxedPrimal = buildPrimalGraph(relaxedPoints, normalized.target, hullVertices)
      if (relaxedPrimal) {
        points = relaxedPoints
        primal = relaxedPrimal
      }
    }

    const crossingPositions = primal.edges.map((edge) => ({
      x: (points[edge.u].x + points[edge.v].x) * 0.5,
      y: (points[edge.u].y + points[edge.v].y) * 0.5,
    }))

    const medialEdges: MedialEdge[] = []
    const incidentByCrossing: IncidentStub[][] = Array.from({ length: crossingPositions.length }, () => [])

    for (const face of primal.faces) {
      const centroid = face.vertices.reduce(
        (acc, vi) => {
          acc.x += points[vi].x
          acc.y += points[vi].y
          return acc
        },
        { x: 0, y: 0 },
      )
      centroid.x /= face.vertices.length
      centroid.y /= face.vertices.length

      const k = face.edges.length
      const isOuterFace = k > 3
      for (let i = 0; i < k; i += 1) {
        const a = face.edges[i] as number
        const b = face.edges[(i + 1) % k] as number
        const cornerVertex = face.vertices[(i + 1) % k] as number
        const control = isOuterFace
          ? outerFaceControl(
              points[face.vertices[i] as number] as Point,
              points[cornerVertex] as Point,
              points[face.vertices[(i + 2) % k] as number] as Point,
              viewportCenter,
              cornerInset,
              padding,
            )
          : lerp(points[cornerVertex] as Point, centroid, cornerInset)

        const edgeIndex = medialEdges.length
        medialEdges.push({ a, b, control })

        incidentByCrossing[a].push({ halfId: edgeIndex * 2, control, outer: isOuterFace })
        incidentByCrossing[b].push({ halfId: edgeIndex * 2 + 1, control, outer: isOuterFace })
      }
    }

    if (incidentByCrossing.some((stubs) => stubs.length !== 4)) {
      continue
    }

    let armLengthSum = 0
    const minArmByCrossing = new Float64Array(incidentByCrossing.length)
    for (let i = 0; i < incidentByCrossing.length; i += 1) {
      const center = crossingPositions[i] as Point
      const stubs = incidentByCrossing[i] as IncidentStub[]
      let minArm = Number.POSITIVE_INFINITY
      for (let j = 0; j < stubs.length; j += 1) {
        const arm = length(sub(stubs[j].control, center))
        armLengthSum += arm
        if (arm < minArm) {
          minArm = arm
        }
      }
      minArmByCrossing[i] = Number.isFinite(minArm) ? minArm : 1
    }

    const averageArmLength = armLengthSum / (incidentByCrossing.length * 4)
    const densityScale = Math.sqrt((width * height) / crossingPositions.length)
    const desiredTrim = strokeWidth * (0.58 + cornerInset * 0.16) + 0.7
    const geometricRadius = Math.min(averageArmLength * 0.34, densityScale * 0.18)
    const radiusTarget = Math.min(geometricRadius, desiredTrim + strokeWidth * 0.42 + 1.9)
    const radiusCapByStroke = desiredTrim + strokeWidth * 0.78 + 4.5
    const radiusCapByGeometry = Math.min(averageArmLength * 0.52, densityScale * 0.3)
    const radiusCap = Math.max(desiredTrim + 0.45, Math.min(radiusCapByGeometry, radiusCapByStroke))
    const nominalRadius = clamp(radiusTarget, desiredTrim, radiusCap)

    type DecoratedStub = IncidentStub & { dir: Point; angle: number; point: Point }
    const sortedStubsByCrossing: DecoratedStub[][] = Array.from({ length: crossingPositions.length }, () => [])
    const halfEdgePoints: Point[] = Array.from({ length: medialEdges.length * 2 }, () => ({ x: 0, y: 0 }))
    const halfEdgeOutDirs: Point[] = Array.from({ length: medialEdges.length * 2 }, () => ({ x: 1, y: 0 }))
    let trimSum = 0
    let radiusDeficitPenalty = 0
    let severeRadiusDeficits = 0

    for (let i = 0; i < crossingPositions.length; i += 1) {
      const center = crossingPositions[i] as Point
      const safeRadius = Math.min(nominalRadius, Math.max(0.55, minArmByCrossing[i] * 0.8))
      const sorted = incidentByCrossing[i]
        .map((stub) => {
          const rawDir = normalize(sub(stub.control, center))
          return {
            ...stub,
            rawDir,
            controlAngle: Math.atan2(stub.control.y - center.y, stub.control.x - center.x),
          }
        })
        .sort((left, right) => left.controlAngle - right.controlAngle)

      if (sorted.length !== 4) {
        continue
      }

      let sinSum = 0
      let cosSum = 0
      for (let j = 0; j < 4; j += 1) {
        const phase = sorted[j].controlAngle - j * (Math.PI * 0.5)
        sinSum += Math.sin(phase)
        cosSum += Math.cos(phase)
      }

      const baseRotation = Math.atan2(sinSum, cosSum)
      let maxBlendedTrim = Number.POSITIVE_INFINITY
      const interiorBlend = clamp(0.16 + cornerInset * 0.5, 0.14, 0.45)
      const blendedDirs: Point[] = []
      for (let j = 0; j < 4; j += 1) {
        const theta = baseRotation + j * (Math.PI * 0.5)
        let idealDir = { x: Math.cos(theta), y: Math.sin(theta) }
        const rawDir = sorted[j].rawDir as Point
        if (dot(rawDir, idealDir) < 0) {
          idealDir = scale(idealDir, -1)
        }

        const outerBlend = clamp(0.06 + (1 - cornerInset) * 0.22, 0.05, 0.28)
        const blend = sorted[j].outer ? outerBlend : interiorBlend
        const dir = normalize(add(scale(rawDir, 1 - blend), scale(idealDir, blend)))
        blendedDirs.push(dir)

        const support = dot(sub(sorted[j].control, center), dir)
        maxBlendedTrim = Math.min(maxBlendedTrim, support * 0.8)
      }

      const blendedRadius = Math.max(0.8, Math.min(safeRadius, maxBlendedTrim))
      if (blendedRadius < desiredTrim) {
        const deficit = (desiredTrim - blendedRadius) / desiredTrim
        radiusDeficitPenalty += deficit * deficit * 4.6
      }
      if (blendedRadius < desiredTrim * 0.94) {
        severeRadiusDeficits += 1
      }

      const decorated: DecoratedStub[] = []
      for (let j = 0; j < 4; j += 1) {
        const dir = blendedDirs[j] as Point
        const point = add(center, scale(dir, blendedRadius))
        const halfId = (sorted[j] as IncidentStub).halfId
        halfEdgePoints[halfId] = point
        halfEdgeOutDirs[halfId] = dir
        trimSum += blendedRadius

        decorated.push({
          halfId: (sorted[j] as IncidentStub).halfId,
          control: (sorted[j] as IncidentStub).control,
          outer: (sorted[j] as IncidentStub).outer,
          dir,
          angle: Math.atan2(dir.y, dir.x),
          point,
        })
      }

      decorated.sort((left, right) => left.angle - right.angle)
      sortedStubsByCrossing[i] = decorated
    }

    const crossingRadius = trimSum > 0 ? trimSum / (medialEdges.length * 2) : nominalRadius
    if (severeRadiusDeficits > 0) {
      continue
    }

    const desiredAdjacentGap = strokeWidth * 0.9 + 3
    let anglePenalty = 0
    let gapPenalty = 0
    let minCrossingAngle = Math.PI * 0.5

    for (let i = 0; i < crossingPositions.length; i += 1) {
      const sorted = sortedStubsByCrossing[i]
      if (!sorted || sorted.length !== 4) {
        continue
      }

      const strandA = normalize(sub(sorted[2].point, sorted[0].point))
      const strandB = normalize(sub(sorted[3].point, sorted[1].point))
      const strandDot = Math.abs(dot(strandA, strandB))
      const angle = Math.acos(clamp(strandDot, 0, 1))
      minCrossingAngle = Math.min(minCrossingAngle, angle)
      anglePenalty += strandDot * strandDot

      for (let j = 0; j < 4; j += 1) {
        const current = sorted[j] as DecoratedStub
        const next = sorted[(j + 1) % 4] as DecoratedStub
        let gap = next.angle - current.angle
        if (gap <= 0) {
          gap += TAU
        }

        const normalizedGap = gap / (Math.PI * 0.5)
        anglePenalty += Math.abs(normalizedGap - 1) * 0.34

        const adjacentDistance = length(sub(next.point, current.point))
        if (adjacentDistance < desiredAdjacentGap) {
          const gapDeficit = (desiredAdjacentGap - adjacentDistance) / desiredAdjacentGap
          gapPenalty += gapDeficit * gapDeficit * (0.95 + strokeWidth * 0.04)
        }
      }
    }

    const strokePressure = 1 + Math.max(0, strokeWidth - 4) * 0.14
    const qualityScore =
      (anglePenalty + gapPenalty * (1.8 * strokePressure) + radiusDeficitPenalty * (1.35 * strokePressure)) /
      Math.max(1, crossingPositions.length)
    const minCrossingAngleDeg = (minCrossingAngle * 180) / Math.PI

    const baseCurves: RenderCurve[] = []
    for (let i = 0; i < medialEdges.length; i += 1) {
      const edge = medialEdges[i] as MedialEdge
      const start = halfEdgePoints[i * 2]
      const end = halfEdgePoints[i * 2 + 1]

      if (!start || !end) {
        continue
      }

      if (length(sub(end, start)) < 1e-3) {
        continue
      }

      const startOutDir = halfEdgeOutDirs[i * 2]
      const endOutDir = halfEdgeOutDirs[i * 2 + 1]

      if (!startOutDir || !endOutDir) {
        continue
      }

      const curve = smoothEdgeCurve(start, end, edge.control, startOutDir, endOutDir, crossingRadius)
      baseCurves.push({
        curve,
        path: curveToPath(curve),
        startHalfId: i * 2,
        endHalfId: i * 2 + 1,
      })
    }

    const underBridgeCurves: RenderCurve[] = []
    const overCurves: RenderCurve[] = []
    for (let i = 0; i < crossingPositions.length; i += 1) {
      const center = crossingPositions[i] as Point
      const sorted = sortedStubsByCrossing[i]
      if (!sorted || sorted.length !== 4) {
        continue
      }

      const overPair = rng() < 0.5 ? 0 : 1
      const underPair = overPair === 0 ? 1 : 0
      const overStart = sorted[overPair] as DecoratedStub
      const overEnd = sorted[overPair + 2] as DecoratedStub
      const overStartTangent = scale(overStart.dir, -1)
      const overEndTangent = overEnd.dir
      const curve = smoothOverpassCurve(overStart.point, overEnd.point, center, overStartTangent, overEndTangent, crossingRadius)
      const overPath = curveToPath(curve)
      overCurves.push({
        curve,
        path: overPath,
        startHalfId: overStart.halfId,
        endHalfId: overEnd.halfId,
      })

      const underStart = sorted[underPair] as DecoratedStub
      const underEnd = sorted[underPair + 2] as DecoratedStub
      const underStartTangent = scale(underStart.dir, -1)
      const underEndTangent = underEnd.dir
      const underCurve = smoothOverpassCurve(
        underStart.point,
        underEnd.point,
        center,
        underStartTangent,
        underEndTangent,
        crossingRadius,
      )
      underBridgeCurves.push({
        curve: underCurve,
        path: curveToPath(underCurve),
        startHalfId: underStart.halfId,
        endHalfId: underEnd.halfId,
      })
    }

    const underCurves = [...baseCurves, ...underBridgeCurves]
    const allCurves = [...baseCurves, ...overCurves]
    if (hasUnwantedIntersections(allCurves, strokeWidth)) {
      continue
    }

    const componentMap = buildComponentMap(medialEdges, sortedStubsByCrossing)
    const components = componentMap.count
    const basePathComponents = underCurves.map((segment) => componentMap.halfIdToComponent[segment.startHalfId] ?? 0)
    const overPathComponents = overCurves.map((segment) => componentMap.halfIdToComponent[segment.startHalfId] ?? 0)
    const candidate: Diagram = {
      width,
      height,
      requestedCrossings: Math.round(options.crossings),
      crossings: crossingPositions.length,
      components,
      seed: attemptSeed,
      strokeWidth,
      haloWidth,
      basePaths: underCurves.map((segment) => segment.path),
      basePathComponents,
      overPaths: overCurves.map((segment) => segment.path),
      overPathComponents,
      crossingRadius,
      minCrossingAngleDeg,
      qualityScore,
      attempts: attempt + 1,
      primalVertices,
      hullVertices,
      warning: normalized.warning,
    }
    if (qualityScore < bestQuality) {
      bestQuality = qualityScore
      bestDiagram = candidate
    }

    const qualityThreshold = 0.58 + Math.max(0, strokeWidth - 10) * 0.004
    const minAngleThreshold = 50 + Math.max(0, strokeWidth - 8) * 0.2
    if (attempt >= 5 && qualityScore <= qualityThreshold && minCrossingAngleDeg >= minAngleThreshold) {
      break
    }
  }

  if (bestDiagram) {
    return bestDiagram
  }

  if (useArcGuideLayout) {
    const fallback = generateDiagram({
      ...options,
      useArcGuideLayout: false,
      maxAttempts,
    })
    const fallbackWarning = 'Arc guide node layout failed for this seed; using standard layout.'
    fallback.warning = fallback.warning ? `${fallback.warning} ${fallbackWarning}` : fallbackWarning
    return fallback
  }

  throw new Error('Failed to generate a valid 4-regular planar graph after multiple attempts. Try a different seed.')
}

export function diagramToSvg(diagram: Diagram, options: SvgOptions = {}): string {
  const strokeWidth = options.strokeWidth ?? diagram.strokeWidth
  const strokeScale = strokeWidth / Math.max(1e-6, diagram.strokeWidth)
  const haloWidth = strokeWidth + (diagram.haloWidth - diagram.strokeWidth) * strokeScale
  const strokeColor = options.strokeColor ?? '#1b1f26'
  const backgroundColor = options.backgroundColor ?? '#f4efe3'
  const colorByComponent = options.colorByComponent ?? false
  const componentPalette = options.componentPalette

  const baseStroke = (index: number): string =>
    colorByComponent ? colorForComponent(diagram.basePathComponents[index] ?? 0, componentPalette) : strokeColor
  const overStroke = (index: number): string =>
    colorByComponent ? colorForComponent(diagram.overPathComponents[index] ?? 0, componentPalette) : strokeColor

  const underMaskGroup = diagram.basePaths
    .map(
      (d) =>
        `<path d="${d}" fill="none" stroke="${backgroundColor}" stroke-width="${formatNum(haloWidth)}" stroke-linecap="butt" stroke-linejoin="round"/>`,
    )
    .join('')

  const baseGroup = diagram.basePaths
    .map(
      (d, i) =>
        `<path d="${d}" fill="none" stroke="${baseStroke(i)}" stroke-width="${formatNum(strokeWidth)}" stroke-linecap="square" stroke-linejoin="round"/>`,
    )
    .join('')

  const overGroup = diagram.overPaths
    .map(
      (d, i) =>
        `<path d="${d}" fill="none" stroke="${overStroke(i)}" stroke-width="${formatNum(strokeWidth)}" stroke-linecap="square" stroke-linejoin="round"/>`,
    )
    .join('')

  const overMaskGroup = diagram.overPaths
    .map(
      (d) =>
        `<path d="${d}" fill="none" stroke="${backgroundColor}" stroke-width="${formatNum(haloWidth)}" stroke-linecap="butt" stroke-linejoin="round"/>`,
    )
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${formatNum(diagram.width)} ${formatNum(diagram.height)}" width="${formatNum(diagram.width)}" height="${formatNum(diagram.height)}">\n  <rect width="100%" height="100%" fill="${backgroundColor}"/>\n  <g id="knot-under-pre">${baseGroup}</g>\n  <g id="knot-under-mask">${underMaskGroup}</g>\n  <g id="knot-under">${baseGroup}</g>\n  <g id="knot-over-mask">${overMaskGroup}</g>\n  <g id="knot-over">${overGroup}</g>\n</svg>`
}
