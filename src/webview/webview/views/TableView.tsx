import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { ViewProps, Highlight, coerce, matchSearch, setByPath, deleteByPath } from './viewUtils';
import { csvParse, csvStringify } from '../../common/csv';
import { useVSCodeBridge } from '../hooks/useVSCodeBridge';

/**
 * 表格视图：
 *  - 对象数组 → 行列表；普通对象 → K/V 两列
 *  - 对象数组支持 CSV 导入 / 导出
 *  - 单元格中的对象 / 数组可点击 ▶ 展开为嵌套子表格（递归）
 */
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 10;
const SUB_ROW_FOLD_LIMIT = 20; // 子表超过该行数时折叠
const LONG_TEXT_THRESHOLD = 20; // 超过该字符数的单元值启用换行 + tooltip
const INDEX_COL_WIDTH = 44; // '#' 序号列宽度（px）
const CELL_MIN_WIDTH = 80; // 普通列最小宽（px）
const CELL_MAX_WIDTH = 640; // 普通列初始估算上限（px）；用户仍可拖动突破

type Path = (string | number)[];

export const TableView: React.FC<ViewProps> = ({ data, search, onChange, onError }) => {
  const info = useMemo(() => analyze(data), [data]);
  const { exportCsv, importCsv } = useVSCodeBridge();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const { styleFor: rowStyleFor, setHeight: setRowHeight } = useRowHeights();
  // 顶层 KV 分支的 Key 列宽（即使当前数据不是 KV，hook 也必须无条件调用以遵守 React hooks 规则）
  const { widthOf: kvKeyColWidthOf, setWidth: setKvKeyColWidth } = useColumnWidths({ __key__: 220 });
  // 顶层 primitive-array 分支的 Value 列宽
  const { widthOf: paValueColWidthOf, setWidth: setPaValueColWidth } = useColumnWidths({ __value__: 320 });

  // 嵌套路径展开集合，key 为 path.join('\u0001')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // 单元格强制重置计数：当用户在类型不匹配提示中选择"取消"时递增，
  // 通过拼入 Cell key 让输入框重新挂载、回显原值。
  const [cellResetTick, setCellResetTick] = useState(0);
  const toggleExpand = useCallback((path: Path) => {
    const key = pathKey(path);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const isExpanded = useCallback((path: Path) => expanded.has(pathKey(path)), [expanded]);

  // 根级 setter，按路径不可变回写
  const setAtPath = useCallback(
    (path: Path, value: unknown) => {
      if (path.length === 0) {
        onChange(value);
        return;
      }
      onChange(setByPath(data as any, path, value));
    },
    [data, onChange],
  );

  // 根级按路径删除：数组 splice，对象 delete key
  const deleteAtPath = useCallback(
    (path: Path) => {
      if (path.length === 0) return;
      onChange(deleteByPath(data as any, path));
    },
    [data, onChange],
  );

  // 用新子树替换指定 path（path 为空时替换根）
  const replaceSubtree = useCallback(
    (path: Path, nextSubtree: unknown) => {
      if (path.length === 0) {
        onChange(nextSubtree);
        return;
      }
      onChange(setByPath(data as any, path, nextSubtree));
    },
    [data, onChange],
  );

  if (info.kind === 'unsupported') {
    return <div className="jr-empty">Table view requires an array of objects or a plain object.</div>;
  }

  // 基本值数组 / 混合数组 → 单列表（# / Value）
  // 使用 NestedRow 以便复杂元素（嵌套数组 / 对象）能点击 ▶ 展开为子表，
  // 与子表 SubPrimitiveArray 的交互保持一致。
  if (info.kind === 'primitive-array') {
    const list = data as unknown[];
    const filtered = list
      .map((v, i) => ({ v, i }))
      .filter(({ v, i }) => !search || matchSearch(String(i), search) || hasDeepMatch(v, search));
    const handleAppend = () => replaceSubtree([], [...list, '']);
    const handleInsertAfter = (i: number) => {
      const next = list.slice();
      next.splice(i + 1, 0, '');
      replaceSubtree([], next);
    };
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="jr-badge">{list.length} items</span>
          {list.length === 0 && (
            <button className="jr-tab" onClick={handleAppend} title="Append a new item">➕ Add item</button>
          )}
        </div>
        <div className="jr-table-scroll">
        <table className="jr-table jr-table-resizable">
          <colgroup>
            <col style={{ width: INDEX_COL_WIDTH }} />
            <col style={{ width: paValueColWidthOf('__value__') ?? 320 }} />
            <col style={{ width: 96 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="jr-col-index">#</th>
              <th className="jr-th-resizable">
                <span className="jr-th-label">Value</span>
                <ColResizer
                  colKey="__value__"
                  getWidth={() => paValueColWidthOf('__value__') ?? 320}
                  onResize={setPaValueColWidth}
                />
              </th>
              <th className="jr-col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ v, i }) => (
              <NestedRow
                key={i}
                labelCol={i}
                indexLabel
                value={v}
                path={[i]}
                search={search}
                isExpanded={isExpanded}
                toggleExpand={toggleExpand}
                setAtPath={setAtPath}
                deleteAtPath={deleteAtPath}
                onError={onError}
                columnCount={3}
                showActions
                onInsertAfter={() => handleInsertAfter(i)}
                rowId={`top-pa-${i}`}
                rowStyle={rowStyleFor(`top-pa-${i}`)}
                onResizeRow={setRowHeight}
              />
            ))}
          </tbody>
        </table>
        </div>
      </div>
    );
  }

  if (info.kind === 'kv') {
    const entries = Object.entries(data as Record<string, unknown>);
    const filtered = entries.filter(([k, v]) =>
      !search || matchSearch(k, search) || hasDeepMatch(v, search),
    );
    const handleAddKey = () => {
      const key = window.prompt('New key name:');
      if (key === null) return;
      const k = key.trim();
      if (!k) return;
      if (Object.prototype.hasOwnProperty.call(data as object, k)) {
        window.alert(`Key "${k}" already exists.`);
        return;
      }
      replaceSubtree([], { ...(data as Record<string, unknown>), [k]: '' });
    };
    return (
      <div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="jr-tab" onClick={handleAddKey} title="Add a new key">➕ Add key</button>
          <span className="jr-badge">{entries.length} keys</span>
        </div>
        <div className="jr-table-scroll">
        <table className="jr-table jr-table-resizable">
          <colgroup>
            <col style={{ width: kvKeyColWidthOf('__key__') ?? 220 }} />
            <col />
            <col style={{ width: 96 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="jr-th-resizable">
                <span className="jr-th-label">Key</span>
                <ColResizer
                  colKey="__key__"
                  getWidth={() => kvKeyColWidthOf('__key__') ?? 220}
                  onResize={setKvKeyColWidth}
                />
              </th>
              <th>Value</th>
              <th className="jr-col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(([k, v]) => (
              <NestedRow
                key={k}
                labelCol={<Highlight text={k} search={search} />}
                value={v}
                path={[k]}
                search={search}
                isExpanded={isExpanded}
                toggleExpand={toggleExpand}
                setAtPath={setAtPath}
                deleteAtPath={deleteAtPath}
                onError={onError}
                columnCount={3}
                showActions
                onInsertAfter={handleAddKey}
                rowId={`top-kv-${k}`}
                rowStyle={rowStyleFor(`top-kv-${k}`)}
                onResizeRow={setRowHeight}
              />
            ))}
          </tbody>
        </table>
        </div>
      </div>
    );
  }

  // array of objects
  const rows = data as Record<string, unknown>[];
  const columns = info.columns!;

  // 每列最大字符数 → 估算宽度（px）
  const columnWidths = useMemo(() => {
    const widths: Record<string, number> = {};
    for (const c of columns) {
      widths[c] = estimateColumnWidth(c, rows.map((r) => r[c]));
    }
    return widths;
  }, [columns, rows]);

  // 列宽可拖动：允许用户用鼠标手动调整
  const { widthOf: topColWidthOf, setWidth: setTopColWidth } = useColumnWidths(columnWidths);

  // 每列独立的搜索输入：key '#' 表示按行号过滤；其余 key 为列名
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const activeFilterCount = useMemo(
    () => Object.values(columnFilters).filter((v) => v.trim() !== '').length,
    [columnFilters],
  );
  const setColumnFilter = useCallback((col: string, val: string) => {
    setColumnFilters((prev) => {
      if ((prev[col] ?? '') === val) return prev;
      return { ...prev, [col]: val };
    });
    setPage(1);
  }, []);
  const clearColumnFilters = useCallback(() => {
    setColumnFilters({});
    setPage(1);
  }, []);

  const filteredRows = useMemo(
    () =>
      rows
        .map((r, i) => ({ r, i }))
        .filter(({ r, i }) => {
          // 1) 顶部全局 search（行级 OR 命中）
          if (search) {
            const globalHit =
              matchSearch(String(i), search) || columns.some((c) => hasDeepMatch(r[c], search));
            if (!globalHit) return false;
          }
          // 2) 按列过滤（AND）
          for (const [col, raw] of Object.entries(columnFilters)) {
            const q = raw.trim();
            if (!q) continue;
            const val = col === '#' ? i : r[col];
            if (!matchColumn(val, q)) return false;
          }
          return true;
        }),
    [rows, columns, search, columnFilters],
  );

  const total = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // 搜索 / 数据 / pageSize 变化时修正当前页，避免越界
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
    if (page < 1) setPage(1);
  }, [page, totalPages]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  const handleExport = () => {
    const csv = csvStringify(rows);
    exportCsv(csv, 'data.csv');
  };

  const handleImport = async () => {
    const { rows: imported, error } = await importCsv();
    if (error) { alert(`Import failed: ${error}`); return; }
    if (!imported) return;
    const sample = rows[0] ?? {};
    const next = imported.map((r) => {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        obj[k] = k in sample ? coerce(v, (sample as any)[k]) : tryCoerce(v);
      }
      return obj;
    });
    onChange(next);
  };

  const colCount = columns.length + 1 + 1; // '#' + columns + 操作

  const handleAppendRow = () => {
    const empty: Record<string, unknown> = {};
    columns.forEach((c) => { empty[c] = ''; });
    onChange([...rows, empty]);
  };

  const handleInsertRowAfter = (i: number) => {
    const empty: Record<string, unknown> = {};
    columns.forEach((c) => { empty[c] = ''; });
    const next = rows.slice();
    next.splice(i + 1, 0, empty);
    onChange(next);
  };

  /**
   * 行内字段赋值时：
   *  1) 保证最终对象 key 顺序与表头 columns 一致；
   *  2) 若写入值是字符串，但该列已存在非字符串类型样本（如 number / boolean / null），
   *     按列主导类型对新值进行类型转换；
   *  3) 若无法转换（如 number 列输入 "abc"），弹窗提示用户确认：
   *     - 用户选择"确定"→ 强制按字符串保存（可能破坏列类型一致性，由用户负责）；
   *     - 用户选择"取消"→ 放弃本次写入，并递增 cellResetTick 让输入框回显原值。
   * 仅作用于 path = [rowIndex, fieldName] 的行字段直接赋值场景。
   */
  const setAtPathOrdered = useCallback(
    (path: Path, value: unknown) => {
      if (path.length >= 2 && typeof path[0] === 'number' && typeof path[1] === 'string') {
        const rowIdx = path[0] as number;
        const fieldName = path[1] as string;
        const row = rows[rowIdx];
        if (row && typeof row === 'object' && !Array.isArray(row)) {
          // —— 类型推断 + 校验：仅在值是字符串且是直接字段（path.length === 2）时尝试
          let finalValue: unknown = value;
          if (path.length === 2 && typeof value === 'string') {
            const colType = inferColumnType(rows, fieldName);
            if (colType && colType !== 'string') {
              const result = coerceByType(value, colType);
              if (!result.ok) {
                // 类型不匹配：弹窗让用户确认
                const typeLabel =
                  colType === 'number' ? '数值 (number)'
                    : colType === 'boolean' ? '布尔 (true/false)'
                    : colType === 'null' ? '空值 (null)'
                    : '字符串';
                const msg =
                  `列 "${fieldName}" 的类型为 ${typeLabel}，但你输入的 "${value}" 无法转换为该类型。\n\n`
                  + `点击「确定」将按字符串强制保存（可能破坏类型一致性）；\n`
                  + `点击「取消」将放弃本次修改。`;
                const confirmed = window.confirm(msg);
                if (!confirmed) {
                  // 取消：放弃写入，强制重置单元格输入框
                  setCellResetTick((t) => t + 1);
                  return;
                }
                // 确认强制保存字符串
                finalValue = value;
              } else {
                finalValue = result.value;
              }
            }
          }
          // 常规写入
          const afterWrite = setByPath(data as any, path, finalValue) as any[];
          const writtenRow = afterWrite[rowIdx] as Record<string, unknown>;
          // 按 columns 顺序重建该行对象，columns 之外的 key 追加在后（保留原相对顺序）
          const reordered: Record<string, unknown> = {};
          for (const c of columns) {
            if (c in writtenRow) reordered[c] = writtenRow[c];
          }
          for (const k of Object.keys(writtenRow)) {
            if (!(k in reordered)) reordered[k] = writtenRow[k];
          }
          const nextRows = afterWrite.slice();
          nextRows[rowIdx] = reordered;
          onChange(nextRows);
          return;
        }
      }
      // 其他路径（嵌套子表 / 非对象行等）走通用逻辑
      if (path.length === 0) { onChange(value); return; }
      onChange(setByPath(data as any, path, value));
    },
    [data, rows, columns, onChange],
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="jr-tab" onClick={handleExport}>📤 Export CSV</button>
        <button className="jr-tab" onClick={handleImport}>📥 Import CSV</button>
        <span className="jr-badge">{rows.length} rows · {columns.length} cols</span>
        {activeFilterCount > 0 && (
          <button
            className="jr-tab"
            onClick={clearColumnFilters}
            title="Clear all column filters"
          >
            ✕ Clear filters ({activeFilterCount})
          </button>
        )}
        {rows.length === 0 && (
          <button className="jr-tab" onClick={handleAppendRow} title="Append a new row">➕ Add row</button>
        )}
      </div>
      <div className="jr-table-scroll">
      <table className="jr-table jr-table-resizable">
        <colgroup>
          <col style={{ width: INDEX_COL_WIDTH }} />
          {columns.map((c) => (
            <col key={c} style={{ width: topColWidthOf(c) ?? columnWidths[c] }} />
          ))}
          <col style={{ width: 96 }} />
        </colgroup>
        <thead>
          <tr>
            <th className="jr-col-index">#</th>
            {columns.map((c) => (
              <th key={c} className="jr-th-resizable">
                <span className="jr-th-label"><Highlight text={c} search={search} /></span>
                <ColResizer
                  colKey={c}
                  getWidth={() => topColWidthOf(c) ?? columnWidths[c]}
                  onResize={setTopColWidth}
                />
              </th>
            ))}
            <th className="jr-col-actions">操作</th>
          </tr>
          <tr className="jr-col-filter-row">
            <th>
              <input
                className="jr-col-filter"
                type="text"
                value={columnFilters['#'] ?? ''}
                placeholder="filter #"
                onChange={(e) => setColumnFilter('#', e.target.value)}
                title="Filter by row index. Supports =, >, <, >=, <="
              />
            </th>
            {columns.map((c) => (
              <th key={c}>
                <input
                  className="jr-col-filter"
                  type="text"
                  value={columnFilters[c] ?? ''}
                  placeholder={`filter ${c}`}
                  onChange={(e) => setColumnFilter(c, e.target.value)}
                  title={`Filter ${c}. Supports substring & =, >, <, >=, <= for numbers`}
                />
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {pagedRows.map(({ r, i }) => (
            <RowGroup
              key={`${i}::${cellResetTick}`}
              rowIndex={i}
              row={r}
              columns={columns}
              search={search}
              isExpanded={isExpanded}
              toggleExpand={toggleExpand}
              setAtPath={setAtPathOrdered}
              deleteAtPath={deleteAtPath}
              onError={onError}
              colCount={colCount}
              showActions
              pathPrefix={[]}
              onInsertAfter={() => handleInsertRowAfter(i)}
              rowId={`top-aoo-${i}`}
              rowStyle={rowStyleFor(`top-aoo-${i}`)}
              onResizeRow={setRowHeight}
            />
          ))}
        </tbody>
      </table>
      </div>
      <div className="jr-pagination">
        <span className="jr-page-info">
          {total === 0 ? '0 of 0' : `${rangeStart}-${rangeEnd} of ${total}`}
        </span>
        <button className="jr-tab" disabled={page <= 1} onClick={() => setPage(1)} title="First">⏮</button>
        <button className="jr-tab" disabled={page <= 1} onClick={() => setPage(page - 1)} title="Prev">◀</button>
        <span className="jr-page-info">
          Page
          <input
            className="jr-page-input"
            type="number"
            min={1}
            max={totalPages}
            value={page}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v)) setPage(Math.min(Math.max(1, v), totalPages));
            }}
          />
          / {totalPages}
        </span>
        <button className="jr-tab" disabled={page >= totalPages} onClick={() => setPage(page + 1)} title="Next">▶</button>
        <button className="jr-tab" disabled={page >= totalPages} onClick={() => setPage(totalPages)} title="Last">⏭</button>
        <label className="jr-page-info">
          Rows/page:
          <select
            className="jr-page-select"
            value={pageSize}
            onChange={(e) => {
              const nextSize = Number(e.target.value);
              const firstIndex = (page - 1) * pageSize;
              setPageSize(nextSize);
              setPage(Math.floor(firstIndex / nextSize) + 1);
            }}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
};

