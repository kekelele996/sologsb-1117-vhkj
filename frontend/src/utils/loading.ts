import type { BeeColony, BoxType, DropPoint, RouteLoad, TransitRoute, VehicleType } from '@/types'
import { VEHICLE_CAPACITY } from '@/types'

/** 装车分组：交尾箱单独成组，标准继箱与平箱同组（交尾箱不与标准继箱混装） */
export type LoadKind = '交尾箱' | '标准继箱'

/** 交尾箱单独成车；平箱与标准继箱同车，二者都不会与交尾箱混装 */
export function boxLoadKind(boxType: BoxType): LoadKind {
  return boxType === '交尾箱' ? '交尾箱' : '标准继箱'
}

/** 本车可装箱型（取车上第一群；空车按全部箱型可装处理） */
export function loadKindOf(load: Pick<RouteLoad, 'colonyCodes'>, codeToBoxType: (code: string) => BoxType | undefined): LoadKind | null {
  if (load.colonyCodes.length === 0) return null
  for (const code of load.colonyCodes) {
    const boxType = codeToBoxType(code)
    if (boxType) return boxLoadKind(boxType)
  }
  return null
}

/**
 * 某段路线按到达站安排、且「待投放 / 回场」的蜂群才需要装车；
 * 已在园或转场中的群（如前序车次刚发走的）不再排入装车清单。
 */
export function legLoadCandidates(toPoint: DropPoint, colonies: BeeColony[]): BeeColony[] {
  const arranged = new Set(toPoint.colonyCodes)
  return colonies.filter((colony) => arranged.has(colony.code) && (colony.status === '待投放' || colony.status === '回场'))
}

/**
 * 按车型容量分车：先装标准继箱组（含平箱），再装交尾箱组；
 * 每组装满额定箱数后超载部分顺延下一车，两组之间绝不混装。
 */
export function buildLoads(candidates: BeeColony[], vehicleType: VehicleType): RouteLoad[] {
  const capacity = VEHICLE_CAPACITY[vehicleType]
  const groups: LoadKind[] = ['标准继箱', '交尾箱']
  const loads: RouteLoad[] = []
  let tripNo = 1
  groups.forEach((kind) => {
    const list = candidates.filter((colony) => boxLoadKind(colony.boxType) === kind)
    list.forEach((colony) => {
      let current = loads[loads.length - 1]
      // 换箱型或本车已满载 → 开下一车
      if (!current || loadKindOf(current, (code) => candidates.find((item) => item.code === code)?.boxType) !== kind || current.colonyCodes.length >= capacity) {
        current = { tripNo, colonyCodes: [], status: '待发车', actualDepartAt: '', actualArriveAt: '' }
        loads.push(current)
        tripNo += 1
      }
      current.colonyCodes.push(colony.code)
    })
  })
  return loads
}

/**
 * 重新生成一段路线的装车清单：
 * - 已发车（转场中）/ 已到站的车次锁定保留，避免冲掉执行中的记录；
 * - 仅重建待发停车次，并全局跳过已被其他待发停车次排走的群，避免同一群被排进两车。
 *
 * @returns 本段最新的车次列表
 */
export function regenerateRouteLoads(
  route: TransitRoute,
  toPoint: DropPoint,
  colonies: BeeColony[],
  allRoutes: TransitRoute[]
): RouteLoad[] {
  const locked = (route.loads ?? []).filter((load) => load.status !== '待发车')
  const busyCodes = new Set<string>()
  allRoutes.forEach((item) => {
    if (item.id === route.id) return
    ;(item.loads ?? []).forEach((load) => {
      if (load.status === '待发车' || load.status === '转场中') {
        load.colonyCodes.forEach((code) => busyCodes.add(code))
      }
    })
  })
  // 本段已锁定的群也不重复排车
  locked.forEach((load) => load.colonyCodes.forEach((code) => busyCodes.add(code)))

  const candidates = legLoadCandidates(toPoint, colonies).filter((colony) => !busyCodes.has(colony.code))
  const fresh = buildLoads(candidates, route.vehicleType)
  // 车次号接在已锁定车次之后，保证同一段路线内车次不重号
  const offset = locked.reduce((max, load) => Math.max(max, load.tripNo), 0)
  fresh.forEach((load, index) => {
    load.tripNo = offset + index + 1
  })
  return [...locked, ...fresh]
}

/** 按车次执行情况汇总实际记录文本（actualNote） */
export function summarizeActualNote(loads: RouteLoad[]): string {
  if (loads.length === 0) return '待执行'
  const lines = loads.map((load) => {
    if (load.status === '已到站') {
      return `第${load.tripNo}车 已到站：${load.actualDepartAt} 发车，${load.actualArriveAt} 到达`
    }
    if (load.status === '转场中') {
      return `第${load.tripNo}车 转场中：${load.actualDepartAt} 发车`
    }
    return `第${load.tripNo}车 待发车`
  })
  return lines.join('；')
}
