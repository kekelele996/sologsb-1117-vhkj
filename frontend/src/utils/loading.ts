import type { BeeColony, BoxType, LoadGroup, RouteTrip, VehicleType } from '@/types'
import { VEHICLE_CAPACITY } from '@/types'
import { uid } from './id'

/** 装车分组判定：交尾箱单独一组，标准继箱 / 平箱归入标准箱组 */
export function loadGroupOf(boxType: BoxType): LoadGroup {
  return boxType === '交尾箱' ? '交尾箱' : '标准箱'
}

/** 可进入装车清单的蜂群状态：已在到达站安排，且仍待投放或回场（在园 / 转场中不再装车） */
export function isLoadable(status: BeeColony['status']): boolean {
  return status === '待投放' || status === '回场'
}

export interface PlannedTrip {
  vehicleType: VehicleType
  loadGroup: LoadGroup
  capacityBoxes: number
  colonyCodes: string[]
}

export interface PlannedLoad {
  /** 实际装车的车次（标准箱组在前、交尾箱组在后） */
  trips: PlannedTrip[]
  /** 已安排但不装车的群号及原因（如已在园 / 转场中） */
  skipped: { code: string; reason: string }[]
  /** 到达站安排了但台账里查无此群的群号 */
  missing: string[]
}

/**
 * 按到达站已安排的群号生成装车清单：
 * - 只装状态为「待投放 / 回场」的群，超载部分顺延到下一车；
 * - 交尾箱与标准箱（标准继箱 / 平箱）不混装，各自按车型容量分车；
 * - 车次顺序先标准箱组、后交尾箱组，组内沿用到达站群号的安排顺序。
 */
export function planLoads(
  arrangedCodes: string[],
  colonies: Pick<BeeColony, 'code' | 'status' | 'boxType'>[],
  vehicleType: VehicleType
): PlannedLoad {
  const capacity = VEHICLE_CAPACITY[vehicleType]
  const colonyByCode = new Map(colonies.map((item) => [item.code, item]))

  const groupCodes: Record<LoadGroup, string[]> = { 标准箱: [], 交尾箱: [] }
  const skipped: { code: string; reason: string }[] = []
  const missing: string[] = []

  arrangedCodes.forEach((code) => {
    const colony = colonyByCode.get(code)
    if (!colony) {
      missing.push(code)
      return
    }
    if (!isLoadable(colony.status)) {
      skipped.push({ code, reason: `已${colony.status}，无需装车` })
      return
    }
    groupCodes[loadGroupOf(colony.boxType)].push(code)
  })

  const trips: PlannedTrip[] = []
  ;(['标准箱', '交尾箱'] as LoadGroup[]).forEach((group) => {
    for (let i = 0; i < groupCodes[group].length; i += capacity) {
      trips.push({
        vehicleType,
        loadGroup: group,
        capacityBoxes: capacity,
        colonyCodes: groupCodes[group].slice(i, i + capacity)
      })
    }
  })

  return { trips, skipped, missing }
}

/** 把规划结果落成可持久化的车次（seq 从 1 开始连续编号） */
export function toRouteTrips(planned: PlannedTrip[]): RouteTrip[] {
  return planned.map((trip, index) => ({
    id: uid('trip'),
    seq: index + 1,
    vehicleType: trip.vehicleType,
    loadGroup: trip.loadGroup,
    capacityBoxes: trip.capacityBoxes,
    colonyCodes: trip.colonyCodes,
    status: '待发车',
    actualDepartAt: '',
    actualArriveAt: ''
  }))
}
