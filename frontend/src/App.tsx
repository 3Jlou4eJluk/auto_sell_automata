import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import type {
  DockviewApi,
  DockviewReadyEvent,
  IDockviewPanel,
  SerializedDockview,
} from 'dockview'
import 'dockview/dist/styles/dockview.css'
import './App.css'
import {
  DockviewReact,
  type DockviewPanelComponent,
} from './dockview-react'
import { useRepriceStore } from './store'
import type { RepriceRow, Rounding } from './types'

const LAYOUT_STORAGE_KEY = 'reprice.layout.v1'

const PANEL_KINDS = ['price', 'review', 'summary', 'settings'] as const
type PanelKind = (typeof PANEL_KINDS)[number]

const PANEL_DEFS: Record<PanelKind, { title: string }> = {
  price: { title: 'Прайс' },
  review: { title: 'На разбор' },
  summary: { title: 'Сводка' },
  settings: { title: 'Настройки правил' },
}

const nf = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
})

const percentNf = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
})

function isPanelKind(value: string): value is PanelKind {
  return PANEL_KINDS.includes(value as PanelKind)
}

function panelKindFromPanel(panel: IDockviewPanel): PanelKind {
  const rawKind = panel.params?.kind
  if (typeof rawKind === 'string' && isPanelKind(rawKind)) {
    return rawKind
  }

  const idPrefix = panel.id.split('-')[0]
  return isPanelKind(idPrefix) ? idPrefix : 'price'
}

function getNextPanelId(api: DockviewApi, kind: PanelKind): string {
  let index = 1
  let id = `${kind}-${index}`

  while (api.getPanel(id)) {
    index += 1
    id = `${kind}-${index}`
  }

  return id
}

function addRepricePanel(
  api: DockviewApi,
  kind: PanelKind,
  options: {
    inactive?: boolean
    initialWidth?: number
    initialHeight?: number
    position?: {
      referencePanel: string | IDockviewPanel
      direction: 'right' | 'below' | 'within'
    }
  } = {},
): IDockviewPanel {
  return api.addPanel({
    id: getNextPanelId(api, kind),
    component: kind,
    title: PANEL_DEFS[kind].title,
    params: { kind },
    ...options,
  })
}

function createDefaultLayout(api: DockviewApi): void {
  api.clear()

  const price = addRepricePanel(api, 'price')
  addRepricePanel(api, 'review', {
    inactive: true,
    position: { referencePanel: price, direction: 'within' },
  })
  const summary = addRepricePanel(api, 'summary', {
    initialWidth: 420,
    position: { referencePanel: price, direction: 'right' },
  })
  addRepricePanel(api, 'settings', {
    initialHeight: 320,
    position: { referencePanel: summary, direction: 'below' },
  })

  price.api.setActive()
}

function restoreLayout(api: DockviewApi): void {
  const savedLayout = localStorage.getItem(LAYOUT_STORAGE_KEY)

  if (savedLayout) {
    try {
      api.fromJSON(JSON.parse(savedLayout) as SerializedDockview)
      if (api.totalPanels > 0) {
        return
      }
    } catch {
      localStorage.removeItem(LAYOUT_STORAGE_KEY)
    }
  }

  createDefaultLayout(api)
}

function focusOrShowPanel(api: DockviewApi, kind: PanelKind): void {
  const existing = api.panels.find((panel) => panelKindFromPanel(panel) === kind)

  if (existing) {
    existing.api.setActive()
    api.focus()
    return
  }

  addRepricePanel(api, kind)
  api.focus()
}

function duplicateActivePanel(
  api: DockviewApi,
  direction: 'right' | 'below',
): void {
  const activePanel = api.activePanel

  if (!activePanel) {
    return
  }

  addRepricePanel(api, panelKindFromPanel(activePanel), {
    position: {
      referencePanel: activePanel,
      direction,
    },
  })
}

function formatNumber(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? nf.format(value)
    : '-'
}

function formatText(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '-'
  }

  return String(value)
}

function formatPercent(value: number): string {
  return `${percentNf.format(value * 100)}%`
}

