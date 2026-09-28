import { create } from 'zustand'
import type { BeeColony, DropPoint, RouteTrip, TransitRoute } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'
import { distanceKm, estimateDurationH } from '@/utils/geo'
import { planLoads, toRouteTrips } from '@/utils/loading'
import { colonyStore } from './colonyStore'

export interface RouteState {
  rows: TransitRoute[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: TransitRoute) => Promise<void>
  remove: (id: string) => Promise<void>
  /** 按选点顺序重排并重算里程 / 耗时，生成连续转场段 */
  rebuildFromOrder: (
    orderedDropIds: string[],
    meta: { vehicleType: TransitRoute['vehicleType']; departAt: string; riskNote: string }
  ) => Promise<void>
  /** 按到达站已安排且待投放 / 回场的群号，生成（重新生成）本段装车清单 */
  generateLoads: (routeId: string) => Promise<void>
  /** 司机点发车：本车蜂群一起进入「转场中」，记下实际出发时间 */
  departTrip: (routeId: string, tripId: string, departedAt: string) => Promise<void>
  /** 到站确认：本车蜂群改为「在园」，同步所在地块，记下实际到达时间 */
  arriveTrip: (routeId: string, tripId: string, arrivedAt: string) => Promise<void>
}

/** 由车次执行进度回填路线段的实际记录文案 */
export function summarizeTrips(trips: RouteTrip[]): string {
  if (trips.length === 0) return '待执行'
  const arrived = trips.filter((trip) => trip.status === '已到站').length
  const moving = trips.filter((trip) => trip.status === '转场中').length
  const waiting = trips.filter((trip) => trip.status === '待发车').length
  const parts = [`共 ${trips.length} 车`, `已到站 ${arrived}`, `转场中 ${moving}`, `待发车 ${waiting}`]
  const last = [...trips]
    .reverse()
    .find((trip) => trip.actualArriveAt || trip.actualDepartAt)
  if (last?.actualArriveAt) parts.push(`最近到站 第${last.seq}车 ${last.actualArriveAt.replace('T', ' ')}`)
  else if (last?.actualDepartAt) parts.push(`最近发车 第${last.seq}车 ${last.actualDepartAt.replace('T', ' ')}`)
  return parts.join('，')
}

/** 历史路线数据补齐车次字段 */
function normalize(route: TransitRoute): TransitRoute {
  return Array.isArray(route.trips) ? route : { ...route, trips: [] }
}

export const routeStore = create<RouteState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const loaded = await loadAll<TransitRoute>(db.routes)
    const rows = loaded.map(normalize)
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
    const colonies = await loadAll<BeeColony>(db.colonies)
    const lookup = new Map(points.map((item) => [item.id, item]))
    for (let i = 1; i < orderedDropIds.length; i += 1) {
      const from = lookup.get(orderedDropIds[i - 1])
      const to = lookup.get(orderedDropIds[i])
      if (!from || !to) continue
      const km = distanceKm(from, to)
      const planned = planLoads(to.colonyCodes, colonies, meta.vehicleType)
      await putRow<TransitRoute>(db.routes, {
        id: `rt_${Date.now().toString(36)}_${i}`,
        fromDropId: from.id,
        toDropId: to.id,
        distanceKm: km,
        durationH: estimateDurationH(km),
        vehicleType: meta.vehicleType,
        departAt: meta.departAt,
        riskNote: meta.riskNote,
        actualNote: planned.trips.length > 0 ? '待执行' : '到达站无待装车群号',
        trips: toRouteTrips(planned.trips)
      })
    }
    await get().hydrate()
  },
  generateLoads: async (routeId) => {
    const route = (await loadAll<TransitRoute>(db.routes)).find((item) => item.id === routeId)
    if (!route) throw new Error('未找到该转场路线')
    if (normalize(route).trips.some((trip) => trip.status !== '待发车')) {
      throw new Error('已有车次发车或到站，不能重新生成装车清单')
    }
    const toPoint = await db.dropPoints.get(route.toDropId)
    if (!toPoint) throw new Error('未找到到达投放点')
    const colonies = await loadAll<BeeColony>(db.colonies)
    const planned = planLoads(toPoint.colonyCodes, colonies, route.vehicleType)
    const next: TransitRoute = {
      ...normalize(route),
      trips: toRouteTrips(planned.trips),
      actualNote: planned.trips.length > 0 ? '待执行' : '到达站无待装车群号'
    }
    await putRow<TransitRoute>(db.routes, next)
    await get().hydrate()
  },
  departTrip: async (routeId, tripId, departedAt) => {
    const routes = await loadAll<TransitRoute>(db.routes)
    const route = routes.find((item) => item.id === routeId)
    const trip = route?.trips.find((item) => item.id === tripId)
    if (!route || !trip) throw new Error('未找到该车次')
    if (trip.status !== '待发车') throw new Error(`第${trip.seq}车已发车，不能重复发车`)

    // 本车蜂群一起进入转场中
    const colonies = await loadAll<BeeColony>(db.colonies)
    const targets = colonies.filter((item) => trip.colonyCodes.includes(item.code))
    await Promise.all(targets.map((colony) => putRow<BeeColony>(db.colonies, { ...colony, status: '转场中' })))

    const nextTrips = route.trips.map((item) =>
      item.id === tripId ? { ...item, status: '转场中' as const, actualDepartAt: departedAt } : item
    )
    await putRow<TransitRoute>(db.routes, { ...route, trips: nextTrips, actualNote: summarizeTrips(nextTrips) })
    await get().hydrate()
    await colonyStore.getState().hydrate()
  },
  arriveTrip: async (routeId, tripId, arrivedAt) => {
    const routes = await loadAll<TransitRoute>(db.routes)
    const route = routes.find((item) => item.id === routeId)
    const trip = route?.trips.find((item) => item.id === tripId)
    if (!route || !trip) throw new Error('未找到该车次')
    if (trip.status === '待发车') throw new Error(`第${trip.seq}车尚未发车`)
    if (trip.status === '已到站') throw new Error(`第${trip.seq}车已到站，不能重复确认`)

    // 到站确认：改为在园并同步到达站所在地块
    const toPoint: DropPoint | undefined = await db.dropPoints.get(route.toDropId)
    const orchardId = toPoint?.orchardId ?? ''
    const colonies = await loadAll<BeeColony>(db.colonies)
    const targets = colonies.filter((item) => trip.colonyCodes.includes(item.code))
    await Promise.all(
      targets.map((colony) => putRow<BeeColony>(db.colonies, { ...colony, status: '在园', currentOrchardId: orchardId }))
    )

    const nextTrips = route.trips.map((item) =>
      item.id === tripId ? { ...item, status: '已到站' as const, actualArriveAt: arrivedAt } : item
    )
    await putRow<TransitRoute>(db.routes, { ...route, trips: nextTrips, actualNote: summarizeTrips(nextTrips) })
    await get().hydrate()
    await colonyStore.getState().hydrate()
  }
}))