/* ---------------- 顶层数组行：主行 + 展开时的子行 ---------------- */

interface RowGroupProps {
  rowIndex: number;
  row: Record<string, unknown>;
  columns: string[];
  search: string;
  isExpanded: (path: Path) => boolean;
  toggleExpand: (path: Path) => void;
  setAtPath: (path: Path, value: unknown) => void;
  deleteAtPath?: (path: Path) => void;
  onError: (msg: string) => void;
  colCount: number;
  /** 是否显示"操作"列（➕ 插入下一行 / 🗑 删除） */
  showActions?: boolean;
  /** path 偏移：子表传入 [...parentPath] 以便删除时组成绝对路径 */
  pathPrefix?: Path;
  /** 点击 ➕ 时在该行之后插入一行（由父组件决定如何插入） */
  onInsertAfter?: () => void;
  /** 行高拖拽：唯一行 id（启用时生效） */
  rowId?: string;
  /** 行高 style（由 useRowHeights 提供） */
  rowStyle?: React.CSSProperties;
  /** 行高变化回调 */
  onResizeRow?: (id: string, h: number) => void;
}

const RowGroup: React.FC<RowGroupProps> = ({
  rowIndex, row, columns, search, isExpanded, toggleExpand, setAtPath, deleteAtPath,
  onError, colCount, showActions, pathPrefix = [], onInsertAfter,
  rowId, rowStyle, onResizeRow,
}) => {
  return (
    <>
      <tr style={rowStyle} className={rowStyle ? 'jr-row-resized' : undefined}>
        <td className="jr-col-index">{rowIndex}</td>
        {columns.map((c) => {
          const v = row[c];
          const cellPath: Path = [rowIndex, c];
          const cellText = stringifyCell(v);
          const textLen = cellText.length;
          const longCls = textLen > LONG_TEXT_THRESHOLD ? ' jr-td-long' : '';
          const cellTitle = textLen > LONG_TEXT_THRESHOLD ? cellText : undefined;
          return (
            <td key={c} className={`jr-td${longCls}`} title={cellTitle}>
              <Cell
                value={v}
                path={cellPath}
                search={search}
                isExpanded={isExpanded}
                toggleExpand={toggleExpand}
                setAtPath={setAtPath}
                onError={onError}
              />
            </td>
          );
        })}
        {showActions && (
          <td className="jr-cell-actions">
            <button
              className="jr-row-add"
              title="Insert a new row below"
              onClick={() => onInsertAfter && onInsertAfter()}
            >➕</button>
            <button
              className="jr-row-del"
              title="Delete this row"
              onClick={() => deleteAtPath && deleteAtPath([...pathPrefix, rowIndex])}
            >🗑</button>
            {rowId && onResizeRow && (
              <RowResizer rowId={rowId} onResize={onResizeRow} />
            )}
          </td>
        )}
      </tr>
      {columns.map((c) => {
        const v = row[c];
        const cellPath: Path = [rowIndex, c];
        if (!isComplex(v) || !isExpanded(cellPath)) return null;
        return (
          <tr key={`sub-${c}`} className="jr-subrow">
            <td />
            <td colSpan={colCount - 1} className="jr-subcell">
              <div className="jr-sub-title-inline">
                <span className="jr-sub-path">↳ {c}</span>
              </div>
              <SubTable
                data={v}
                path={[...pathPrefix, rowIndex, c]}
                search={search}
                isExpanded={isExpanded}
                toggleExpand={toggleExpand}
                setAtPath={setAtPath}
                deleteAtPath={deleteAtPath}
                onError={onError}
              />
            </td>
          </tr>
        );
      })}
    </>
  );
};

