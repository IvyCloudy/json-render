import React from 'react';
import { ViewProps, Highlight, coerce, matchSearch } from './viewUtils';

/**
 * 卡片视图：对象数组 -> 每个对象一张卡片
 */
export const CardView: React.FC<ViewProps> = ({ data, search, onChange }) => {
  if (!Array.isArray(data) || !data.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
    // 单对象也支持：渲染一张卡片
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return (
        <div className="jr-cards">
          <Card
            item={data as Record<string, unknown>}
            index={-1}
            search={search}
            onPatch={(k, v) => onChange({ ...(data as any), [k]: v })}
          />
        </div>
      );
    }
    return <div className="jr-empty">Card view requires an array of objects (or a single object).</div>;
  }

  const list = data as Record<string, unknown>[];
  return (
    <div className="jr-cards">
      {list.map((item, i) => {
        if (search && !Object.entries(item).some(([k, v]) => matchSearch(k, search) || matchSearch(v, search))) {
          return null;
        }
        return (
          <Card
            key={i}
            item={item}
            index={i}
            search={search}
            onPatch={(k, v) => {
              const next = list.slice();
              next[i] = { ...(next[i] as any), [k]: v };
              onChange(next);
            }}
          />
        );
      })}
    </div>
  );
};

const Card: React.FC<{
  item: Record<string, unknown>;
  index: number;
  search: string;
  onPatch: (key: string, value: unknown) => void;
}> = ({ item, index, search, onPatch }) => {
  const title = deriveTitle(item, index);
  return (
    <div className="jr-card">
      <div className="jr-card-title"><Highlight text={title} search={search} /></div>
      {Object.entries(item).map(([k, v]) => (
        <div key={k} className="jr-card-row">
          <span className="jr-card-key"><Highlight text={k} search={search} /></span>
          <span className="jr-card-val">
            {isPrimitive(v) ? (
              <input
                defaultValue={v === null || v === undefined ? '' : String(v)}
                onBlur={(e) => onPatch(k, coerce(e.target.value, v))}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'inherit',
                  font: 'inherit',
                  outline: 'none',
                  borderBottom: '1px dashed var(--vscode-panel-border, rgba(128,128,128,0.3))',
                  width: '100%',
                }}
              />
            ) : (
              <code style={{ opacity: 0.8 }}>{JSON.stringify(v)}</code>
            )}
          </span>
        </div>
      ))}
    </div>
  );
};

function deriveTitle(item: Record<string, unknown>, index: number) {
  const preferred = ['title', 'name', 'id', 'label', 'key'];
  for (const k of preferred) {
    if (typeof item[k] === 'string' || typeof item[k] === 'number') return String(item[k]);
  }
  return index >= 0 ? `#${index}` : 'Object';
}

function isPrimitive(v: unknown) {
  return v === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof v);
}
