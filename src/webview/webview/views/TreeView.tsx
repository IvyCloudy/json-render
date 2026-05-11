import React, { useMemo, useState } from 'react';
import { JsonViewer, applyValue } from '@textea/json-viewer';
import type { JsonViewerKeyRenderer, Path } from '@textea/json-viewer';
import type { ViewProps } from './viewUtils';
import { jsonPath } from '../../common/jsonPath';

/**
 * 树形视图：基于 @textea/json-viewer + 可选 JSONPath 过滤
 */
export const TreeView: React.FC<ViewProps> = ({ data, search, onChange }) => {
  const [jpExpr, setJpExpr] = useState('');
  const [jpError, setJpError] = useState<string | null>(null);

  const displayData = useMemo(() => {
    if (!jpExpr.trim()) { return data; }
    try {
      const matches = jsonPath(data, jpExpr.trim());
      setJpError(null);
      if (matches.length === 0) return { __jsonPath: jpExpr, matches: [], message: 'No match.' };
      return matches.length === 1 ? matches[0] : matches;
    } catch (e: any) {
      setJpError(e?.message ?? String(e));
      return data;
    }
  }, [data, jpExpr]);

  const editable = !jpExpr.trim();

  const keyRenderer = useMemo<JsonViewerKeyRenderer>(() => {
    const renderer: JsonViewerKeyRenderer = ({ path }) => {
      const last = path[path.length - 1];
      return (
        <span style={{ background: 'var(--vscode-editor-findMatchHighlightBackground, #ffe58f)' }}>
          {String(last ?? '')}
        </span>
      );
    };
    renderer.when = (props) => {
      if (!search) return false;
      const last = props.path[props.path.length - 1];
      return String(last ?? '').toLowerCase().includes(search.toLowerCase());
    };
    return renderer;
  }, [search]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="jr-badge">JSONPath:</span>
        <input
          className="jr-search"
          placeholder='$.store.book[?(@.price<10)].title'
          value={jpExpr}
          onChange={(e) => setJpExpr(e.target.value)}
          style={{ flex: 1 }}
        />
        {jpExpr && (
          <button className="jr-tab" onClick={() => { setJpExpr(''); setJpError(null); }}>Clear</button>
        )}
      </div>
      {jpError && <div className="jr-error" style={{ padding: 6 }}>{jpError}</div>}
      <JsonViewer
        value={displayData}
        rootName={false}
        theme="auto"
        displayDataTypes={false}
        displaySize={false}
        enableClipboard
        editable={editable}
        defaultInspectDepth={3}
        keyRenderer={keyRenderer}
        onChange={(path: Path, _oldValue: unknown, newValue: unknown) => {
          if (!editable) return;
          try {
            const next = applyValue(data, path as (string | number)[], newValue);
            onChange(next);
          } catch {
            /* ignore */
          }
        }}
      />
    </div>
  );
};