function roundingLabel(rounding: Rounding): string {
  switch (rounding) {
    case '0.01':
      return 'до копеек'
    case '10':
      return 'до 10 руб'
    case '1':
      return 'до рубля'
  }
}

function statusTone(status: string): string {
  if (status === 'OK') {
    return 'green'
  }
  if (status === 'КОНФЛИКТ') {
    return 'red'
  }
  if (status.startsWith('УЦЕНКА+')) {
    return 'orange'
  }
  if (status.startsWith('СЕБЕСТ+')) {
    return 'blue'
  }
  if (status === 'ПОЛ УЦЕНКИ') {
    return 'purple'
  }
  if (status === 'НЕТ MIN ЦЕНЫ' || status === 'ОШИБКА ДАННЫХ') {
    return 'gray'
  }

  return 'gray'
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status-badge status-${statusTone(status)}`}>
      {status}
    </span>
  )
}

function App() {
  const dockDisposablesRef = useRef<Array<{ dispose: () => void }>>([])
  const persistTimerRef = useRef<number | null>(null)
  const apiRef = useRef<DockviewApi | null>(null)
  const [activePanelId, setActivePanelId] = useState<string | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)

  const components = useMemo<Record<string, DockviewPanelComponent>>(
    () => ({
      price: PricePanel,
      review: ReviewPanel,
      summary: SummaryPanel,
      settings: SettingsPanel,
    }),
    [],
  )

  const disposeDockSubscriptions = useCallback(() => {
    dockDisposablesRef.current.forEach((disposable) => disposable.dispose())
    dockDisposablesRef.current = []

    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }
  }, [])

  const handleReady = useCallback(
    (event: DockviewReadyEvent) => {
      disposeDockSubscriptions()
      apiRef.current = event.api
      restoreLayout(event.api)
      setActivePanelId(event.api.activePanel?.id ?? null)

      const layoutDisposable = event.api.onDidLayoutChange(() => {
        if (persistTimerRef.current !== null) {
          window.clearTimeout(persistTimerRef.current)
        }

        persistTimerRef.current = window.setTimeout(() => {
          localStorage.setItem(
            LAYOUT_STORAGE_KEY,
            JSON.stringify(event.api.toJSON()),
          )
        }, 500)
      })

      const activeDisposable = event.api.onDidActivePanelChange(({ panel }) => {
        setActivePanelId(panel?.id ?? null)
      })

      const removedDisposable = event.api.onDidRemovePanel(() => {
        setActivePanelId(event.api.activePanel?.id ?? null)
      })

      dockDisposablesRef.current = [
        layoutDisposable,
        activeDisposable,
        removedDisposable,
      ]
    },
    [disposeDockSubscriptions],
  )

  const handleResetLayout = useCallback(() => {
    const api = apiRef.current

    if (!api) {
      return
    }

    localStorage.removeItem(LAYOUT_STORAGE_KEY)
    createDefaultLayout(api)
    setActivePanelId(api.activePanel?.id ?? null)
  }, [])

  const handleShowPanel = useCallback((kind: PanelKind) => {
    const api = apiRef.current

    if (!api) {
      return
    }

    focusOrShowPanel(api, kind)
    setActivePanelId(api.activePanel?.id ?? null)
  }, [])

  const handleSplit = useCallback((direction: 'right' | 'below') => {
    const api = apiRef.current

    if (!api) {
      return
    }

    duplicateActivePanel(api, direction)
    setActivePanelId(api.activePanel?.id ?? null)
  }, [])

  const handleCloseActive = useCallback(() => {
    const activePanel = apiRef.current?.activePanel

    if (!activePanel) {
      return
    }

    activePanel.api.close()
    setActivePanelId(apiRef.current?.activePanel?.id ?? null)
  }, [])

  useEffect(() => {
    return () => {
      disposeDockSubscriptions()
      apiRef.current = null
    }
  }, [disposeDockSubscriptions])

  return (
    <div className="app-shell">
      <TopMenu
        activePanelId={activePanelId}
        onAbout={() => setAboutOpen(true)}
        onCloseActive={handleCloseActive}
        onResetLayout={handleResetLayout}
        onShowPanel={handleShowPanel}
        onSplit={handleSplit}
      />

      <main className="dock-host" aria-label="Рабочая область репрайсера">
        <DockviewReact
          className="dock-root dockview-theme-light"
          components={components}
          onReady={handleReady}
          options={{
            noPanelsOverlay: 'emptyGroup',
            singleTabMode: 'default',
          }}
        />
      </main>

      {aboutOpen ? <AboutModal onClose={() => setAboutOpen(false)} /> : null}
    </div>
  )
}

function TopMenu({
  activePanelId,
  onAbout,
  onCloseActive,
  onResetLayout,
  onShowPanel,
  onSplit,
}: {
  activePanelId: string | null
  onAbout: () => void
  onCloseActive: () => void
  onResetLayout: () => void
  onShowPanel: (kind: PanelKind) => void
  onSplit: (direction: 'right' | 'below') => void
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [openMenu, setOpenMenu] = useState<'file' | 'windows' | 'help' | null>(
    null,
  )
  const openFile = useRepriceStore((state) => state.openFile)
  const download = useRepriceStore((state) => state.download)
  const reset = useRepriceStore((state) => state.reset)
  const result = useRepriceStore((state) => state.result)

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpenMenu(null)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenMenu(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (file) {
      void openFile(file)
    }

    setOpenMenu(null)
  }

  const runMenuAction = (action: () => void) => {
    action()
    setOpenMenu(null)
  }

  return (
    <header className="top-menu" ref={menuRef}>
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={handleFileChange}
      />

      <div className="menu-brand">
        <span className="brand-mark">RP</span>
        <span>Репрайсер</span>
      </div>

      <div className="menu-groups" role="menubar" aria-label="Главное меню">
        <MenuRootButton
          label="Файл"
          open={openMenu === 'file'}
          onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')}
        >
          <MenuItem
            onClick={() => runMenuAction(() => fileInputRef.current?.click())}
          >
            Открыть проценку...
          </MenuItem>
          <MenuItem
            disabled={!result}
            onClick={() => runMenuAction(download)}
          >
            Скачать результат
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={() => runMenuAction(reset)}>
            Сбросить данные
          </MenuItem>
        </MenuRootButton>

        <MenuRootButton
          label="Окна"
          open={openMenu === 'windows'}
          onClick={() =>
            setOpenMenu(openMenu === 'windows' ? null : 'windows')
          }
        >
          <div className="menu-item has-submenu" role="menuitem">
            <span>Показать панель</span>
            <span className="submenu-arrow">›</span>
            <div className="submenu" role="menu">
              {PANEL_KINDS.map((kind) => (
                <MenuItem
                  key={kind}
                  onClick={() => runMenuAction(() => onShowPanel(kind))}
                >
                  {PANEL_DEFS[kind].title}
                </MenuItem>
              ))}
            </div>
          </div>
          <MenuSeparator />
          <MenuItem
            disabled={!activePanelId}
            onClick={() => runMenuAction(() => onSplit('right'))}
          >
            Сплит вправо
          </MenuItem>
          <MenuItem
            disabled={!activePanelId}
            onClick={() => runMenuAction(() => onSplit('below'))}
          >
            Сплит вниз
          </MenuItem>
          <MenuItem
            disabled={!activePanelId}
            onClick={() => runMenuAction(onCloseActive)}
          >
            Закрыть активную панель
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={() => runMenuAction(onResetLayout)}>
            Сбросить раскладку
          </MenuItem>
        </MenuRootButton>

        <MenuRootButton
          label="Справка"
          open={openMenu === 'help'}
          onClick={() => setOpenMenu(openMenu === 'help' ? null : 'help')}
        >
          <MenuItem onClick={() => runMenuAction(onAbout)}>О программе</MenuItem>
        </MenuRootButton>
      </div>
    </header>
  )
}

function MenuRootButton({
  children,
  label,
  onClick,
  open,
}: {
  children: ReactNode
  label: string
  onClick: () => void
  open: boolean
}) {
  return (
    <div className="menu-root">
      <button
        type="button"
        className={`menu-root-button${open ? ' is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onClick}
      >
        {label}
      </button>
      {open ? (
        <div className="menu-dropdown" role="menu">
          {children}
        </div>
      ) : null}
    </div>
  )
}