/* ---------------- KV 表行（用于根级普通对象 & 递归子对象） ---------------- */

interface NestedRowProps {
  labelCol: React.ReactNode;
  value: unknown;
  path: Path;
  search: string;
  isExpanded: (path: Path) => boolean;
  toggleExpand: (path: Path) => void;
  setAtPath: (path: Path, value: unknown) => void;
  deleteAtPath?: (path: Path) => void;
  onError: (msg: string) => void;
  columnCount: number;
  /** 是否显示"操作"列（➕ 插入下一行 / 🗑 删除） */
  showActions?: boolean;
  /** 点击 ➕ 时如何在当前条目之后插入（KV 场景会 prompt key；数组场景直接 splice） */
  onInsertAfter?: () => void;
  /** 当 labelCol 是"序号"时为 true（列宽更窄） */
  indexLabel?: boolean;
  /** 行高拖拽：唯一行 id（启用时生效） */
  rowId?: string;
  rowStyle?: React.CSSProperties;
  onResizeRow?: (id: string, h: number) => void;
}

const NestedRow: React.FC<NestedRowProps> = ({
  labelCol, value, path, search, isExpanded, toggleExpand, setAtPath, deleteAtPath,
  onError, columnCount, showActions, onInsertAfter, indexLabel,
  rowId, rowStyle, onResizeRow,
}) => {
  const expanded = isComplex(value) && isExpanded(path);
  const cellText = stringifyCell(value);
  const textLen = cellText.length;
  const longCls = textLen > LONG_TEXT_THRESHOLD ? ' jr-td-long' : '';
  const cellTitle = textLen > LONG_TEXT_THRESHOLD ? cellText : undefined;
  return (
    <>
      <tr style={rowStyle} className={rowStyle ? 'jr-row-resized' : undefined}>
        <td className={indexLabel ? 'jr-col-index' : undefined}>{labelCol}</td>
        <td className={`jr-td${longCls}`} title={cellTitle}>
          <Cell
            value={value}
            path={path}
            search={search}
            isExpanded={isExpanded}
            toggleExpand={toggleExpand}
            setAtPath={setAtPath}
            onError={onError}
          />
        </td>
        {showActions && (
          <td className="jr-cell-actions">
            <button
              className="jr-row-add"
              title="Insert below"
              onClick={() => onInsertAfter && onInsertAfter()}
            >➕</button>
            <button
              className="jr-row-del"
              title="Delete"
              onClick={() => deleteAtPath && deleteAtPath(path)}
            >🗑</button>
            {rowId && onResizeRow && (
              <RowResizer rowId={rowId} onResize={onResizeRow} />
            )}
          </td>
        )}
      </tr>
      {expanded && (
        <tr className="jr-subrow">
          <td />
          <td colSpan={columnCount - 1} className="jr-subcell">
            <SubTable
              data={value}
              path={path}
              search={search}
              isExpanded={isExpanded}
              toggleExpand={toggleExpand}
              setAtPath={setAtPath}
              deleteAtPath={deleteAtPath}
              onError={onError}
            />
          </td>
        </tr>
      )}
    </>
  );
};

