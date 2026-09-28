import { useMemo, useState } from 'react'
import { Button, Card, Col, Radio, Row, Space, Table, Tag, Typography, message } from 'antd'
import dayjs from 'dayjs'
import type { BeeColony, DropPoint, Orchard, TransitRoute } from '@/types'
import { suggestColonyBoxes } from '@/types'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { orchardStore } from '@/stores/orchardStore'
import { colonyStore } from '@/stores/colonyStore'
import { droppointStore } from '@/stores/droppointStore'
import { routeStore } from '@/stores/routeStore'
import { downloadCsv, downloadJson } from '@/utils/export'
import { bloomDays } from '@/utils/geo'

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

interface RouteExportRow {
  legNo: number
  tripNo: string
  from: string
  to: string
  distanceKm: number
  durationH: number
  vehicleType: string
  loadGroup: string
  colonyCode: string
  boxes: number | string
  departAt: string
  tripStatus: string
  actualDepartAt: string
  actualArriveAt: string
  riskNote: string
  actualNote: string
}

interface LoadingExportRow {
  legNo: number
  tripNo: number
  from: string
  to: string
  vehicleType: string
  capacityBoxes: number
  loadGroup: string
  colonyCode: string
  boxType: string
  tripStatus: string
  actualDepartAt: string
  actualArriveAt: string
}

