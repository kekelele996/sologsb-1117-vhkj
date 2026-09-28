import { useMemo, useState } from 'react'
import { Button, Card, Col, Radio, Row, Space, Table, Tag, Typography, message } from 'antd'
import dayjs from 'dayjs'
import type { BeeColony, DropPoint, Orchard, TransitRoute } from '@/types'
import { suggestColonyBoxes, VEHICLE_CAPACITY } from '@/types'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { orchardStore } from '@/stores/orchardStore'
import { colonyStore } from '@/stores/colonyStore'
import { droppointStore } from '@/stores/droppointStore'
import { routeStore } from '@/stores/routeStore'
import { downloadCsv, downloadJson } from '@/utils/export'
import { bloomDays } from '@/utils/geo'
import { boxLoadKind } from '@/utils/loading'

interface ScheduleExportRow {
  orchard: string
  crop: string
  areaMu: number
  bloom: string
  days: number
  suggestBoxes: number
  dropCode: string
  colonyCode: string
  dropWindow: string
  withdrawTime: string
  owner: string
}

/** 转场路线表（每车次一行） */
interface RouteTripRow {
  legNo: number
  tripNo: number
  from: string
  to: string
  distanceKm: number
  durationH: number
  vehicleType: string
  capacity: number
  boxCount: number
  status: string
  colonyCodes: string
  departAt: string
  actualDepartAt: string
  actualArriveAt: string
  riskNote: string
}

/** 装车清单（每群一行，方便司机逐群清点） */
interface LoadManifestRow {
  legNo: number
  tripNo: number
  from: string
  to: string
  vehicleType: string
  status: string
  colonyCode: string
  boxType: string
  loadKind: string
  actualDepartAt: string
  actualArriveAt: string
}