/* ---------------- 单元格：primitive → input，object/array → ▶ 徽章 ---------------- */

interface CellProps {
  value: unknown;
  path: Path;
  search: string;
  isExpanded: (path: Path) => boolean;
  toggleExpand: (path: Path) => void;
  setAtPath: (path: Path, value: unknown) => void;
  onError: (msg: string) => void;
}

const Cell: React.FC<CellProps> = ({ value, path, search, isExpanded, toggleExpand, setAtPath }) => {
  if (isPrimitive(value)) {
    const text = value === undefined || value === null ? '' : String(value);
    const isLong = text.length > LONG_TEXT_THRESHOLD || text.includes('\n');
    if (isLong) {
      return (
        <textarea
          className="jr-cell-input jr-cell-long"
          defaultValue={text}
          key={`${pathKey(path)}::${text}`}
          title={text}
          rows={Math.min(6, Math.max(2, text.split('\n').length))}
          onBlur={(e) => setAtPath(path, coerce(e.target.value, value))}
        />
      );
    }
    return (
      <input
        className="jr-cell-input"
        defaultValue={text}
        key={`${pathKey(path)}::${text}`}
        title={text.length > LONG_TEXT_THRESHOLD ? text : undefined}
        onBlur={(e) => setAtPath(path, coerce(e.target.value, value))}
      />
    );
  }
  const expanded = isExpanded(path);
  const summary = summarize(value);
  const deepHit = search && hasDeepMatch(value, search);
  return (
    <button
      type="button"
      className="jr-nested-toggle"
      onClick={() => toggleExpand(path)}
      title={expanded ? 'Collapse' : `Expand nested · ${summary}`}
    >
      <span className="jr-nested-caret">{expanded ? '▼' : '▶'}</span>
      <span className="jr-nested-summary">{summary}</span>
      {deepHit ? <span className="jr-nested-hit" title="Nested match">🔍</span> : null}
    </button>
  );
};

