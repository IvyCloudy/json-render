import React, { useMemo } from 'react';
import { ViewProps, setByPath, matchSearch, Highlight } from './viewUtils';
import { TableView } from './TableView';
import { FormView } from './FormView';
import { ChartView } from './ChartView';
import { CardView } from './CardView';

/**
 * 复合视图：将"混合型根对象"按字段拆成多个区块，每块独立选择最合适的子视图。
 *
 * 分段规则（顶层 entries）：
 *   - value 是对象数组        → Table（同质对象）或 Card（异质对象）
 *   - value 是数值数组        → Chart（长度 ≥ 3）否则 Table（单列）
 *   - value 是基本值数组      → Table（单列）
 *   - value 是嵌套对象        → Form（扁平）或 Composite 递归（嵌套）
 *   - value 是基本值 / null   → 聚合进 "Meta" KV 区块（每个 Composite 最多一块）
 */

type Section =
  | { kind: 'meta'; entries: [string, unknown][] }
  | { kind: 'field'; key: string; value: unknown };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPrimitive(v: unknown): boolean {
  return v === null || v === undefined || typeof v !== 'object';
}

function splitSections(data: Record<string, unknown>): Section[] {
  const meta: [string, unknown][] = [];
  const fields: Section[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (isPrimitive(v)) {
      meta.push([k, v]);
    } else {
      fields.push({ kind: 'field', key: k, value: v });
    }
  }
  if (meta.length > 0) {
    return [{ kind: 'meta', entries: meta }, ...fields];
  }
  return fields;
}

/** 根据 value 的形态选择最合适的子视图组件 */
function pickSubViewForField(value: unknown): 'table' | 'chart' | 'form' | 'card' | 'composite' {
  if (Array.isArray(value)) {
    if (value.length === 0) return 'table';
    const allObj = value.every(isPlainObject);
    if (allObj) {
      // 对象数组：数值列多时 Chart 反而不直观，这里优先 Table，让用户在区块里切换到 Chart
      return 'table';
    }
    const allNum = value.every((x) => typeof x === 'number' && Number.isFinite(x));
    if (allNum && value.length >= 3) return 'chart';
    return 'table';
  }
  if (isPlainObject(value)) {
    // 扁平对象 → Form，嵌套对象 → 递归 Composite
    const hasNested = Object.values(value).some((v) => v !== null && typeof v === 'object');
    if (!hasNested) return 'form';
    return 'composite';
  }
  return 'form';
}

export const CompositeView: React.FC<ViewProps> = ({ data, search, onChange, onError }) => {
  // 注意：Hook 必须在任何条件 return 之前调用，否则当 data 形态在两次渲染间
  // 变化（例如切换文件后根类型从对象变成数组/null）时，Hook 调用顺序会错位，
  // 导致 React 运行时抛错并卸载整棵组件树（表现为 webview 白屏且不再刷新）。
  const sections = useMemo(
    () => (isPlainObject(data) ? splitSections(data) : []),
    [data]
  );

  if (!isPlainObject(data)) {
    return <div className="jr-empty">Composite view requires a plain object root.</div>;
  }

  return (
    <div className="jr-composite">
      {sections.map((sec, idx) => {
        if (sec.kind === 'meta') {
          return (
            <MetaSection
              key="__meta__"
              entries={sec.entries}
              search={search}
              onChange={(k, v) => onChange(setByPath(data, [k], v))}
            />
          );
        }
        return (
          <FieldSection
            key={`${sec.key}-${idx}`}
            name={sec.key}
            value={sec.value}
            search={search}
            onChange={(next) => onChange(setByPath(data, [sec.key], next))}
            onError={onError}
          />
        );
      })}
    </div>
  );
};

/* ---------------- 基本值聚合区块 ---------------- */

const META_LONG_THRESHOLD = 40; // 超过此长度或含换行时，使用 textarea 以便完整展示与编辑

const MetaSection: React.FC<{
  entries: [string, unknown][];
  search: string;
  onChange: (key: string, val: unknown) => void;
}> = ({ entries, search, onChange }) => {
  const filtered = search
    ? entries.filter(([k, v]) => matchSearch(k, search) || matchSearch(v, search))
    : entries;
  if (filtered.length === 0) return null;
  return (
    <section className="jr-cmp-section">
      <header className="jr-cmp-header">
        <span className="jr-cmp-title">Meta</span>
        <span className="jr-cmp-badge">KV · {entries.length}</span>
      </header>
      <div className="jr-cmp-body">
        <table className="jr-table">
          <thead>
            <tr>
              <th style={{ width: '30%' }}>Key</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(([k, v]) => {
              const display = v === null || v === undefined ? '' : String(v);
              const isLong = display.length > META_LONG_THRESHOLD || display.includes('\n');
              return (
                <tr key={k}>
                  <td>
                    <Highlight text={k} search={search} />
                  </td>
                  <td>
                    {isLong ? (
                      <textarea
                        className="jr-cell-input jr-textarea"
                        defaultValue={display}
                        key={`${k}::${display}`}
                        rows={Math.min(6, Math.max(2, display.split('\n').length))}
                        title={display}
                        onBlur={(e) => onChange(k, coerceLike(e.target.value, v))}
                      />
                    ) : (
                      <input
                        defaultValue={display}
                        key={`${k}::${display}`}
                        title={display}
                        onBlur={(e) => onChange(k, coerceLike(e.target.value, v))}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};

/* ---------------- 单字段区块：根据形态选子视图 ---------------- */

const FieldSection: React.FC<{
  name: string;
  value: unknown;
  search: string;
  onChange: (next: unknown) => void;
  onError: (msg: string) => void;
}> = ({ name, value, search, onChange, onError }) => {
  const kind = pickSubViewForField(value);
  const common = { data: value, search, onChange, onError };

  let badge = '';
  if (Array.isArray(value)) {
    const allObj = value.length > 0 && value.every(isPlainObject);
    badge = allObj ? `${value.length} rows` : `${value.length} items`;
  } else if (isPlainObject(value)) {
    badge = `${Object.keys(value).length} keys`;
  }

  let body: React.ReactNode;
  switch (kind) {
    case 'table':
      body = <TableView {...common} />;
      break;
    case 'chart':
      body = <ChartView {...common} />;
      break;
    case 'card':
      body = <CardView {...common} />;
      break;
    case 'form':
      body = <FormView {...common} />;
      break;
    case 'composite':
      body = <CompositeView {...common} />;
      break;
    default:
      body = <FormView {...common} />;
  }

  return (
    <section className="jr-cmp-section">
      <header className="jr-cmp-header">
        <span className="jr-cmp-title">
          <Highlight text={name} search={search} />
        </span>
        <span className="jr-cmp-kind">{kind.toUpperCase()}</span>
        {badge && <span className="jr-cmp-badge">{badge}</span>}
      </header>
      <div className="jr-cmp-body">{body}</div>
    </section>
  );
};

/* ---------------- helpers ---------------- */

function coerceLike(raw: string, original: unknown): unknown {
  if (typeof original === 'number') {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (typeof original === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return Boolean(raw);
  }
  if (original === null) {
    return raw === '' || raw === 'null' ? null : raw;
  }
  return raw;
}