/** 导出授粉安排清单与转场路线表 / 装车清单，并提供打印视图 */
export default function ExportPage(): JSX.Element {
  const orchards = usePersistentStore(orchardStore, (state) => state.rows)
  const colonies = usePersistentStore(colonyStore, (state) => state.rows)
  const dropPoints = usePersistentStore(droppointStore, (state) => state.rows)
  const routes = usePersistentStore(routeStore, (state) => state.rows)
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('landscape')

  const orchardName = (id: string): string => orchards.find((item) => item.id === id)?.name ?? '未知地块'
  const colonyByCode = useMemo(() => new Map(colonies.map((colony) => [colony.code, colony])), [colonies])

  /** 授粉安排清单：地块 × 投放点 × 群号 */
  const scheduleRows = useMemo<ScheduleExportRow[]>(() => {
    const rows: ScheduleExportRow[] = []
    orchards.forEach((orchard: Orchard) => {
      const points = dropPoints.filter((item) => item.orchardId === orchard.id)
      const base = {
        orchard: orchard.name,
        crop: orchard.crop,
        areaMu: orchard.areaMu,
        bloom: `${orchard.bloomStart} ~ ${orchard.bloomEnd}`,
        days: bloomDays(orchard),
        suggestBoxes: suggestColonyBoxes(orchard)
      }
      if (points.length === 0) {
        rows.push({ ...base, dropCode: '—', colonyCode: '—', dropWindow: '—', withdrawTime: '—', owner: '—' })
        return
      }
      points.forEach((point: DropPoint) => {
        if (point.colonyCodes.length === 0) {
          rows.push({
            ...base,
            dropCode: point.code,
            colonyCode: '待分配',
            dropWindow: point.dropWindow,
            withdrawTime: point.withdrawTime,
            owner: point.owner || '—'
          })
          return
        }
        point.colonyCodes.forEach((code) => {
          rows.push({
            ...base,
            dropCode: point.code,
            colonyCode: code,
            dropWindow: point.dropWindow,
            withdrawTime: point.withdrawTime,
            owner: point.owner || '—'
          })
        })
      })
    })
    return rows
  }, [orchards, dropPoints])

  /** 路线卡片：车次 × 群号 */
  const routeTripRows = useMemo<RouteTripRow[]>(() => {
    const rows: RouteTripRow[] = []
    routes.forEach((route: TransitRoute, legIndex) => {
      const from = dropPoints.find((item) => item.id === route.fromDropId)
      const to = dropPoints.find((item) => item.id === route.toDropId)
      const fromText = from ? `${from.code}（${orchardName(from.orchardId)}）` : '—'
      const toText = to ? `${to.code}（${orchardName(to.orchardId)}）` : '—'
      const loads = route.loads ?? []
      if (loads.length === 0) {
        rows.push({
          legNo: legIndex + 1,
          tripNo: 0,
          from: fromText,
          to: toText,
          distanceKm: route.distanceKm,
          durationH: route.durationH,
          vehicleType: route.vehicleType,
          capacity: VEHICLE_CAPACITY[route.vehicleType],
          boxCount: 0,
          status: '未装车',
          colonyCodes: '—',
          departAt: route.departAt.replace('T', ' '),
          actualDepartAt: '—',
          actualArriveAt: '—',
          riskNote: route.riskNote || '—'
        })
        return
      }
      loads.forEach((load) => {
        rows.push({
          legNo: legIndex + 1,
          tripNo: load.tripNo,
          from: fromText,
          to: toText,
          distanceKm: route.distanceKm,
          durationH: route.durationH,
          vehicleType: route.vehicleType,
          capacity: VEHICLE_CAPACITY[route.vehicleType],
          boxCount: load.colonyCodes.length,
          status: load.status,
          colonyCodes: load.colonyCodes.join('、'),
          departAt: route.departAt.replace('T', ' '),
          actualDepartAt: load.actualDepartAt || '—',
          actualArriveAt: load.actualArriveAt || '—',
          riskNote: route.riskNote || '—'
        })
      })
    })
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, dropPoints, orchards])

  /** 装车清单：展开到每个群号一行 */
  const loadManifestRows = useMemo<LoadManifestRow[]>(() => {
    const rows: LoadManifestRow[] = []
    routes.forEach((route: TransitRoute, legIndex) => {
      const from = dropPoints.find((item) => item.id === route.fromDropId)
      const to = dropPoints.find((item) => item.id === route.toDropId)
      const fromText = from ? `${from.code}（${orchardName(from.orchardId)}）` : '—'
      const toText = to ? `${to.code}（${orchardName(to.orchardId)}）` : '—'
      ;(route.loads ?? []).forEach((load) => {
        load.colonyCodes.forEach((code) => {
          const colony = colonyByCode.get(code)
          const boxType = colony?.boxType ?? '—'
          rows.push({
            legNo: legIndex + 1,
            tripNo: load.tripNo,
            from: fromText,
            to: toText,
            vehicleType: route.vehicleType,
            status: load.status,
            colonyCode: code,
            boxType,
            loadKind: boxType === '—' ? '—' : boxLoadKind(boxType),
            actualDepartAt: load.actualDepartAt || '—',
            actualArriveAt: load.actualArriveAt || '—'
          })
        })
      })
    })
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, dropPoints, orchards, colonyByCode])

  function exportSchedule(): void {
    downloadCsv('授粉安排清单.csv', scheduleRows as unknown as Record<string, unknown>[], [
      { key: 'orchard', label: '地块' },
      { key: 'crop', label: '作物' },
      { key: 'areaMu', label: '面积(亩)' },
      { key: 'bloom', label: '盛花期' },
      { key: 'days', label: '花期天数' },
      { key: 'suggestBoxes', label: '建议箱数' },
      { key: 'dropCode', label: '投放点' },
      { key: 'colonyCode', label: '群号' },
      { key: 'dropWindow', label: '投放时间窗' },
      { key: 'withdrawTime', label: '撤场时间' },
      { key: 'owner', label: '责任人' }
    ])
    message.success('授粉安排清单已导出')
  }

  function exportRoutes(): void {
    downloadCsv('转场路线表.csv', routeTripRows as unknown as Record<string, unknown>[], [
      { key: 'legNo', label: '段次' },
      { key: 'tripNo', label: '车次' },
      { key: 'from', label: '出发投放点' },
      { key: 'to', label: '到达投放点' },
      { key: 'distanceKm', label: '里程(km)' },
      { key: 'durationH', label: '预计耗时(h)' },
      { key: 'vehicleType', label: '车辆' },
      { key: 'capacity', label: '额定箱数' },
      { key: 'boxCount', label: '本车箱数' },
      { key: 'status', label: '车次状态' },
      { key: 'colonyCodes', label: '群号' },
      { key: 'departAt', label: '计划出发' },
      { key: 'actualDepartAt', label: '实际出发' },
      { key: 'actualArriveAt', label: '实际到达' },
      { key: 'riskNote', label: '途中风险' }
    ])
    message.success('转场路线表（含车次与群号）已导出')
  }

  function exportManifest(): void {
    downloadCsv('装车清单.csv', loadManifestRows as unknown as Record<string, unknown>[], [
      { key: 'legNo', label: '段次' },
      { key: 'tripNo', label: '车次' },
      { key: 'from', label: '出发投放点' },
      { key: 'to', label: '到达投放点' },
      { key: 'vehicleType', label: '车辆' },
      { key: 'status', label: '车次状态' },
      { key: 'colonyCode', label: '群号' },
      { key: 'boxType', label: '箱型' },
      { key: 'loadKind', label: '装车分组' },
      { key: 'actualDepartAt', label: '实际出发' },
      { key: 'actualArriveAt', label: '实际到达' }
    ])
    message.success('装车清单（车次 × 群号）已导出')
  }

  function exportBackup(): void {
    downloadJson('gbbeeroute-backup.json', {
      exportedAt: new Date().toISOString(),
      orchards,
      colonies,
      dropPoints,
      routes
    })
    message.success('全量数据已导出为 JSON 备份')
  }

  return (
    <div className="page">
      <style>{`@page { size: A4 ${orientation}; margin: 10mm; }`}</style>
      <div className="page-head">
        <div>
          <h2 className="page-title">导出与打印</h2>
          <p className="page-sub">
            导出授粉安排清单、按车次展开的转场路线表与装车清单（均含车次与群号），或直接使用打印视图现场交底。
          </p>
        </div>
        <Space>
          <Radio.Group value={orientation} onChange={(event) => setOrientation(event.target.value)}>
            <Radio.Button value="portrait">纵向打印</Radio.Button>
            <Radio.Button value="landscape">横向打印</Radio.Button>
          </Radio.Group>
          <Button onClick={() => window.print()}>打印视图</Button>
        </Space>
      </div>

      <Card size="small">
        <Space wrap>
          <Button type="primary" onClick={exportSchedule}>
            导出授粉安排清单（CSV）
          </Button>
          <Button onClick={exportRoutes}>导出转场路线表（CSV）</Button>
          <Button onClick={exportManifest}>导出装车清单（CSV）</Button>
          <Button onClick={exportBackup}>导出全量 JSON 备份</Button>
          <Tag>地块 {orchards.length}</Tag>
          <Tag>蜂群 {colonies.length}</Tag>
          <Tag>投放点 {dropPoints.length}</Tag>
          <Tag>路线 {routes.length}</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            生成时间 {dayjs().format('YYYY-MM-DD HH:mm')}
          </Typography.Text>
        </Space>
      </Card>

      <div className={orientation === 'landscape' ? 'print-landscape' : 'print-portrait'}>
        <Card size="small" title={`授粉安排清单（${scheduleRows.length} 行）`} style={{ marginBottom: 16 }}>
          <Table<ScheduleExportRow>
            dataSource={scheduleRows}
            rowKey={(record, index) => `${record.orchard}-${record.dropCode}-${record.colonyCode}-${index ?? 0}`}
            size="small"
            pagination={false}
            columns={[
              { title: '地块', dataIndex: 'orchard', key: 'orchard' },
              { title: '作物', dataIndex: 'crop', key: 'crop', width: 80 },
              { title: '面积(亩)', dataIndex: 'areaMu', key: 'area', width: 90 },
              { title: '盛花期', dataIndex: 'bloom', key: 'bloom' },
              { title: '天数', dataIndex: 'days', key: 'days', width: 70 },
              { title: '建议箱数', dataIndex: 'suggestBoxes', key: 'suggest', width: 90 },
              { title: '投放点', dataIndex: 'dropCode', key: 'drop', width: 90 },
              { title: '群号', dataIndex: 'colonyCode', key: 'colony', width: 90 },
              { title: '投放时间窗', dataIndex: 'dropWindow', key: 'window' },
              { title: '撤场时间', dataIndex: 'withdrawTime', key: 'withdraw' },
              { title: '责任人', dataIndex: 'owner', key: 'owner' }
            ]}
          />
        </Card>

        <Card size="small" title={`路线卡片 · 车次与群号（${routeTripRows.length} 车次）`} style={{ marginBottom: 16 }}>
          <Table<RouteTripRow>
            dataSource={routeTripRows}
            rowKey={(record, index) => `${record.legNo}-${record.tripNo}-${index ?? 0}`}
            size="small"
            pagination={false}
            columns={[
              { title: '段次', dataIndex: 'legNo', key: 'leg', width: 60 },
              {
                title: '车次',
                dataIndex: 'tripNo',
                key: 'trip',
                width: 70,
                render: (value: number) => (value > 0 ? `第${value}车` : '—')
              },
              { title: '出发', dataIndex: 'from', key: 'from' },
              { title: '到达', dataIndex: 'to', key: 'to' },
              { title: '车辆', dataIndex: 'vehicleType', key: 'vehicle', width: 90 },
              { title: '箱数', key: 'count', width: 80, render: (_, record) => `${record.boxCount}/${record.capacity}` },
              {
                title: '状态',
                dataIndex: 'status',
                key: 'status',
                width: 90,
                render: (value: string) => (
                  <Tag color={value === '已到站' ? 'green' : value === '转场中' ? 'gold' : value === '待发车' ? 'default' : 'red'}>{value}</Tag>
                )
              },
              { title: '群号', dataIndex: 'colonyCodes', key: 'codes' },
              { title: '实际出发', dataIndex: 'actualDepartAt', key: 'ad', width: 150 },
              { title: '实际到达', dataIndex: 'actualArriveAt', key: 'aa', width: 150 }
            ]}
          />
        </Card>

        <Card size="small" title={`装车清单（${loadManifestRows.length} 群，逐群清点）`}>
          <Table<LoadManifestRow>
            dataSource={loadManifestRows}
            rowKey={(record, index) => `${record.legNo}-${record.tripNo}-${record.colonyCode}-${index ?? 0}`}
            size="small"
            pagination={false}
            columns={[
              { title: '段次', dataIndex: 'legNo', key: 'leg', width: 60 },
              { title: '车次', dataIndex: 'tripNo', key: 'trip', width: 70, render: (value: number) => `第${value}车` },
              { title: '出发', dataIndex: 'from', key: 'from' },
              { title: '到达', dataIndex: 'to', key: 'to' },
              { title: '群号', dataIndex: 'colonyCode', key: 'code', width: 90 },
              { title: '箱型', dataIndex: 'boxType', key: 'box', width: 90 },
              { title: '装车分组', dataIndex: 'loadKind', key: 'kind', width: 90 },
              { title: '状态', dataIndex: 'status', key: 'status', width: 90 },
              { title: '实际出发', dataIndex: 'actualDepartAt', key: 'ad', width: 150 },
              { title: '实际到达', dataIndex: 'actualArriveAt', key: 'aa', width: 150 }
            ]}
          />
        </Card>
      </div>

      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Card size="small" title="蜂群投放一览（按群号）">
            <Space direction="vertical">
              {colonies.map((colony: BeeColony) => {
                const points = dropPoints.filter((item) => item.colonyCodes.includes(colony.code))
                return (
                  <Typography.Text key={colony.id}>
                    <Tag color="cyan">{colony.code}</Tag>
                    {colony.species} · {colony.strengthFrames} 足框 ·{' '}
                    {points.length > 0
                      ? points.map((item) => `${item.code}@${orchardName(item.orchardId)}`).join('、')
                      : '尚未安排投放点'}
                  </Typography.Text>
                )
              })}
            </Space>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card size="small" title="导出说明">
            <Typography.Paragraph style={{ fontSize: 13, marginBottom: 6 }}>
              1. 授粉安排清单按「地块 × 投放点 × 群号」展开，可直接给蜂场与园主核对；
            </Typography.Paragraph>
            <Typography.Paragraph style={{ fontSize: 13, marginBottom: 6 }}>
              2. 转场路线表按车次展开（含车次、群号、实际出发 / 到达）；装车清单逐群一行，供司机按车清点、现场交底；
            </Typography.Paragraph>
            <Typography.Paragraph style={{ fontSize: 13, marginBottom: 0 }}>
              3. 点击「打印视图」后再选择打印机或另存 PDF；数据全部来自浏览器本地 IndexedDB。
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