function MenuItem({
  children,
  disabled = false,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="menu-item"
      disabled={disabled}
      role="menuitem"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function MenuSeparator() {
  return <div className="menu-separator" role="separator" />
}

function PricePanel(_props: unknown) {
  const result = useRepriceStore((state) => state.result)

  if (!result) {
    return <UploadPanel />
  }

  return (
    <RowsTable
      rows={result.rows}
      title="Прайс"
      showStatusFilter
      emptyText="В таблице нет строк."
    />
  )
}

function ReviewPanel(_props: unknown) {
  const result = useRepriceStore((state) => state.result)
  const rows = useMemo(
    () => result?.rows.filter((row) => row.for_review) ?? [],
    [result],
  )

  if (!result) {
    return (
      <PanelEmpty
        title="На разбор"
        text="Откройте проценку, чтобы увидеть строки, требующие проверки."
      />
    )
  }

  return (
    <RowsTable
      rows={rows}
      title="На разбор"
      emptyText="Строк на разбор нет."
    />
  )
}

function SummaryPanel(_props: unknown) {
  const result = useRepriceStore((state) => state.result)
  const params = useRepriceStore((state) => state.params)
  const loading = useRepriceStore((state) => state.loading)
  const error = useRepriceStore((state) => state.error)
  const download = useRepriceStore((state) => state.download)
  const summary = result?.summary
  const resultParams = summary?.params
  const visibleParams = resultParams
    ? {
        discount: resultParams.discount,
        markdownMarkup: resultParams.markdown_markup,
        costMarkup: resultParams.cost_markup,
        rounding: resultParams.rounding,
      }
    : params

  return (
    <section className="panel-surface summary-panel">
      <PanelHeader title="Сводка" />

      {loading ? (
        <div className="inline-state">
          <span className="spinner" aria-hidden="true" />
          <span>Пересчитываем прайс...</span>
        </div>
      ) : null}

      {error ? <div className="error-box">{error}</div> : null}

      {summary ? (
        <>
          <div className="summary-grid">
            <SummaryCard label="Всего строк" value={summary.total} />
            <SummaryCard label="На разбор" value={summary.review_count} />
            <SummaryCard label="Лист" value={summary.sheet} />
          </div>

          <div className="status-summary">
            {Object.entries(summary.by_status).map(([status, count]) => (
              <div className="status-line" key={status}>
                <StatusBadge status={status} />
                <span className="numeric">{nf.format(count)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <PanelEmpty
          title="Данных пока нет"
          text="Откройте Excel-файл проценки из меню или перетащите его в панель Прайс."
          compact
        />
      )}

      <div className="params-list">
        <ParamLine
          label="Скидка от Min цены"
          value={formatPercent(visibleParams.discount)}
        />
        <ParamLine
          label="Наценка на уценку"
          value={formatPercent(visibleParams.markdownMarkup)}
        />
        <ParamLine
          label="Наценка на себестоимость"
          value={formatPercent(visibleParams.costMarkup)}
        />
        <ParamLine
          label="Округление"
          value={roundingLabel(visibleParams.rounding)}
        />
      </div>

      <button
        type="button"
        className="primary-button wide"
        disabled={!result}
        onClick={download}
      >
        Скачать результат (.xlsx)
      </button>
    </section>
  )
}

function SettingsPanel(_props: unknown) {
  const file = useRepriceStore((state) => state.file)
  const params = useRepriceStore((state) => state.params)
  const loading = useRepriceStore((state) => state.loading)
  const setParams = useRepriceStore((state) => state.setParams)
  const recalc = useRepriceStore((state) => state.recalc)

  const updatePercent = (
    key: 'discount' | 'markdownMarkup' | 'costMarkup',
    value: string,
  ) => {
    const parsed = Number(value)
    setParams({ [key]: Number.isFinite(parsed) ? parsed / 100 : 0 })
  }

  return (
    <section className="panel-surface settings-panel">
      <PanelHeader title="Настройки правил" />

      <PercentField
        label="Скидка от Min цены, %"
        hint="Уменьшает минимальную цену поставщика перед сравнением."
        value={params.discount * 100}
        onChange={(value) => updatePercent('discount', value)}
      />
      <PercentField
        label="Наценка на уценку, %"
        hint="Добавляется к найденной уценённой цене."
        value={params.markdownMarkup * 100}
        onChange={(value) => updatePercent('markdownMarkup', value)}
      />
      <PercentField
        label="Наценка на себестоимость, %"
        hint="Используется, когда цена строится от себестоимости."
        value={params.costMarkup * 100}
        onChange={(value) => updatePercent('costMarkup', value)}
      />

      <label className="field">
        <span className="field-label">Округление</span>
        <select
          value={params.rounding}
          onChange={(event) =>
            setParams({ rounding: event.target.value as Rounding })
          }
        >
          <option value="1">до рубля</option>
          <option value="0.01">до копеек</option>
          <option value="10">до 10 руб</option>
        </select>
        <span className="field-hint">
          Применяется к рассчитанной новой цене.
        </span>
      </label>

      <button
        type="button"
        className="primary-button"
        disabled={!file || loading}
        onClick={() => void recalc()}
      >
        {loading ? 'Пересчитываем...' : 'Пересчитать'}
      </button>
    </section>
  )
}

function PercentField({
  hint,
  label,
  onChange,
  value,
}: {
  hint: string
  label: string
  onChange: (value: string) => void
  value: number
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        value={Number.isFinite(value) ? String(value) : '0'}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="field-hint">{hint}</span>
    </label>
  )
}

function RowsTable({
  emptyText,
  rows,
  showStatusFilter = false,
  title,
}: {
  emptyText: string
  rows: RepriceRow[]
  showStatusFilter?: boolean
  title: string
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const statuses = useMemo(
    () => Array.from(new Set(rows.map((row) => row.status))).sort(),
    [rows],
  )

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    return rows.filter((row) => {
      if (showStatusFilter && statusFilter !== 'all') {
        if (row.status !== statusFilter) {
          return false
        }
      }

      if (!normalizedSearch) {
        return true
      }

      return [row.article, row.name, row.brand].some((value) =>
        String(value ?? '').toLowerCase().includes(normalizedSearch),
      )
    })
  }, [rows, search, showStatusFilter, statusFilter])

  const columns = useMemo<ColumnDef<RepriceRow>[]>(
    () => [
      {
        id: 'num',
        header: '№',
        accessorFn: (row) => row.num ?? row.row,
        cell: (info) => (
          <span className="numeric">{formatNumber(info.getValue<number>())}</span>
        ),
      },
      {
        accessorKey: 'article',
        header: 'Артикул',
        cell: (info) => (
          <span className="cell-strong">{formatText(info.getValue())}</span>
        ),
      },
      {
        accessorKey: 'brand',
        header: 'Бренд',
        cell: (info) => formatText(info.getValue()),
      },
      {
        accessorKey: 'name',
        header: 'Номенклатура',
        cell: (info) => (
          <span className="cell-name">{formatText(info.getValue())}</span>
        ),
      },
      {
        accessorKey: 'qty',
        header: 'Кол-во',
        cell: (info) => (
          <span className="numeric">
            {formatNumber(info.getValue<number | null>())}
          </span>
        ),
      },
      {
        accessorKey: 'cost',
        header: 'Себестоимость',
        cell: (info) => (
          <span className="numeric">
            {formatNumber(info.getValue<number | null>())}
          </span>
        ),
      },
      {
        accessorKey: 'min_price',
        header: 'Min Цена',
        cell: (info) => (
          <span className="numeric">
            {formatNumber(info.getValue<number | null>())}
          </span>
        ),
      },
      {
        accessorKey: 'supplier',
        header: 'Поставщик',
        cell: (info) => formatText(info.getValue()),
      },
      {
        accessorKey: 'markdown',
        header: 'Уценка',
        cell: (info) => (
          <span className="numeric">
            {formatNumber(info.getValue<number | null>())}
          </span>
        ),
      },
      {
        accessorKey: 'new_price',
        header: 'Новая цена',
        cell: (info) => (
          <span className="numeric cell-strong">
            {formatNumber(info.getValue<number | null>())}
          </span>
        ),
      },
      {
        accessorKey: 'delta',
        header: 'Дельта',
        cell: (info) => {
          const value = info.getValue<number | null>()
          return (
            <span
              className={`numeric${typeof value === 'number' && value < 0 ? ' negative' : ''}`}
            >
              {formatNumber(value)}
            </span>
          )
        },
      },
      {
        accessorKey: 'status',
        header: 'Статус',
        cell: (info) => <StatusBadge status={String(info.getValue())} />,
      },
      {
        accessorKey: 'warehouse',
        header: 'Склад',
        cell: (info) => formatText(info.getValue()),
      },
    ],
    [],
  )

  const table = useReactTable({
    data: filteredRows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <section className="panel-surface table-panel">
      <PanelHeader title={title} aside={`${nf.format(filteredRows.length)} строк`} />

      <div className="table-controls">
        <input
          type="search"
          placeholder="Поиск по артикулу, названию, бренду"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {showStatusFilter ? (
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">Все статусы</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="table-shell">
        <table className="reprice-table">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id}>
                    {header.isPlaceholder ? null : (
                      <button
                        type="button"
                        className="th-button"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        <span className="sort-mark">
                          {{
                            asc: '↑',
                            desc: '↓',
                          }[header.column.getIsSorted() as string] ?? ''}
                        </span>
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td className="empty-row" colSpan={columns.length}>
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function UploadPanel() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const openFile = useRepriceStore((state) => state.openFile)
  const loading = useRepriceStore((state) => state.loading)
  const error = useRepriceStore((state) => state.error)

  const pickFile = (file: File | undefined) => {
    if (file) {
      void openFile(file)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragActive(false)
    pickFile(event.dataTransfer.files?.[0])
  }

  return (
    <section className="panel-surface upload-panel">
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(event) => {
          pickFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />

      <div
        className={`drop-zone${dragActive ? ' is-active' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) {
            setDragActive(false)
          }
        }}
        onDrop={handleDrop}
      >
        <div className="drop-zone-icon" aria-hidden="true">
          XLSX
        </div>
        <h2>Откройте файл проценки</h2>
        <p>
          Перетащите Excel-файл в эту область или выберите его через меню.
        </p>
        <button
          type="button"
          className="primary-button"
          disabled={loading}
          onClick={() => inputRef.current?.click()}
        >
          {loading ? 'Загружаем...' : 'Выбрать .xlsx'}
        </button>
        {error ? <div className="error-box inline">{error}</div> : null}
      </div>
    </section>
  )
}

function PanelHeader({
  aside,
  title,
}: {
  aside?: ReactNode
  title: string
}) {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
      {aside ? <div className="panel-header-aside">{aside}</div> : null}
    </div>
  )
}

function PanelEmpty({
  compact = false,
  text,
  title,
}: {
  compact?: boolean
  text: string
  title: string
}) {
  return (
    <div className={`empty-panel${compact ? ' compact' : ''}`}>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  )
}

function SummaryCard({
  label,
  value,
}: {
  label: string
  value: number | string
}) {
  return (
    <div className="summary-card">
      <span>{label}</span>
      <strong className={typeof value === 'number' ? 'numeric' : undefined}>
        {typeof value === 'number' ? nf.format(value) : value}
      </strong>
    </div>
  )
}

function ParamLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="param-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function AboutModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel-header">
          <h2 id="about-title">О программе</h2>
          <button type="button" className="ghost-button" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <p>
          Репрайсер загружает Excel-файл проценки, отправляет его на сервер и
          показывает рассчитанную новую цену по строкам прайса.
        </p>
        <p>
          Правила сравнивают Min цену, уценку и себестоимость с заданными
          наценками, отмечают конфликтные строки и формируют готовый xlsx для
          скачивания.
        </p>
      </section>
    </div>
  )
}

export default App
