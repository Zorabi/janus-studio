import {
  type ColumnDef,
  type ColumnFiltersState,
  type RowSelectionState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  Columns3,
  Copy,
  Rows3,
  Search,
  X,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslate } from "../lib/i18n";
import {
  gremlinConsoleOutput,
  printableValue,
  tableColumns,
  type ResultRow,
} from "../lib/result-model";

type Density = "compact" | "comfortable" | "spacious";
type RowLimit = 100 | 500 | 1_000 | "all";

const ROW_HEIGHT: Record<Density, number> = {
  compact: 34,
  comfortable: 42,
  spacious: 52,
};

function escapeTsv(value: unknown) {
  return printableValue(value).replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

export function DataGrid({ rows, rawItems = [] }: { rows: ResultRow[]; rawItems?: unknown[] }) {
  const t = useTranslate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({});
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [density, setDensity] = useState<Density>("comfortable");
  const [rowLimit, setRowLimit] = useState<RowLimit>(500);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [densityOpen, setDensityOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedCell, setCopiedCell] = useState<string | null>(null);
  const [inspectedRow, setInspectedRow] = useState<ResultRow | null>(null);
  const [inspectorMode, setInspectorMode] = useState<"structured" | "console" | "raw">("structured");

  const columnNames = useMemo(() => tableColumns(rows), [rows]);
  const data = useMemo(
    () => rowLimit === "all" ? rows : rows.slice(0, rowLimit),
    [rowLimit, rows],
  );
  const columns = useMemo<ColumnDef<ResultRow>[]>(
    () => columnNames.map((column) => ({
      id: column,
      accessorFn: (row) => row[column],
      header: column,
      cell: ({ getValue }) => printableValue(getValue()),
      filterFn: (row, columnId, filterValue) =>
        printableValue(row.getValue(columnId))
          .toLocaleLowerCase()
          .includes(String(filterValue).toLocaleLowerCase()),
      minSize: 120,
      size: Math.min(340, Math.max(160, column.length * 13 + 64)),
      maxSize: 560,
    })),
    [columnNames],
  );

  useEffect(() => {
    setColumnOrder((current) => {
      const kept = current.filter((id) => columnNames.includes(id));
      const added = columnNames.filter((id) => !kept.includes(id));
      return [...kept, ...added];
    });
  }, [columnNames]);

  const table = useReactTable({
    data,
    columns,
    state: {
      globalFilter,
      sorting,
      columnFilters,
      columnVisibility,
      columnOrder,
      rowSelection,
    },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    globalFilterFn: (row, _columnId, value) =>
      Object.values(row.original).some((entry) =>
        printableValue(entry)
          .toLocaleLowerCase()
          .includes(String(value).toLocaleLowerCase()),
      ),
    columnResizeMode: "onChange",
    enableRowSelection: true,
  });

  const visibleRows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT[density],
    overscan: 12,
  });
  useEffect(() => virtualizer.measure(), [density, virtualizer]);

  const focusGridCell = useCallback((rowIndex: number, columnIndex: number) => {
    const safeRow = Math.min(Math.max(0, rowIndex), Math.max(0, visibleRows.length - 1));
    const safeColumn = Math.min(
      Math.max(0, columnIndex),
      Math.max(0, table.getVisibleLeafColumns().length - 1),
    );
    virtualizer.scrollToIndex(safeRow, { align: "auto" });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollRef.current
          ?.querySelector<HTMLButtonElement>(
            `[data-grid-row="${safeRow}"][data-grid-column="${safeColumn}"]`,
          )
          ?.focus();
      });
    });
  }, [table, virtualizer, visibleRows.length]);

  const handleCellKeyDown = useCallback(async (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    rowIndex: number,
    columnIndex: number,
    value: unknown,
    cellId: string,
  ) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "c") {
      event.preventDefault();
      await navigator.clipboard.writeText(printableValue(value));
      setCopiedCell(cellId);
      window.setTimeout(() => setCopiedCell((current) => current === cellId ? null : current), 1_200);
      return;
    }
    const movement: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusGridCell(rowIndex, event.key === "Home" ? 0 : table.getVisibleLeafColumns().length - 1);
      return;
    }
    const delta = movement[event.key];
    if (!delta) return;
    event.preventDefault();
    focusGridCell(rowIndex + delta[0], columnIndex + delta[1]);
  }, [focusGridCell, table]);

  const copyRows = useCallback(async () => {
    const selected = table.getSelectedRowModel().rows;
    const source = selected.length > 0 ? selected : visibleRows;
    const visibleColumns = table.getVisibleLeafColumns();
    const text = [
      visibleColumns.map((column) => column.id).join("\t"),
      ...source.map((row) =>
        visibleColumns
          .map((column) => escapeTsv(row.original[column.id]))
          .join("\t"),
      ),
    ].join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }, [table, visibleRows]);

  const moveColumn = (id: string, direction: -1 | 1) => {
    setColumnOrder((current) => {
      const source = current.length > 0 ? current : columnNames;
      const from = source.indexOf(id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= source.length) return source;
      const next = [...source];
      [next[from], next[to]] = [next[to]!, next[from]!];
      return next;
    });
  };

  const gridWidth = table.getTotalSize() + 44;
  const inspectRow = (row: ResultRow) => {
    setInspectedRow(row);
    setInspectorMode("structured");
  };
  const inspectedRawItem = inspectedRow
    ? rawItems[Math.max(0, Number(inspectedRow["#"] ?? 1) - 1)] ?? inspectedRow
    : null;
  const inspectedColumns = inspectedRow ? tableColumns([inspectedRow]) : [];
  const inspectedRawJson = useMemo(() => {
    if (inspectedRawItem === null) return "";
    try {
      return JSON.stringify(inspectedRawItem, null, 2);
    } catch {
      return String(inspectedRawItem);
    }
  }, [inspectedRawItem]);

  return (
    <div
      className={`data-grid density-${density}`}
      role="region"
      aria-label={t("查询结果数据表格", "Query result data grid")}
    >
      <div className="data-grid-toolbar">
        <label className="data-grid-search">
          <Search size={16} />
          <input
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            placeholder={t("筛选当前结果", "Filter current results")}
            aria-label={t("筛选当前结果", "Filter current results")}
          />
          {globalFilter && (
            <button type="button" onClick={() => setGlobalFilter("")} aria-label={t("清除筛选", "Clear filter")}>
              <X size={14} />
            </button>
          )}
        </label>

        <span className="data-grid-count">
          {t(
            `${visibleRows.length} / ${rows.length} 行`,
            `${visibleRows.length} / ${rows.length} rows`,
          )}
        </span>

        <div className="data-grid-menu-wrap">
          <button type="button" className="data-grid-tool" onClick={() => setColumnsOpen((value) => !value)}>
            <Columns3 size={16} />
            {t("列", "Columns")}
            <ChevronDown size={14} />
          </button>
          {columnsOpen && (
            <div className="data-grid-popover column-manager">
              <header>
                <strong>{t("管理列", "Manage columns")}</strong>
                <button type="button" onClick={() => table.toggleAllColumnsVisible(true)}>{t("全部显示", "Show all")}</button>
              </header>
              <div>
                {table.getAllLeafColumns().map((column, index, list) => (
                  <div className="column-manager-row" key={column.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={column.getIsVisible()}
                        onChange={column.getToggleVisibilityHandler()}
                      />
                      <span>{column.id}</span>
                    </label>
                    <div>
                      <button type="button" disabled={index === 0} onClick={() => moveColumn(column.id, -1)} aria-label={t("向左移动", "Move left")}><ArrowLeft size={14} /></button>
                      <button type="button" disabled={index === list.length - 1} onClick={() => moveColumn(column.id, 1)} aria-label={t("向右移动", "Move right")}><ArrowRight size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="data-grid-menu-wrap">
          <button type="button" className="data-grid-tool" onClick={() => setDensityOpen((value) => !value)}>
            <Rows3 size={16} />
            {t("密度", "Density")}
            <ChevronDown size={14} />
          </button>
          {densityOpen && (
            <div className="data-grid-popover density-menu">
              {(["compact", "comfortable", "spacious"] as Density[]).map((value) => (
                <button type="button" key={value} onClick={() => { setDensity(value); setDensityOpen(false); }}>
                  <span>{t(
                    value === "compact" ? "紧凑" : value === "comfortable" ? "舒适" : "宽松",
                    value === "compact" ? "Compact" : value === "comfortable" ? "Comfortable" : "Spacious",
                  )}</span>
                  {density === value && <Check size={15} />}
                </button>
              ))}
            </div>
          )}
        </div>

        <label className="data-grid-limit">
          <span>{t("载入", "Load")}</span>
          <select value={rowLimit} onChange={(event) => setRowLimit(event.target.value === "all" ? "all" : Number(event.target.value) as RowLimit)}>
            <option value={100}>100</option>
            <option value={500}>500</option>
            <option value={1000}>1,000</option>
            <option value="all">{t("全部", "All")}</option>
          </select>
        </label>

        <button type="button" className="data-grid-tool" onClick={() => void copyRows()}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied
            ? t("已复制", "Copied")
            : Object.keys(rowSelection).length > 0
              ? t("复制选中行", "Copy selected")
              : t("复制结果", "Copy results")}
        </button>
      </div>

      <div
        className="data-grid-scroll"
        ref={scrollRef}
        role="grid"
        aria-rowcount={visibleRows.length + 1}
        aria-colcount={table.getVisibleLeafColumns().length + 1}
        aria-multiselectable="true"
      >
        <div className="data-grid-canvas" style={{ width: gridWidth, minWidth: "100%" }}>
          <div className="data-grid-header" style={{ width: gridWidth }} role="row">
            <div className="data-grid-select-cell" role="columnheader" aria-label={t("选择", "Select")}>
              <input
                type="checkbox"
                checked={table.getIsAllRowsSelected()}
                ref={(element) => { if (element) element.indeterminate = table.getIsSomeRowsSelected(); }}
                onChange={table.getToggleAllRowsSelectedHandler()}
                aria-label={t("选择全部结果", "Select all results")}
              />
            </div>
            {table.getHeaderGroups()[0]?.headers.map((header) => (
              <div
                className="data-grid-heading"
                key={header.id}
                style={{ width: header.getSize() }}
                role="columnheader"
                aria-sort={header.column.getIsSorted() === "asc" ? "ascending" : header.column.getIsSorted() === "desc" ? "descending" : "none"}
              >
                <button type="button" onClick={header.column.getToggleSortingHandler()}>
                  <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                  {header.column.getIsSorted() === "asc"
                    ? <ArrowUp size={13} />
                    : header.column.getIsSorted() === "desc"
                      ? <ArrowDown size={13} />
                      : <ArrowUpDown size={13} />}
                </button>
                <input
                  value={(header.column.getFilterValue() ?? "") as string}
                  onChange={(event) => header.column.setFilterValue(event.target.value)}
                  placeholder={t("筛选", "Filter")}
                  aria-label={t(`筛选 ${header.column.id}`, `Filter ${header.column.id}`)}
                />
                <span
                  className={`data-grid-resizer ${header.column.getIsResizing() ? "is-resizing" : ""}`}
                  onDoubleClick={() => header.column.resetSize()}
                  onMouseDown={header.getResizeHandler()}
                  onTouchStart={header.getResizeHandler()}
                />
              </div>
            ))}
          </div>

          <div className="data-grid-rows" style={{ height: virtualizer.getTotalSize(), width: gridWidth }} role="rowgroup">
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = visibleRows[virtualRow.index]!;
              return (
                <div
                  className={`data-grid-row ${row.getIsSelected() ? "is-selected" : ""}`}
                  key={row.id}
                  style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)`, width: gridWidth }}
                  onDoubleClick={() => inspectRow(row.original)}
                  role="row"
                  aria-rowindex={virtualRow.index + 2}
                  aria-selected={row.getIsSelected()}
                >
                  <div className="data-grid-select-cell" role="gridcell" aria-colindex={1}>
                    <input type="checkbox" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} aria-label={t(`选择第 ${virtualRow.index + 1} 行`, `Select row ${virtualRow.index + 1}`)} />
                  </div>
                  {row.getVisibleCells().map((cell, columnIndex) => (
                    <button
                      type="button"
                      className={`data-grid-cell ${copiedCell === cell.id ? "is-copied" : ""}`}
                      key={cell.id}
                      style={{ width: cell.column.getSize() }}
                      title={printableValue(cell.getValue())}
                      onClick={() => inspectRow(row.original)}
                      onKeyDown={(event) => void handleCellKeyDown(
                        event,
                        virtualRow.index,
                        columnIndex,
                        cell.getValue(),
                        cell.id,
                      )}
                      data-grid-row={virtualRow.index}
                      data-grid-column={columnIndex}
                      role="gridcell"
                      aria-colindex={columnIndex + 2}
                      aria-label={`${cell.column.id}: ${printableValue(cell.getValue())}`}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      {copiedCell === cell.id && <span className="data-grid-cell-copied"><Check size={12} /> {t("已复制", "Copied")}</span>}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {inspectedRow && (
        <aside className="data-grid-inspector" aria-label={t("行详情", "Row details")}>
          <header>
            <div>
              <span className="eyebrow">ROW DETAIL</span>
              <strong>{
                inspectorMode === "structured"
                  ? t("结构化行详情", "Structured row details")
                  : inspectorMode === "console"
                    ? t("控制台行输出", "Console row output")
                    : t("原始响应数据", "Original response data")
              }</strong>
            </div>
            <div className="data-grid-inspector-actions">
              <div role="tablist" aria-label={t("详情显示方式", "Detail view mode")}>
                <button type="button" role="tab" aria-selected={inspectorMode === "structured"} className={inspectorMode === "structured" ? "is-active" : ""} onClick={() => setInspectorMode("structured")}>{t("结构化", "Structured")}</button>
                <button type="button" role="tab" aria-selected={inspectorMode === "console"} className={inspectorMode === "console" ? "is-active" : ""} onClick={() => setInspectorMode("console")}>{t("控制台", "Console")}</button>
                <button type="button" role="tab" aria-selected={inspectorMode === "raw"} className={inspectorMode === "raw" ? "is-active" : ""} onClick={() => setInspectorMode("raw")}>{t("原始", "Original")}</button>
              </div>
              <button type="button" onClick={() => setInspectedRow(null)} aria-label={t("关闭详情", "Close details")}><X size={17} /></button>
            </div>
          </header>
          {inspectorMode === "structured" ? (
            <dl>
              {inspectedColumns.map((key) => (
                <div key={key}>
                  <dt title={key}>{key}</dt>
                  <dd>{printableValue(inspectedRow[key])}</dd>
                </div>
              ))}
            </dl>
          ) : inspectorMode === "console" ? (
            <pre className="data-grid-inspector-raw">{gremlinConsoleOutput([inspectedRawItem])}</pre>
          ) : (
            <pre className="data-grid-inspector-raw is-source">{inspectedRawJson}</pre>
          )}
        </aside>
      )}
    </div>
  );
}
