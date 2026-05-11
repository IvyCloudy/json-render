import React from 'react';
import { ViewProps, setByPath, coerce, matchSearch, Highlight } from './viewUtils';
import { SchemaForm, JsonSchema } from './SchemaForm';
import { AntdFormView } from './AntdFormView';
import { useVSCodeBridge } from '../hooks/useVSCodeBridge';
import { SubmitBar } from './SubmitBar';
import { FORM_META_KEY, FORM_CONFIG_KEY, FORM_DATA_KEY, hasFormConfig as checkFormConfig } from './formConfigTypes';
import { readSubmitConfig } from './SubmitBar';

/**
 * 表单视图：
 *  - 若提供了 JSON Schema，则按 schema 渲染（带校验、枚举、必填等）
 *  - 否则递归渲染为动态表单
 *  - 若 JSON 根下声明 __form.submit，底部会出现提交按钮
 */
function hasFormConfig(data: unknown): boolean {
  return checkFormConfig(data);
}

export const FormView: React.FC<ViewProps> = ({ data, search, onChange }) => {
  const { state } = useVSCodeBridge();
  const schema = state.schema as JsonSchema | null;
  const hasSubmit = Boolean(readSubmitConfig(data));

  // 记录首次收到的有效 data 作为 reset 快照（深拷贝，避免后续 onChange 改动影响它）
  const snapshotRef = React.useRef<unknown>(undefined);
  React.useEffect(() => {
    if (snapshotRef.current === undefined && data !== undefined && data !== null) {
      try { snapshotRef.current = JSON.parse(JSON.stringify(data)); }
      catch { snapshotRef.current = data; }
    }
  }, [data]);
  // 当文件被切换（fileName 变化）时重置快照
  const fileNameRef = React.useRef<string>(state.fileName);
  if (fileNameRef.current !== state.fileName) {
    fileNameRef.current = state.fileName;
    snapshotRef.current = undefined;
  }

  if (schema) {
    return (
      <div>
        <SchemaForm data={data} schema={schema} onChange={onChange} />
        {hasSubmit && <SubmitBar data={data} onChange={onChange} initialSnapshot={snapshotRef.current} />}
      </div>
    );
  }

  if (hasFormConfig(data)) {
    return <AntdFormView data={data} onChange={onChange} />;
  }

  if (data === null || typeof data !== 'object') {
    return <div className="jr-empty">Form view requires an object or array.</div>;
  }
  // 渲染时过滤掉 __form 元数据，避免它被当作业务字段展示 / 被编辑
  const viewData = stripFormMeta(data);
  return (
    <div>
      <FormNode
        value={viewData}
        path={[]}
        search={search}
        onUpdate={(path, val) => onChange(setByPath(data, path, val))}
      />
      {hasSubmit && <SubmitBar data={data} onChange={onChange} initialSnapshot={snapshotRef.current} />}
    </div>
  );
};

/** 在渲染层隐藏 __form / formConfig / formData 键，但不从原始数据中删除 */
function stripFormMeta(data: unknown): unknown {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    if (FORM_META_KEY in obj || FORM_CONFIG_KEY in obj || FORM_DATA_KEY in obj) {
      const { [FORM_META_KEY]: _, [FORM_CONFIG_KEY]: __, [FORM_DATA_KEY]: ___, ...rest } = obj;
      return rest;
    }
  }
  return data;
}

interface NodeProps {
  value: unknown;
  path: (string | number)[];
  search: string;
  onUpdate: (path: (string | number)[], value: unknown) => void;
}

const FormNode: React.FC<NodeProps> = ({ value, path, search, onUpdate }) => {
  if (value === null || value === undefined) {
    return renderPrimitiveField('(null)', value, path, search, onUpdate);
  }
  if (Array.isArray(value)) {
    return (
      <div className="jr-sub">
        <div className="jr-sub-title">
          <Highlight text={pathLabel(path) || 'root[]'} search={search} />
          <span className="jr-badge" style={{ marginLeft: 8 }}>Array · {value.length}</span>
        </div>
        <div className="jr-form">
          {value.map((item, i) => (
            <React.Fragment key={i}>
              {isPrimitive(item) ? (
                renderPrimitiveField(`[${i}]`, item, [...path, i], search, onUpdate)
              ) : (
                <div style={{ gridColumn: '1 / -1' }}>
                  <FormNode value={item} path={[...path, i]} search={search} onUpdate={onUpdate} />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return (
    <div className="jr-sub">
      {path.length > 0 && (
        <div className="jr-sub-title">
          <Highlight text={pathLabel(path)} search={search} />
        </div>
      )}
      <div className="jr-form">
        {entries.map(([k, v]) => {
          const childPath = [...path, k];
          if (isPrimitive(v)) {
            return <React.Fragment key={k}>{renderPrimitiveField(k, v, childPath, search, onUpdate)}</React.Fragment>;
          }
          return (
            <div key={k} style={{ gridColumn: '1 / -1' }}>
              <FormNode value={v} path={childPath} search={search} onUpdate={onUpdate} />
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** 字符串较长或含换行时改用 textarea，避免单行 input 被截断难以编辑 */
const LONG_TEXT_THRESHOLD = 80;
function shouldUseTextarea(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  return v.length >= LONG_TEXT_THRESHOLD || /\r|\n/.test(v);
}

function renderPrimitiveField(
  label: string,
  value: unknown,
  path: (string | number)[],
  search: string,
  onUpdate: (p: (string | number)[], v: unknown) => void
) {
  const dim = search && !matchSearch(value, search) && !matchSearch(label, search);
  const dimStyle = { opacity: dim ? 0.4 : 1 };
  return (
    <React.Fragment>
      <label style={dimStyle}><Highlight text={String(label)} search={search} /></label>
      {typeof value === 'boolean' ? (
        <select
          defaultValue={value ? 'true' : 'false'}
          onBlur={(e) => onUpdate(path, e.target.value === 'true')}
          onChange={(e) => onUpdate(path, e.target.value === 'true')}
          style={dimStyle}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : shouldUseTextarea(value) ? (
        <textarea
          className="jr-textarea"
          rows={Math.min(10, Math.max(3, value.split(/\r?\n/).length + 1))}
          defaultValue={value}
          onBlur={(e) => onUpdate(path, e.target.value)}
          style={dimStyle}
        />
      ) : (
        <input
          type={typeof value === 'number' ? 'number' : 'text'}
          defaultValue={value === null || value === undefined ? '' : String(value)}
          onBlur={(e) => onUpdate(path, coerce(e.target.value, value))}
          style={dimStyle}
        />
      )}
    </React.Fragment>
  );
}

function isPrimitive(v: unknown) {
  return v === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof v);
}

function pathLabel(path: (string | number)[]): string {
  return path.map((p) => (typeof p === 'number' ? `[${p}]` : p)).join('.');
}