/* ---------------- 子表：根据子值的类型选择渲染形式 ---------------- */

interface SubTableProps {
  data: unknown;
  path: Path;
  search: string;
  isExpanded: (path: Path) => boolean;
  toggleExpand: (path: Path) => void;
  setAtPath: (path: Path, value: unknown) => void;
  deleteAtPath?: (path: Path) => void;
  onError: (msg: string) => void;
}

const SubTable: React.FC<SubTableProps> = (props) => {
  const { data } = props;

  // 对象数组 → 子表格
  if (
    Array.isArray(data) &&
    data.length > 0 &&
    data.every((x) => x && typeof x === 'object' && !Array.isArray(x))
  ) {
    return <SubArrayOfObjects {...(props as any)} rows={data as Record<string, unknown>[]} />;
  }
  // 基本值数组 → 单列
  if (Array.isArray(data)) {
    return <SubPrimitiveArray {...(props as any)} list={data} />;
  }
  // 普通对象 → KV 子表
  if (data && typeof data === 'object') {
    return <SubObject {...(props as any)} obj={data as Record<string, unknown>} />;
  }
  return null;
};

/** 子表：对象数组。与顶层共享渲染，但不分页；超过 SUB_ROW_FOLD_LIMIT 折叠 */
const SubArrayOfObjects: React.FC<SubTableProps & { rows: Record<string, unknown>[] }> = ({
  rows, path, search, isExpanded, toggleExpand, setAtPath, deleteAtPath, onError,
}) => {
  const columns = useMemo(() => {
    const cols = new Set<string>();
    for (const r of rows) Object.keys(r).forEach((k) => cols.add(k));
    return Array.from(cols);
  }, [rows]);

  const columnWidths = useMemo(() => {
    const w: Record<string, number> = {};
    for (const c of columns) w[c] = estimateColumnWidth(c, rows.map((r) => r[c]));
    return w;
  }, [columns, rows]);

  const { widthOf: subColWidthOf, setWidth: setSubColWidth } = useColumnWidths(columnWidths);

  const { styleFor: rowStyleFor, setHeight: setRowHeight } = useRowHeights();
  const subKey = pathKey(path);

  const [showAll, setShowAll] = useState(false);
  const truncated = !showAll && rows.length > SUB_ROW_FOLD_LIMIT;
  const visible = truncated ? rows.slice(0, SUB_ROW_FOLD_LIMIT) : rows;
  const colCount = columns.length + 1 + (deleteAtPath ? 1 : 0); // # + columns (+ 操作)

  const emptyRow = () => {
    const empty: Record<string, unknown> = {};
    columns.forEach((c) => { empty[c] = ''; });
    return empty;
  };
  const handleInsertAfter = (i: number) => {
    const next = rows.slice();
    next.splice(i + 1, 0, emptyRow());
    setAtPath(path, next);
  };

  return (
    <div className="jr-subtable-wrap">
      <div className="jr-table-scroll">
      <table className="jr-table jr-subtable jr-table-resizable">
        <colgroup>
          <col style={{ width: INDEX_COL_WIDTH }} />
          {columns.map((c) => (
            <col key={c} style={{ width: subColWidthOf(c) ?? columnWidths[c] }} />
          ))}
          {deleteAtPath && <col style={{ width: 96 }} />}
        </colgroup>
        <thead>
          <tr>
            <th className="jr-col-index">#</th>
            {columns.map((c) => (
              <th key={c} className="jr-th-resizable">
                <span className="jr-th-label"><Highlight text={c} search={search} /></span>
                <ColResizer
                  colKey={c}
                  getWidth={() => subColWidthOf(c) ?? columnWidths[c]}
                  onResize={setSubColWidth}
                />
              </th>
            ))}
            {deleteAtPath && <th className="jr-col-actions">操作</th>}
          </tr>
        </thead>
        <tbody>
          {visible.map((r, i) => (
            <RowGroup
              key={i}
              rowIndex={i}
              row={r}
              columns={columns}
              search={search}
              isExpanded={isExpanded}
              toggleExpand={toggleExpand}
              setAtPath={(p, v) => setAtPath([...path, ...p], v)}
              deleteAtPath={deleteAtPath}
              onError={onError}
              colCount={colCount}
              showActions={!!deleteAtPath}
              pathPrefix={path}
              onInsertAfter={() => handleInsertAfter(i)}
              rowId={`${subKey}::${i}`}
              rowStyle={rowStyleFor(`${subKey}::${i}`)}
              onResizeRow={setRowHeight}
            />
          ))}
        </tbody>
      </table>
      </div>
      {truncated && (
        <button className="jr-tab jr-show-more" onClick={() => setShowAll(true)}>
          Show remaining {rows.length - SUB_ROW_FOLD_LIMIT} rows…
        </button>
      )}
    </div>
  );
};

