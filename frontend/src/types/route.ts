/** 车辆类型 */
export const VEHICLE_TYPES = ['厢式货车', '农用三轮', '皮卡', '人工搬运'] as const
export type VehicleType = (typeof VEHICLE_TYPES)[number]

/** 各车型每车额定装箱数，超载部分顺延下一车 */
export const VEHICLE_CAPACITY: Record<VehicleType, number> = {
  厢式货车: 18,
  农用三轮: 8,
  皮卡: 6,
  人工搬运: 2
}

/** 车次执行状态 */
export const LOAD_STATUSES = ['待发车', '转场中', '已到站'] as const
export type LoadStatus = (typeof LOAD_STATUSES)[number]

/** RouteLoad 车次：同一段转场路线按车型容量拆分出的一车蜂群 */
export interface RouteLoad {
  /** 车次序号（本段路线内从 1 开始） */
  tripNo: number
  /** 本车装载的蜂群群号 */
  colonyCodes: string[]
  /** 车次状态：待发车 →（司机点发车）→ 转场中 →（到站确认）→ 已到站 */
  status: LoadStatus
  /** 实际出发时刻（发车时记录） */
  actualDepartAt: string
  /** 实际到达时刻（到站确认时记录） */
  actualArriveAt: string
}

/** TransitRoute 转场路线（一段：出发投放点 → 到达投放点） */
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
  /** 计划转场日期时刻 */
  departAt: string
  /** 途中风险备注 */
  riskNote: string
  /** 实际转场记录（按车次执行情况自动汇总） */
  actualNote: string
  /** 按到达站安排群号拆分的装车清单（车次） */
  loads: RouteLoad[]
}