/** 导出授粉安排清单与转场路线表，并提供打印视图 */
export default function ExportPage(): JSX.Element {
  const orchards = usePersistentStore(orchardStore, (state) => state.rows)
  const colonies = usePersistentStore(colonyStore, (state) => state.rows)
  const dropPoints = usePersistentStore(droppointStore, (state) => state.rows)
  const routes = usePersistentStore(routeStore, (state) => state.rows)
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('landscape')

  const orchardName = (id: string): string => orchards.find((item) => item.id === id)?.name ?? '未知地块'

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

  /** 转场路线表：按车次 × 群号展开，未生成清单的路线段保留一行（车次与群号留空） */
  const routeRows = useMemo<RouteExportRow[]>(() => {
    const rows: RouteExportRow[] = []
    routes.forEach((route: TransitRoute, legIndex) => {
      const from = dropPoints.find((item) => item.id === route.fromDropId)
      const to = dropPoints.find((item) => item.id === route.toDropId)
      const fromText = from ? `${from.code}（${orchardName(from.orchardId)}）` : '—'
      const toText = to ? `${to.code}（${orchardName(to.orchardId)}）` : '—'
      const base = {
        legNo: legIndex + 1,
        from: fromText,
        to: toText,
        distanceKm: route.distanceKm,
        durationH: route.durationH,
        vehicleType: route.vehicleType,
        departAt: route.departAt,
        riskNote: route.riskNote || '—',
        actualNote: route.actualNote || '—'
      }
      if (route.trips.length === 0) {
        rows.push({
          ...base,
          tripNo: '—',
          loadGroup: '—',
          colonyCode: '—',
          boxes: '—',
          tripStatus: '未生成清单',
          actualDepartAt: '',
          actualArriveAt: ''
        })
        return
      }
      route.trips.forEach((trip) => {
        trip.colonyCodes.forEach((code) => {
          rows.push({
            ...base,
            tripNo: `第${trip.seq}车`,
            loadGroup: trip.loadGroup,
            colonyCode: code,
            boxes: trip.colonyCodes.length,
            tripStatus: trip.status,
            actualDepartAt: trip.actualDepartAt,
            actualArriveAt: trip.actualArriveAt
          })
        })
      })
    })
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, dropPoints, orchards])

  /** 装车清单：司机视角，每个群号一行（车次 / 容量 / 箱型组 / 状态 / 实际时刻） */
  const loadingRows = useMemo<LoadingExportRow[]>(() => {
    const rows: LoadingExportRow[] = []
    routes.forEach((route: TransitRoute, legIndex) => {
      const from = dropPoints.find((item) => item.id === route.fromDropId)
      const to = dropPoints.find((item) => item.id === route.toDropId)
      const fromText = from ? `${from.code}（${orchardName(from.orchardId)}）` : '—'
      const toText = to ? `${to.code}（${orchardName(to.orchardId)}）` : '—'
      route.trips.forEach((trip) => {
        trip.colonyCodes.forEach((code) => {
          const colony = colonies.find((item) => item.code === code)
          rows.push({
            legNo: legIndex + 1,
            tripNo: trip.seq,
            from: fromText,
            to: toText,
            vehicleType: trip.vehicleType,
            capacityBoxes: trip.capacityBoxes,
            loadGroup: trip.loadGroup,
            colonyCode: code,
            boxType: colony?.boxType ?? '—',
            tripStatus: trip.status,
            actualDepartAt: trip.actualDepartAt,
            actualArriveAt: trip.actualArriveAt
          })
        })
      })
    })
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, dropPoints, orchards, colonies])

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
    downloadCsv('转场路线表.csv', routeRows as unknown as Record<string, unknown>[], [
      { key: 'legNo', label: '段次' },
      { key: 'tripNo', label: '车次' },
      { key: 'from', label: '出发投放点' },
      { key: 'to', label: '到达投放点' },
      { key: 'distanceKm', label: '里程(km)' },
      { key: 'durationH', label: '预计耗时(h)' },
      { key: 'vehicleType', label: '车辆' },
      { key: 'loadGroup', label: '箱型组' },
      { key: 'colonyCode', label: '群号' },
      { key: 'boxes', label: '本车箱数' },
      { key: 'departAt', label: '计划出发' },
      { key: 'tripStatus', label: '车次状态' },
      { key: 'actualDepartAt', label: '实际出发' },
      { key: 'actualArriveAt', label: '实际到达' },
      { key: 'riskNote', label: '途中风险' },
      { key: 'actualNote', label: '实际记录' }
    ])
    message.success('转场路线表已导出（含车次与群号）')
  }

  function exportLoading(): void {
    if (loadingRows.length === 0) {
      message.warning('暂无装车清单，请先在转场路线规划页生成')
      return
    }
    downloadCsv('装车清单.csv', loadingRows as unknown as Record<string, unknown>[], [
      { key: 'legNo', label: '段次' },
      { key: 'tripNo', label: '车次' },
      { key: 'from', label: '出发投放点' },
      { key: 'to', label: '到达投放点' },
      { key: 'vehicleType', label: '车辆' },
      { key: 'capacityBoxes', label: '单车容量(箱)' },
      { key: 'loadGroup', label: '箱型组' },
      { key: 'colonyCode', label: '群号' },
      { key: 'boxType', label: '箱型' },
      { key: 'tripStatus', label: '车次状态' },
      { key: 'actualDepartAt', label: '实际出发' },
      { key: 'actualArriveAt', label: '实际到达' }
    ])
    message.success(`装车清单已导出，共 ${loadingRows.length} 行`)
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
            导出授粉安排清单、装车清单（车次 × 群号）与转场路线表，或直接使用打印视图现场交底给司机。
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
          <Button onClick={exportLoading}>导出装车清单（CSV）</Button>
          <Button onClick={exportRoutes}>导出转场路线表（CSV）</Button>
          <Button onClick={exportBackup}>导出全量 JSON 备份</Button>
          <Tag>地块 {orchards.length}</Tag>
          <Tag>蜂群 {colonies.length}</Tag>
          <Tag>投放点 {dropPoints.length}</Tag>
          <Tag>路线 {routes.length} 段</Tag>
          <Tag color="gold">车次 {routes.reduce((sum, item) => sum + item.trips.length, 0)} 车</Tag>
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

        <Card size="small" title={`装车清单（${loadingRows.length} 行 · ${routes.reduce((sum, item) => sum + item.trips.length, 0)} 车次）`} style={{ marginBottom: 16 }}>
          <Table
            dataSource={loadingRows}
            rowKey={(record, index) => `${record.legNo}-${record.tripNo}-${record.colonyCode}-${index ?? 0}`}
            size="small"
            pagination={false}
            columns={[
              { title: '段次', dataIndex: 'legNo', key: 'leg', width: 60 },
              { title: '车次', dataIndex: 'tripNo', key: 'trip', width: 60, render: (value: number) => `第${value}车` },
              { title: '出发', dataIndex: 'from', key: 'from' },
              { title: '到达', dataIndex: 'to', key: 'to' },
              { title: '车辆', dataIndex: 'vehicleType', key: 'vehicle', width: 90 },
              { title: '容量', dataIndex: 'capacityBoxes', key: 'cap', width: 60 },
              { title: '箱型组', dataIndex: 'loadGroup', key: 'group', width: 80 },
              { title: '群号', dataIndex: 'colonyCode', key: 'code', width: 80 },
              { title: '箱型', dataIndex: 'boxType', key: 'box', width: 90 },
              { title: '状态', dataIndex: 'tripStatus', key: 'status', width: 80 },
              { title: '实际出发', dataIndex: 'actualDepartAt', key: 'ad', width: 130, render: (value: string) => value || '—' },
              { title: '实际到达', dataIndex: 'actualArriveAt', key: 'aa', width: 130, render: (value: string) => value || '—' }
            ]}
          />
        </Card>

        <Card size="small" title={`转场路线表（${routeRows.length} 行）`}>
          <Table
            dataSource={routeRows}
            rowKey={(record, index) => `${record.legNo}-${record.tripNo}-${record.colonyCode}-${index ?? 0}`}
            size="small"
            pagination={false}
            columns={[
              { title: '段次', dataIndex: 'legNo', key: 'leg', width: 60 },
              { title: '车次', dataIndex: 'tripNo', key: 'trip', width: 70 },
              { title: '出发投放点', dataIndex: 'from', key: 'from' },
              { title: '到达投放点', dataIndex: 'to', key: 'to' },
              { title: '里程(km)', dataIndex: 'distanceKm', key: 'km', width: 90 },
              { title: '耗时(h)', dataIndex: 'durationH', key: 'hour', width: 80 },
              { title: '车辆', dataIndex: 'vehicleType', key: 'vehicle', width: 90 },
              { title: '箱型组', dataIndex: 'loadGroup', key: 'group', width: 80 },
              { title: '群号', dataIndex: 'colonyCode', key: 'code', width: 80 },
              { title: '状态', dataIndex: 'tripStatus', key: 'status', width: 90 },
              { title: '计划出发', dataIndex: 'departAt', key: 'depart', width: 140 },
              { title: '实际到达', dataIndex: 'actualArriveAt', key: 'aa', width: 140, render: (value: string) => value || '—' },
              { title: '途中风险', dataIndex: 'riskNote', key: 'risk' }
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
              2. 装车清单按车次 × 群号展开，交尾箱与标准箱不混装，发车 / 到站实际时刻随现场操作回填；
            </Typography.Paragraph>
            <Typography.Paragraph style={{ fontSize: 13, marginBottom: 6 }}>
              3. 转场路线表带段次、车次与群号，实际执行情况可在“转场路线规划”页逐车回填；
            </Typography.Paragraph>
            <Typography.Paragraph style={{ fontSize: 13, marginBottom: 0 }}>
              4. 点击「打印视图」后再选择打印机或另存 PDF；数据全部来自浏览器本地 IndexedDB。
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