/** 子表：基本值 / 混合数组（单列，复杂元素可展开为子表） */
const SubPrimitiveArray: React.FC<SubTableProps & { list: unknown[] }> = ({
  list, path, search, isExpanded, toggleExpand, setAtPath, deleteAtPath, onError,
}) => {
  const [showAll, setShowAll] = useState(false);
  const truncated = !showAll && list.length > SUB_ROW_FOLD_LIMIT;
  const visible = truncated ? list.slice(0, SUB_ROW_FOLD_LIMIT) : list;
  const { styleFor: rowStyleFor, setHeight: setRowHeight } = useRowHeights();
  const subKey = pathKey(path);
  const handleAppend = () => setAtPath(path, [...list, '']);
  const handleInsertAfter = (i: number) => {
    const next = list.slice();
    next.splice(i + 1, 0, '');
    setAtPath(path, next);
  };

  return (
    <div className="jr-subtable-wrap">
      {deleteAtPath && list.length === 0 && (
        <div className="jr-subtable-toolbar">
          <button className="jr-tab jr-sub-action" onClick={handleAppend} title="Append an item">➕ Add item</button>
        </div>
      )}
      <div className="jr-table-scroll">
      <table className="jr-table jr-subtable">
        <colgroup>
          <col style={{ width: INDEX_COL_WIDTH }} />
          <col />
          {deleteAtPath && <col style={{ width: 96 }} />}
        </colgroup>
        <thead>
          <tr>
            <th className="jr-col-index">#</th>
            <th>Value</th>
            {deleteAtPath && <th className="jr-col-actions">操作</th>}
          </tr>
        </thead>
        <tbody>
          {visible.map((v, i) => (
            <NestedRow
              key={i}
              labelCol={i}
              indexLabel
              value={v}
              path={[...path, i]}
              search={search}
              isExpanded={isExpanded}
              toggleExpand={toggleExpand}
              setAtPath={setAtPath}
              deleteAtPath={deleteAtPath}
              onError={onError}
              columnCount={deleteAtPath ? 3 : 2}
              showActions={!!deleteAtPath}
              onInsertAfter={() => handleInsertAfter(i)}
              rowId={`${subKey}::${i}`}
              rowStyle={rowStyleFor(`${subKey}::${i}`)}
              onResizeRow={setRowHeight}
            />
          ))}
        </tbody>
      </table>
      </div>
      {truncated && (
        <button className="jr-tab jr-show-more" onClick={() => setShowAll(true)}>
          Show remaining {list.length - SUB_ROW_FOLD_LIMIT} items…
        </button>
      )}
    </div>
  );
};

