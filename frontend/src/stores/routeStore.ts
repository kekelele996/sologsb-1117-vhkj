import dayjs from 'dayjs'
import { create } from 'zustand'
import type { BeeColony, DropPoint, RouteLoad, TransitRoute } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'
import { distanceKm, estimateDurationH } from '@/utils/geo'
import { buildLoads, legLoadCandidates, regenerateRouteLoads, summarizeActualNote } from '@/utils/loading'

/** 实际时刻统一格式 */
function nowStamp(): string {
  return dayjs().format('YYYY-MM-DD HH:mm')
}

export interface RouteState {
  rows: TransitRoute[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: TransitRoute) => Promise<void>
  remove: (id: string) => Promise<void>
  /** 按选点顺序重排并重算里程 / 耗时，生成连续转场段（同步生成装车清单） */
  rebuildFromOrder: (
    orderedDropIds: string[],
    meta: { vehicleType: TransitRoute['vehicleType']; departAt: string; riskNote: string }
  ) => Promise<void>
  /** 按最新群号安排与状态，重建全部路线的待发装车清单（执行中 / 已到站的车次保留） */
  regenerateAllLoads: () => Promise<void>
  /** 重新生成单段路线的待发装车清单 */
  regenerateLoads: (routeId: string) => Promise<void>
  /** 司机点发车：本车蜂群一起进入转场中，记下实际出发 */
  departLoad: (routeId: string, tripNo: number) => Promise<void>
  /** 到站确认：本车蜂群记为在园，同步所在地块，记下实际到达 */
  arriveLoad: (routeId: string, tripNo: number) => Promise<void>
}

/** 写回路线并同步汇总实际记录 */
async function persistRoute(route: TransitRoute): Promise<void> {
  const next = { ...route, actualNote: summarizeActualNote(route.loads ?? []) }
  await putRow<TransitRoute>(db.routes, next)
}

/** 把一批群号的蜂群批量改状态 / 所在地块 */
async function bulkUpdateColonies(codes: string[], patch: Partial<Pick<BeeColony, 'status' | 'currentOrchardId'>>): Promise<void> {
  const all = await loadAll<BeeColony>(db.colonies)
  const targets = all.filter((colony) => codes.includes(colony.code))
  await Promise.all(targets.map((colony) => putRow<BeeColony>(db.colonies, { ...colony, ...patch })))
}

export const routeStore = create<RouteState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<TransitRoute>(db.routes)
    rows.sort((a, b) => a.departAt.localeCompare(b.departAt))
    set({ rows, loaded: true })
  },
  save: async (row) => {
    await putRow<TransitRoute>(db.routes, row)
    await get().hydrate()
  },
  remove: async (id) => {
    await deleteRow<TransitRoute>(db.routes, id)
    await get().hydrate()
  },
  rebuildFromOrder: async (orderedDropIds, meta) => {
    const existing = await loadAll<TransitRoute>(db.routes)
    await Promise.all(existing.map((row) => deleteRow<TransitRoute>(db.routes, row.id)))
    const points = await loadAll<DropPoint>(db.dropPoints)
    const lookup = new Map(points.map((item) => [item.id, item]))
    const colonies = await loadAll<BeeColony>(db.colonies)
    const busyCodes = new Set<string>()
    for (let i = 1; i < orderedDropIds.length; i += 1) {
      const from = lookup.get(orderedDropIds[i - 1])
      const to = lookup.get(orderedDropIds[i])
      if (!from || !to) continue
      const km = distanceKm(from, to)
      // 前序车次排走的群不再进入后段；只装到达站安排且待投放 / 回场的群
      const candidates = legLoadCandidates(to, colonies).filter((colony) => !busyCodes.has(colony.code))
      const loads = buildLoads(candidates, meta.vehicleType)
      loads.forEach((load) => load.colonyCodes.forEach((code) => busyCodes.add(code)))
      await putRow<TransitRoute>(db.routes, {
        id: `rt_${Date.now().toString(36)}_${i}`,
        fromDropId: from.id,
        toDropId: to.id,
        distanceKm: km,
        durationH: estimateDurationH(km),
        vehicleType: meta.vehicleType,
        departAt: meta.departAt,
        riskNote: meta.riskNote,
        actualNote: summarizeActualNote(loads),
        loads
      })
    }
    await get().hydrate()
  },
  regenerateAllLoads: async () => {
    const routes = [...(await loadAll<TransitRoute>(db.routes))].sort((a, b) => a.departAt.localeCompare(b.departAt))
    const points = await loadAll<DropPoint>(db.dropPoints)
    const colonies = await loadAll<BeeColony>(db.colonies)
    for (const route of routes) {
      const to = points.find((item) => item.id === route.toDropId)
      if (!to) continue
      const loads = regenerateRouteLoads(route, to, colonies, routes)
      const next = { ...route, loads }
      routes[routes.findIndex((item) => item.id === route.id)] = next
      await persistRoute(next)
    }
    await get().hydrate()
  },
  regenerateLoads: async (routeId) => {
    const routes = await loadAll<TransitRoute>(db.routes)
    const route = routes.find((item) => item.id === routeId)
    if (!route) return
    const points = await loadAll<DropPoint>(db.dropPoints)
    const to = points.find((item) => item.id === route.toDropId)
    if (!to) return
    const colonies = await loadAll<BeeColony>(db.colonies)
    await persistRoute({ ...route, loads: regenerateRouteLoads(route, to, colonies, routes) })
    await get().hydrate()
  },
  departLoad: async (routeId, tripNo) => {
    const route = (await loadAll<TransitRoute>(db.routes)).find((item) => item.id === routeId)
    if (!route) return
    const current = (route.loads ?? []).find((load) => load.tripNo === tripNo)
    if (!current || current.status !== '待发车') return
    const stamp = nowStamp()
    const loads: RouteLoad[] = (route.loads ?? []).map((load) =>
      load.tripNo === tripNo ? { ...load, status: '转场中', actualDepartAt: stamp } : load
    )
    // 本车蜂群一起进入转场中，并记下实际出发
    await bulkUpdateColonies(current.colonyCodes, { status: '转场中' })
    await persistRoute({ ...route, loads })
    await get().hydrate()
  },
  arriveLoad: async (routeId, tripNo) => {
    const route = (await loadAll<TransitRoute>(db.routes)).find((item) => item.id === routeId)
    if (!route) return
    const current = (route.loads ?? []).find((load) => load.tripNo === tripNo)
    if (!current || current.status !== '转场中') return
    const stamp = nowStamp()
    const loads: RouteLoad[] = (route.loads ?? []).map((load) =>
      load.tripNo === tripNo ? { ...load, status: '已到站', actualArriveAt: stamp } : load
    )
    const points = await loadAll<DropPoint>(db.dropPoints)
    const to = points.find((item) => item.id === route.toDropId)
    // 到站确认：记为在园，并同步所在地块
    await bulkUpdateColonies(current.colonyCodes, {
      status: '在园',
      currentOrchardId: to?.orchardId ?? ''
    })
    await persistRoute({ ...route, loads })
    await get().hydrate()
  }
}))
