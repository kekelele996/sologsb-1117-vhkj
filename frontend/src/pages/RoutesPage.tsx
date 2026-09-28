import { useMemo, useState } from 'react'
import { Button, Card, Col, DatePicker, Empty, Form, Input, Row, Select, Space, Table, Tag, Typography, message } from 'antd'
import dayjs from 'dayjs'
import type { DropPoint, LoadStatus, RouteLoad, TransitRoute } from '@/types'
import { VEHICLE_CAPACITY, VEHICLE_TYPES } from '@/types'
import RouteMap from '@/components/common/RouteMap'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { orchardStore } from '@/stores/orchardStore'
import { colonyStore } from '@/stores/colonyStore'
import { droppointStore } from '@/stores/droppointStore'
import { routeStore } from '@/stores/routeStore'
import { distanceKm, estimateDurationH, routeLegs } from '@/utils/geo'

const LOAD_STATUS_COLOR: Record<LoadStatus, string> = {
  待发车: 'default',
  转场中: 'gold',
  已到站: 'green'
}

const BOX_COLOR: Record<string, string> = {
  标准继箱: 'geekblue',
  平箱: 'cyan',
  交尾箱: 'purple'
}

/** 转场路线规划：地图上依次选点生成顺序与里程，按到达站安排群号生成装车清单，支持司机发车 / 到站确认 */
export default function RoutesPage(): JSX.Element {
  const orchards = usePersistentStore(orchardStore, (state) => state.rows)
  const dropPoints = usePersistentStore(droppointStore, (state) => state.rows)
  const routes = usePersistentStore(routeStore, (state) => state.rows)
  const colonies = usePersistentStore(colonyStore, (state) => state.rows)

  const [orderedIds, setOrderedIds] = useState<string[]>([])
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [vehicleType, setVehicleType] = useState<TransitRoute['vehicleType']>('厢式货车')
  const [departAt, setDepartAt] = useState(dayjs())
  const [riskNote, setRiskNote] = useState('')

  const colonyByCode = useMemo(() => new Map(colonies.map((colony) => [colony.code, colony])), [colonies])

  const ordered = useMemo(
    () => orderedIds.map((id) => dropPoints.find((item) => item.id === id)).filter((item): item is DropPoint => Boolean(item)),
    [orderedIds, dropPoints]
  )

  const legs = useMemo(() => routeLegs(ordered.map((item) => ({ longitude: item.longitude, latitude: item.latitude }))), [ordered])

  function orchardName(orchardId: string): string {
    return orchards.find((item) => item.id === orchardId)?.name ?? '未知地块'
  }

  function pointLabel(point: DropPoint | undefined): string {
    return point ? `${point.code}（${orchardName(point.orchardId)}）` : '—'
  }

  function addPoint(id: string): void {
    if (orderedIds.includes(id)) {
      message.info('该投放点已在顺序中')
      return
    }
    setOrderedIds((prev) => [...prev, id])
  }

  function removePoint(id: string): void {
    setOrderedIds((prev) => prev.filter((item) => item !== id))
  }

  function move(index: number, direction: -1 | 1): void {
    const target = index + direction
    if (target < 0 || target >= orderedIds.length) return
    const next = [...orderedIds]
    const temp = next[index]
    next[index] = next[target]
    next[target] = temp
    setOrderedIds(next)
  }

  function handleDrop(targetId: string): void {
    if (!draggingId || draggingId === targetId) return
    setOrderedIds((prev) => {
      const next = prev.filter((item) => item !== draggingId)
      const index = next.indexOf(targetId)
      next.splice(index < 0 ? next.length : index, 0, draggingId)
      return next
    })
    setDraggingId(null)
  }

  async function generate(): Promise<void> {
    if (orderedIds.length < 2) {
      message.warning('至少选择 2 个投放点才能生成转场路线')
      return
    }
    await routeStore.getState().rebuildFromOrder(orderedIds, {
      vehicleType,
      departAt: departAt.format('YYYY-MM-DDTHH:mm'),
      riskNote: riskNote.trim()
    })
    message.success(`已生成 ${orderedIds.length - 1} 段转场路线与装车清单，累计 ${legs.total} km`)
  }

  async function regenerateAll(): Promise<void> {
    await routeStore.getState().regenerateAllLoads()
    message.success('已按最新群号安排与蜂群状态重算全部待发装车清单')
  }

  function renderColonyTag(code: string): JSX.Element {
    const colony = colonyByCode.get(code)
    const boxType = colony?.boxType
    return (
      <Tag key={code} color={boxType ? BOX_COLOR[boxType] : 'default'} style={{ marginBottom: 4 }}>
        {code}
        {boxType ? ` · ${boxType}` : ''}
      </Tag>
    )
  }

  function renderLoadCard(route: TransitRoute, load: RouteLoad): JSX.Element {
    const capacity = VEHICLE_CAPACITY[route.vehicleType]
    return (
      <Card.Grid
        key={load.tripNo}
        style={{ width: '100%', padding: 10, boxShadow: 'none', borderBottom: '1px solid #f0f0f0' }}
      >
        <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
          <Space wrap size={6}>
            <Tag color={LOAD_STATUS_COLOR[load.status]}>第 {load.tripNo} 车</Tag>
            <Tag>{route.vehicleType} · 定额 {capacity} 箱</Tag>
            <Tag color="blue">本车 {load.colonyCodes.length} 群</Tag>
            <span>{load.colonyCodes.map((code) => renderColonyTag(code))}</span>
          </Space>
          <Space>
            {load.status === '待发车' ? (
              <Button size="small" type="primary" onClick={() => void routeStore.getState().departLoad(route.id, load.tripNo)}>
                发车
              </Button>
            ) : null}
            {load.status === '转场中' ? (
              <Button size="small" type="primary" onClick={() => void routeStore.getState().arriveLoad(route.id, load.tripNo)}>
                到站确认
              </Button>
            ) : null}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {load.actualDepartAt ? `实际出发 ${load.actualDepartAt}` : '尚未发车'}
              {load.actualArriveAt ? ` · 实际到达 ${load.actualArriveAt}` : ''}
            </Typography.Text>
          </Space>
        </Space>
      </Card.Grid>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">转场路线规划</h2>
          <p className="page-sub">
            选点生成路线后，按到达站已安排且「待投放 / 回场」的群号自动分车（厢式货车 18、农用三轮 8、皮卡 6、人工搬运 2），
            交尾箱不与标准继箱混装，超载顺延下一车；司机点发车记实际出发，到站确认记实际到达并同步地块。
          </p>
        </div>
        <Space>
          <Button onClick={() => setOrderedIds([])}>清空顺序</Button>
          <Button onClick={() => void regenerateAll()}>重算全部装车清单</Button>
          <Button type="primary" onClick={() => void generate()}>
            生成并保存路线
          </Button>
        </Space>
      </div>

      <Row gutter={16}>
        <Col xs={24} xl={15}>
          <Card size="small" title="地图（投放点与转场折线）">
            <RouteMap
              orchards={orchards}
              dropPoints={dropPoints}
              routes={routes}
              orderedDropIds={orderedIds}
              height={420}
              title="转场顺序预览"
            />
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card size="small" title="投放点（点击加入转场顺序）" style={{ marginBottom: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }} size={6}>
              {dropPoints.map((point) => (
                <Space key={point.id} style={{ width: '100%', justifyContent: 'space-between' }}>
                  <span>
                    <Tag color="blue">{point.code}</Tag>
                    {orchardName(point.orchardId)} · 可容纳 {point.capacityBoxes} 箱 · 安排 {point.colonyCodes.length} 群 · 水源 {point.waterDistance} m
                  </span>
                  <Button size="small" onClick={() => addPoint(point.id)}>
                    加入顺序
                  </Button>
                </Space>
              ))}
              {dropPoints.length === 0 ? <Empty description="暂无投放点，请先在果园地块管理中添加" /> : null}
            </Space>
          </Card>

          <Card size="small" title={`转场顺序（${ordered.length} 点 · 累计 ${legs.total} km）`}>
            {ordered.length === 0 ? (
              <Typography.Text type="secondary">尚未选择投放点</Typography.Text>
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={6}>
                {ordered.map((point, index) => (
                  <div
                    key={point.id}
                    draggable
                    onDragStart={() => setDraggingId(point.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => handleDrop(point.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      border: '1px dashed #cfd9e2',
                      borderRadius: 8,
                      background: draggingId === point.id ? '#fff7e6' : '#fff',
                      cursor: 'grab'
                    }}
                  >
                    <Tag color="gold">第 {index + 1} 站</Tag>
                    <span style={{ flex: 1 }}>
                      {point.code} · {orchardName(point.orchardId)}
                      {index > 0 ? (
                        <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                          上一段 {distanceKm(ordered[index - 1], point)} km / 约 {estimateDurationH(distanceKm(ordered[index - 1], point))} h
                        </Typography.Text>
                      ) : null}
                    </span>
                    <Button size="small" disabled={index === 0} onClick={() => move(index, -1)}>
                      上移
                    </Button>
                    <Button size="small" disabled={index === ordered.length - 1} onClick={() => move(index, 1)}>
                      下移
                    </Button>
                    <Button size="small" danger type="link" onClick={() => removePoint(point.id)}>
                      移除
                    </Button>
                  </div>
                ))}
              </Space>
            )}
            <Form layout="vertical" style={{ marginTop: 12 }}>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="车辆类型" style={{ marginBottom: 8 }}>
                    <Select value={vehicleType} onChange={(value) => setVehicleType(value)} options={VEHICLE_TYPES.map((item) => ({ value: item, label: `${item}（${VEHICLE_CAPACITY[item]} 箱/车）` }))} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="首段出发时刻" style={{ marginBottom: 8 }}>
                    <DatePicker showTime value={departAt} onChange={(value) => setDepartAt(value ?? dayjs())} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <Form.Item label="途中风险备注" style={{ marginBottom: 0 }}>
                    <Input value={riskNote} onChange={(event) => setRiskNote(event.target.value)} placeholder="如 西沟坡道窄，雨天泥泞" />
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          </Card>
        </Col>
      </Row>

      {routes.map((route) => {
        const from = dropPoints.find((item) => item.id === route.fromDropId)
        const to = dropPoints.find((item) => item.id === route.toDropId)
        const loads = route.loads ?? []
        const totalBoxes = loads.reduce((sum, load) => sum + load.colonyCodes.length, 0)
        return (
          <Card
            key={route.id}
            size="small"
            style={{ marginTop: 16 }}
            title={
              <Space wrap>
                <Typography.Text strong>
                  {pointLabel(from)} → {pointLabel(to)}
                </Typography.Text>
                <Tag>{route.vehicleType} · {VEHICLE_CAPACITY[route.vehicleType]} 箱/车</Tag>
                <Tag color="blue">{loads.length} 车次 / {totalBoxes} 群</Tag>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {route.distanceKm} km · 约 {route.durationH} h · 计划 {route.departAt.replace('T', ' ')}
                </Typography.Text>
                {route.riskNote ? <Tag color="orange">风险：{route.riskNote}</Tag> : null}
              </Space>
            }
            extra={
              <Space>
                <Button size="small" onClick={() => void routeStore.getState().regenerateLoads(route.id)}>
                  刷新本路清单
                </Button>
                <Button size="small" danger type="link" onClick={() => void routeStore.getState().remove(route.id)}>
                  删除
                </Button>
              </Space>
            }
          >
            {loads.length === 0 ? (
              <Typography.Text type="secondary">
                到达站暂无「待投放 / 回场」且已安排的群，或群已被其他车次排走；可调整蜂群状态后点「刷新本路清单」。
              </Typography.Text>
            ) : (
              <Card size="small" type="inner" styles={{ body: { padding: 0 } }}>
                {loads.map((load) => renderLoadCard(route, load))}
              </Card>
            )}
          </Card>
        )
      })}

      <Card
        size="small"
        style={{ marginTop: 16 }}
        title={`已保存的转场路线（${routes.length} 段 · 合计 ${Math.round(routes.reduce((sum, item) => sum + item.distanceKm, 0) * 100) / 100} km）`}
      >
        <Table<TransitRoute>
          dataSource={routes}
          rowKey="id"
          pagination={false}
          columns={[
            {
              title: '出发',
              key: 'from',
              render: (_, record: TransitRoute) => pointLabel(dropPoints.find((item) => item.id === record.fromDropId))
            },
            {
              title: '到达',
              key: 'to',
              render: (_, record: TransitRoute) => pointLabel(dropPoints.find((item) => item.id === record.toDropId))
            },
            { title: '里程（km）', dataIndex: 'distanceKm', key: 'km', width: 100 },
            { title: '预计耗时（h）', dataIndex: 'durationH', key: 'hour', width: 110 },
            {
              title: '车次与群号',
              key: 'loads',
              render: (_, record: TransitRoute) => (
                <Space direction="vertical" size={2}>
                  {(record.loads ?? []).map((load) => (
                    <span key={load.tripNo}>
                      <Tag color={LOAD_STATUS_COLOR[load.status]} style={{ marginInlineEnd: 4 }}>
                        第{load.tripNo}车
                      </Tag>
                      {load.colonyCodes.join('、') || '空车'}
                    </span>
                  ))}
                  {(record.loads ?? []).length === 0 ? <Typography.Text type="secondary">—</Typography.Text> : null}
                </Space>
              )
            },
            { title: '车辆', dataIndex: 'vehicleType', key: 'vehicle', width: 100 },
            { title: '出发时刻', dataIndex: 'departAt', key: 'depart', width: 150, render: (value: string) => value.replace('T', ' ') },
            { title: '风险备注', dataIndex: 'riskNote', key: 'risk', render: (value: string) => value || '—' },
            { title: '实际记录', dataIndex: 'actualNote', key: 'actual' }
          ]}
        />
      </Card>
    </div>
  )
}