/** 子表：普通对象 KV */
const SubObject: React.FC<SubTableProps & { obj: Record<string, unknown> }> = ({
  obj, path, search, isExpanded, toggleExpand, setAtPath, deleteAtPath, onError,
}) => {
  const entries = Object.entries(obj);
  const { styleFor: rowStyleFor, setHeight: setRowHeight } = useRowHeights();
  const subKey = pathKey(path);
  const handleAddKey = () => {
    const key = window.prompt('New key name:');
    if (key === null) return;
    const k = key.trim();
    if (!k) return;
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      window.alert(`Key "${k}" already exists.`);
      return;
    }
    setAtPath(path, { ...obj, [k]: '' });
  };
  return (
    <div className="jr-subtable-wrap">
      {deleteAtPath && entries.length === 0 && (
        <div className="jr-subtable-toolbar">
          <button className="jr-tab jr-sub-action" onClick={handleAddKey} title="Add a key">➕ Add key</button>
        </div>
      )}
      <div className="jr-table-scroll">
      <table className="jr-table jr-subtable">
        <colgroup>
          <col style={{ width: '28%' }} />
          <col />
          {deleteAtPath && <col style={{ width: 96 }} />}
        </colgroup>
        <thead>
          <tr>
            <th>Key</th>
            <th>Value</th>
            {deleteAtPath && <th className="jr-col-actions">操作</th>}
          </tr>
        </thead>
        <tbody>
          {entries.map(([k, v]) => (
            <NestedRow
              key={k}
              labelCol={<Highlight text={k} search={search} />}
              value={v}
              path={[...path, k]}
              search={search}
              isExpanded={isExpanded}
              toggleExpand={toggleExpand}
              setAtPath={setAtPath}
              deleteAtPath={deleteAtPath}
              onError={onError}
              columnCount={deleteAtPath ? 3 : 2}
              showActions={!!deleteAtPath}
              onInsertAfter={handleAddKey}
              rowId={`${subKey}::${k}`}
              rowStyle={rowStyleFor(`${subKey}::${k}`)}
              onResizeRow={setRowHeight}
            />
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
};

/* ---------------- helpers ---------------- */

function pathKey(p: Path): string {
  return p.join('\u0001');
}

/** 将任意单元格值转为"展示用字符串"，用于估算宽度 / tooltip / 长文本判定 */
function stringifyCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // 对象/数组：走概览，避免 tooltip 里出现整个 JSON 文本
  try { return summarize(v); } catch { return String(v); }
}

/** 估算列宽：按列中最长内容字符数（含表头）换算为像素 */
function estimateColumnWidth(header: string, samples: unknown[]): number {
  let maxLen = header.length;
  for (const v of samples) {
    const s = stringifyCell(v);
    if (s.length > maxLen) maxLen = s.length;
    if (maxLen >= 80) break; // 防止扫描过多
  }
  // 近似：7.2px / 字符 + 16px padding；超过阈值直接封顶换行
  const px = Math.ceil(maxLen * 7.2) + 16;
  return Math.min(Math.max(px, CELL_MIN_WIDTH), CELL_MAX_WIDTH);
}

/** 行高可拖动 hook：管理 rowId → height 的映射 */
function useRowHeights() {
  const [heights, setHeights] = useState<Record<string, number>>({});
  const setHeight = useCallback((id: string, h: number) => {
    setHeights((prev) => ({ ...prev, [id]: Math.max(24, Math.round(h)) }));
  }, []);
  const styleFor = useCallback(
    (id: string): React.CSSProperties | undefined =>
      heights[id] ? { height: heights[id] } : undefined,
    [heights],
  );
  return { styleFor, setHeight };
}

/** 行底部拖拽手柄：在 mousedown 时开始监听 mousemove 调整行高 */
const RowResizer: React.FC<{ rowId: string; onResize: (id: string, h: number) => void }>
  = ({ rowId, onResize }) => {
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 找到所属的 tr 元素
    const tr = (e.currentTarget as HTMLElement).closest('tr') as HTMLTableRowElement | null;
    if (!tr) return;
    const startY = e.clientY;
    const startH = tr.getBoundingClientRect().height;
    const onMove = (ev: MouseEvent) => {
      const next = startH + (ev.clientY - startY);
      onResize(rowId, next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'row-resize';
  }, [rowId, onResize]);
  return (
    <span
      className="jr-row-resizer"
      title="Drag to resize row height"
      onMouseDown={onMouseDown}
    />
  );
};

/** 列宽可拖动 hook：管理 colKey → width 的映射（初始值来自估算） */
function useColumnWidths(initial: Record<string, number>) {
  const [widths, setWidths] = useState<Record<string, number>>(initial);
  const initKey = Object.keys(initial).sort().join('|');
  const initKeyRef = useRef(initKey);
  // 列集合变化时，合并新列的初始宽度（保留用户已拖动过的宽度）
  useEffect(() => {
    if (initKey === initKeyRef.current) return;
    initKeyRef.current = initKey;
    setWidths((prev) => {
      const next: Record<string, number> = { ...prev };
      for (const k of Object.keys(initial)) {
        if (next[k] === undefined) next[k] = initial[k];
      }
      return next;
    });
  }, [initKey, initial]);
  const setWidth = useCallback((key: string, w: number) => {
    setWidths((prev) => ({ ...prev, [key]: Math.max(40, Math.round(w)) }));
  }, []);
  const widthOf = useCallback((key: string): number | undefined => widths[key], [widths]);
  return { widthOf, setWidth };
}

/** 列头右边缘拖拽手柄：按下后根据 mousemove 更新列宽 */
const ColResizer: React.FC<{ colKey: string; getWidth: () => number; onResize: (key: string, w: number) => void }>
  = ({ colKey, getWidth, onResize }) => {
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = getWidth();
    const onMove = (ev: MouseEvent) => {
      onResize(colKey, startW + (ev.clientX - startX));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
  }, [colKey, getWidth, onResize]);
  return (
    <span
      className="jr-col-resizer"
      title="Drag to resize column"
      onMouseDown={onMouseDown}
    />
  );
};

function isPrimitive(v: unknown) {
  return v === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof v);
}

