import { useMemo, useState } from 'react'
import { Button, Card, Empty, Popconfirm, Space, Table, Tag, Typography, message } from 'antd'
import dayjs from 'dayjs'
import type { BeeColony, DropPoint, RouteTrip, TransitRoute } from '@/types'
import { VEHICLE_CAPACITY } from '@/types'
import { planLoads } from '@/utils/loading'

const TRIP_TAG_COLOR = {
  待发车: 'default',
  转场中: 'gold',
  已到站: 'green'
} as const

const GROUP_TAG_COLOR = {
  标准箱: 'geekblue',
  交尾箱: 'purple'
} as const

export interface RouteLegCardProps {
  /** 段序号（从 1 开始，用于卡片编号） */
  legIndex: number
  route: TransitRoute
  fromPoint?: DropPoint
  toPoint?: DropPoint
  orchardName: (orchardId: string) => string
  colonies: BeeColony[]
  onGenerate: (routeId: string) => Promise<void>
  onDepart: (routeId: string, tripId: string, departedAt: string) => Promise<void>
  onArrive: (routeId: string, tripId: string, arrivedAt: string) => Promise<void>
  onRemove: (routeId: string) => Promise<void>
}

/** 路线卡片：一段路线的装车清单（车次 × 群号）与司机发车 / 到站确认操作 */
export default function RouteLegCard({
  legIndex,
  route,
  fromPoint,
  toPoint,
  orchardName,
  colonies,
  onGenerate,
  onDepart,
  onArrive,
  onRemove
}: RouteLegCardProps): JSX.Element {
  const [busy, setBusy] = useState(false)
  const capacity = VEHICLE_CAPACITY[route.vehicleType]

  /** 到达站已安排且当前待投放 / 回场的群（重新生成清单时会实际装这些群） */
  const planned = useMemo(
    () => planLoads(toPoint?.colonyCodes ?? [], colonies, route.vehicleType),
    [toPoint, colonies, route.vehicleType]
  )

  const arrangedCount = toPoint?.colonyCodes.length ?? 0
  const hasInFlightTrips = route.trips.some((trip) => trip.status !== '待发车')

  async function handleGenerate(): Promise<void> {
    if (hasInFlightTrips) {
      message.warning('已有车次发车或到站，不能重排；如需重排请删除本段后重新生成路线')
      return
    }
    setBusy(true)
    try {
      await onGenerate(route.id)
      message.success(`第 ${legIndex} 段装车清单已生成，共 ${planned.trips.length} 车`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '生成装车清单失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleDepart(trip: RouteTrip): Promise<void> {
    setBusy(true)
    try {
      await onDepart(route.id, trip.id, dayjs().format('YYYY-MM-DDTHH:mm'))
      message.success(`第${trip.seq}车已发车，${trip.colonyCodes.length} 群进入转场中`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '发车失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleArrive(trip: RouteTrip): Promise<void> {
    setBusy(true)
    try {
      await onArrive(route.id, trip.id, dayjs().format('YYYY-MM-DDTHH:mm'))
      message.success(`第${trip.seq}车已到站，${trip.colonyCodes.length} 群已在园`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '到站确认失败')
    } finally {
      setBusy(false)
    }
  }

  const title = (
    <Space wrap size={6}>
      <Tag color="gold">第 {legIndex} 段</Tag>
      <Typography.Text strong>
        {fromPoint ? `${fromPoint.code}（${orchardName(fromPoint.orchardId)}）` : '—'}
        {' → '}
        {toPoint ? `${toPoint.code}（${orchardName(toPoint.orchardId)}）` : '—'}
      </Typography.Text>
    </Space>
  )

  return (
    <Card
      size="small"
      title={title}
      extra={
        <Space>
          <Button size="small" loading={busy} onClick={() => void handleGenerate()}>
            {route.trips.length > 0 ? '重新生成清单' : '生成装车清单'}
          </Button>
          <Popconfirm title="删除该段路线及其装车清单？" onConfirm={() => void onRemove(route.id)}>
            <Button size="small" danger type="link">
              删除
            </Button>
          </Popconfirm>
        </Space>
      }
    >
      <Space wrap size={6} style={{ marginBottom: 10 }}>
        <Tag color="blue">{route.vehicleType} · 每车 {capacity} 箱</Tag>
        <Tag>{route.distanceKm} km / 约 {route.durationH} h</Tag>
        <Tag>计划出发 {route.departAt.replace('T', ' ')}</Tag>
        {route.riskNote ? <Tag color="red">风险：{route.riskNote}</Tag> : null}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          到达站安排 {arrangedCount} 群 · 待装 {planned.trips.reduce((sum, item) => sum + item.colonyCodes.length, 0)} 群 · 需{' '}
          {planned.trips.length} 车
        </Typography.Text>
      </Space>

      {route.trips.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            arrangedCount === 0
              ? '到达投放点尚未安排群号'
              : planned.trips.length === 0
                ? '到达站已安排群号均无待投放 / 回场群，暂不需要装车'
                : '尚未生成装车清单，点击右上角「生成装车清单」'
          }
        />
      ) : (
        <Table<RouteTrip>
          dataSource={route.trips}
          rowKey="id"
          size="small"
          pagination={false}
          columns={[
            {
              title: '车次',
              key: 'seq',
              width: 90,
              render: (_, trip) => <Typography.Text strong>第 {trip.seq} 车</Typography.Text>
            },
            {
              title: '箱型组',
              dataIndex: 'loadGroup',
              key: 'group',
              width: 100,
              render: (group: RouteTrip['loadGroup']) => (
                <Tag color={GROUP_TAG_COLOR[group]}>
                  {group}
                  {group === '交尾箱' ? '（不混装）' : ''}
                </Tag>
              )
            },
            {
              title: `装载群号（容量 ${capacity} 箱/车）`,
              key: 'codes',
              render: (_, trip) => (
                <Space wrap size={4}>
                  {trip.colonyCodes.map((code) => {
                    const colony = colonies.find((item) => item.code === code)
                    return (
                      <Tag key={code} color="cyan">
                        {code}
                        {colony ? `·${colony.boxType}` : ''}
                      </Tag>
                    )
                  })}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {trip.colonyCodes.length}/{trip.capacityBoxes} 箱
                  </Typography.Text>
                </Space>
              )
            },
            {
              title: '状态与实际时刻',
              key: 'status',
              width: 240,
              render: (_, trip) => (
                <Space direction="vertical" size={2}>
                  <Tag color={TRIP_TAG_COLOR[trip.status]}>{trip.status}</Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    实际出发：{trip.actualDepartAt ? trip.actualDepartAt.replace('T', ' ') : '—'}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    实际到达：{trip.actualArriveAt ? trip.actualArriveAt.replace('T', ' ') : '—'}
                  </Typography.Text>
                </Space>
              )
            },
            {
              title: '司机操作',
              key: 'action',
              width: 170,
              render: (_, trip) => (
                <Space direction="vertical" size={4}>
                  <Popconfirm
                    title={`确认第 ${trip.seq} 车发车？`}
                    description={`本车 ${trip.colonyCodes.length} 群将一起进入「转场中」`}
                    onConfirm={() => void handleDepart(trip)}
                    disabled={trip.status !== '待发车' || busy}
                  >
                    <Button size="small" type="primary" disabled={trip.status !== '待发车'} loading={busy}>
                      发车
                    </Button>
                  </Popconfirm>
                  <Popconfirm
                    title={`确认第 ${trip.seq} 车已到站？`}
                    description={`本车蜂群改为「在园」，所在地块同步为${toPoint ? orchardName(toPoint.orchardId) : '到达站'}`}
                    onConfirm={() => void handleArrive(trip)}
                    disabled={trip.status !== '转场中' || busy}
                  >
                    <Button size="small" disabled={trip.status !== '转场中'} loading={busy}>
                      到站确认
                    </Button>
                  </Popconfirm>
                </Space>
              )
            }
          ]}
        />
      )}

      {planned.skipped.length > 0 || planned.missing.length > 0 ? (
        <Space wrap size={6} style={{ marginTop: 10 }}>
          {planned.skipped.map((item) => (
            <Tag key={item.code} color="orange">
              {item.code} 不装车：{item.reason}
            </Tag>
          ))}
          {planned.missing.map((code) => (
            <Tag key={code} color="red">
              {code} 台账查无此群
            </Tag>
          ))}
        </Space>
      ) : null}

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
        装车规则：厢式货车 18 箱、农用三轮 8 箱、皮卡 6 箱、人工搬运 2 箱；交尾箱不与标准继箱 / 平箱混装，超载部分顺延下一车。实际记录：
        {route.actualNote}
      </Typography.Paragraph>
    </Card>
  )
}
