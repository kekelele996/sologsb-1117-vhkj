/** 车辆类型 */
export const VEHICLE_TYPES = ['厢式货车', '农用三轮', '皮卡', '人工搬运'] as const
export type VehicleType = (typeof VEHICLE_TYPES)[number]

/** 各车型单车载箱数：厢式货车 18、农用三轮 8、皮卡 6、人工搬运 2 */
export const VEHICLE_CAPACITY: Record<VehicleType, number> = {
  厢式货车: 18,
  农用三轮: 8,
  皮卡: 6,
  人工搬运: 2
}

/** 装车分组：交尾箱单独成组，标准继箱与平箱为标准箱组（交尾箱不与标准箱混装） */
export const LOAD_GROUPS = ['标准箱', '交尾箱'] as const
export type LoadGroup = (typeof LOAD_GROUPS)[number]

/** 车次执行状态 */
export const TRIP_STATUSES = ['待发车', '转场中', '已到站'] as const
export type TripStatus = (typeof TRIP_STATUSES)[number]

/** RouteTrip 一个车次（装车清单的最小单元） */
export interface RouteTrip {
  id: string
  /** 本路线段内的车次号，从 1 开始 */
  seq: number
  /** 车辆类型（生成清单时沿用车次段车辆） */
  vehicleType: VehicleType
  /** 实际装车箱型分组 */
  loadGroup: LoadGroup
  /** 本车额定装载箱数 */
  capacityBoxes: number
  /** 本车实际装载的群号 */
  colonyCodes: string[]
  status: TripStatus
  /** 实际出发时间（YYYY-MM-DDTHH:mm），司机点发车时记录 */
  actualDepartAt: string
  /** 实际到达时间（YYYY-MM-DDTHH:mm），到站确认时记录 */
  actualArriveAt: string
}

/** TransitRoute 转场路线（一段到达站对应一份装车清单） */
export interface TransitRoute {
  id: string
  /** 出发投放点 */
  fromDropId: string
  /** 到达投放点 */
  toDropId: string
  /** 预计里程（km） */
  distanceKm: number
  /** 预计耗时（小时） */
  durationH: number
  vehicleType: VehicleType
  /** 转场日期时刻 */
  departAt: string
  /** 途中风险备注 */
  riskNote: string
  /** 实际转场记录（按车次执行进度回填） */
  actualNote: string
  /** 装车清单：按到达站安排群号与车型容量拆分出的车次 */
  trips: RouteTrip[]
}