function isComplex(v: unknown) {
  return !isPrimitive(v) && typeof v === 'object';
}

function summarize(v: unknown): string {
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return `[${v.length} objects]`;
    return `[${v.length} items]`;
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as object);
    if (keys.length === 0) return '{}';
    if (keys.length <= 3) return `{ ${keys.join(', ')} }`;
    return `{${keys.length} keys}`;
  }
  return String(v);
}

/** 搜索能否命中该值或其任意深层子值 */
function hasDeepMatch(v: unknown, search: string): boolean {
  if (!search) return true;
  if (v === null || v === undefined) return matchSearch(v, search);
  if (isPrimitive(v)) return matchSearch(v, search);
  if (Array.isArray(v)) return v.some((x) => hasDeepMatch(x, search));
  if (typeof v === 'object') {
    for (const [k, sub] of Object.entries(v as Record<string, unknown>)) {
      if (matchSearch(k, search)) return true;
      if (hasDeepMatch(sub, search)) return true;
    }
  }
  return false;
}

/**
 * 列过滤匹配：
 *  - 以 >= / <= / > / < / = 开头且右侧能解析为数字时，按数值比较（仅当单元值也是数字时命中）
 *  - 其他情况走子串匹配（深度匹配，对嵌套对象也能筛）
 *  - 查询以空白分隔时，每段都要命中（AND）
 */
function matchColumn(value: unknown, query: string): boolean {
  const q = query.trim();
  if (!q) return true;

  // 数值比较：>=  <=  >  <  =
  const m = /^(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/.exec(q);
  if (m) {
    const op = m[1];
    const rhs = Number(m[2]);
    const lhs = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(lhs)) return false;
    switch (op) {
      case '>=': return lhs >= rhs;
      case '<=': return lhs <= rhs;
      case '>': return lhs > rhs;
      case '<': return lhs < rhs;
      case '=': return lhs === rhs;
    }
  }

  // 子串匹配：多段以空白分隔，AND 命中
  const parts = q.split(/\s+/).filter(Boolean);
  return parts.every((p) => hasDeepMatch(value, p));
}

function tryCoerce(raw: string): unknown {
  if (raw === '') return '';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  const n = Number(raw);
  if (!Number.isNaN(n) && raw.trim() !== '' && /^-?\d+(\.\d+)?$/.test(raw)) return n;
  return raw;
}

/**
 * 推断某一列的主导类型：
 *  - 扫描该列所有已有样本值（跳过空字符串 / undefined / null）；
 *  - 返回出现次数最多的基础类型。若全是字符串或无样本，返回 null（交给默认逻辑）。
 */
type ColType = 'number' | 'boolean' | 'string' | 'null';
function inferColumnType(rows: Record<string, unknown>[], col: string): ColType | null {
  const counts: Record<string, number> = {};
  let sampled = 0;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    if (!(col in r)) continue;
    const v = (r as any)[col];
    if (v === undefined) continue;
    if (v === '') continue; // 跳过占位空字符串
    if (v === null) { counts.null = (counts.null ?? 0) + 1; sampled++; continue; }
    const t = typeof v;
    if (t === 'number' || t === 'boolean' || t === 'string') {
      counts[t] = (counts[t] ?? 0) + 1;
      sampled++;
    }
  }
  if (sampled === 0) return null;
  // 优先非字符串类型（只要有一个非字符串样本，就认为列应当是该类型）
  if ((counts.number ?? 0) > 0) return 'number';
  if ((counts.boolean ?? 0) > 0) return 'boolean';
  if ((counts.null ?? 0) > 0 && (counts.string ?? 0) === 0) return 'null';
  return 'string';
}

/**
 * 按指定类型把字符串 raw 转换为对应原始类型值。
 * 返回 { ok, value }：
 *  - ok=true 表示转换成功（或空串/无需转换等合法场景）；
 *  - ok=false 表示 raw 与目标类型不匹配；此时 value 为原字符串，交给调用方决定是否强制保存。
 */
function coerceByType(raw: string, type: ColType): { ok: boolean; value: unknown } {
  if (type === 'number') {
    if (raw.trim() === '') return { ok: true, value: raw };
    if (!/^-?\d+(\.\d+)?$/.test(raw.trim())) return { ok: false, value: raw };
    const n = Number(raw);
    return Number.isNaN(n) ? { ok: false, value: raw } : { ok: true, value: n };
  }
  if (type === 'boolean') {
    if (raw === 'true') return { ok: true, value: true };
    if (raw === 'false') return { ok: true, value: false };
    return { ok: false, value: raw };
  }
  if (type === 'null') {
    if (raw === '' || raw === 'null') return { ok: true, value: null };
    return { ok: false, value: raw };
  }
  return { ok: true, value: raw };
}

function analyze(
  data: unknown,
): { kind: 'array-of-objects' | 'primitive-array' | 'kv' | 'unsupported'; columns?: string[] } {
  if (Array.isArray(data)) {
    // 全对象数组 → 行列表
    if (data.length > 0 && data.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
      const cols = new Set<string>();
      for (const r of data as Record<string, unknown>[]) {
        Object.keys(r).forEach((k) => cols.add(k));
      }
      return { kind: 'array-of-objects', columns: Array.from(cols) };
    }
    // 空数组 或 基本值/混合数组 → 单列表
    return { kind: 'primitive-array' };
  }
  if (data && typeof data === 'object') {
    return { kind: 'kv' };
  }
  return { kind: 'unsupported' };
}

// 备注：csvParse 在扩展侧也调用，这里保留 import 是为了 tree-shake 友好且类型统一
void csvParse;
