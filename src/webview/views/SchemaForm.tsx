import React, { useMemo, useState, useEffect } from 'react';
import { setByPath, coerce } from './viewUtils';

export type JsonSchema = {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchema;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: unknown;
};

interface Props {
  data: unknown;
  schema: JsonSchema;
  onChange: (next: unknown) => void;
}

/**
 * 受控 Schema 表单：按 JSON Schema 的 type / properties / enum / required / pattern 渲染
 * 支持 string / number / integer / boolean / object / array 基础类型。
 */
export const SchemaForm: React.FC<Props> = ({ data, schema, onChange }) => {
  const [local, setLocal] = useState<unknown>(data);
  useEffect(() => { setLocal(data); }, [data]);

  const errors = useMemo(() => validate(local, schema, ''), [local, schema]);

  const commit = (path: (string | number)[], value: unknown) => {
    const next = setByPath(local, path, value);
    setLocal(next);
    onChange(next);
  };

  return (
    <div>
      {schema.title && <h2 style={{ margin: '0 0 6px' }}>{schema.title}</h2>}
      {schema.description && <p style={{ marginTop: 0, opacity: 0.75 }}>{schema.description}</p>}
      {errors.length > 0 && (
        <div className="jr-error" style={{ marginBottom: 12 }}>
          <strong>Validation:</strong>
          <ul style={{ margin: '4px 0 0 18px' }}>
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}
      <SchemaNode value={local} schema={schema} path={[]} onCommit={commit} requiredByParent={false} />
    </div>
  );
};

interface NodeProps {
  value: unknown;
  schema: JsonSchema;
  path: (string | number)[];
  onCommit: (path: (string | number)[], value: unknown) => void;
  requiredByParent: boolean;
}

const SchemaNode: React.FC<NodeProps> = ({ value, schema, path, onCommit, requiredByParent }) => {
  const type = normalizeType(schema);

  if (schema.enum) {
    return (
      <select
        defaultValue={value === undefined || value === null ? '' : String(value)}
        onChange={(e) => onCommit(path, castEnum(e.target.value, schema.enum!))}
      >
        {!requiredByParent && <option value="">(none)</option>}
        {schema.enum.map((opt) => (
          <option key={String(opt)} value={String(opt)}>{String(opt)}</option>
        ))}
      </select>
    );
  }

  switch (type) {
    case 'object': {
      const props = schema.properties || {};
      const obj = (value && typeof value === 'object' && !Array.isArray(value)) ? value as Record<string, unknown> : {};
      // 额外字段：数据中存在但 schema 未声明的 key。
      // 保留并渲染出来，避免被默默天下导致信息丢失 / 编辑无效。
      const extraKeys = Object.keys(obj).filter((k) => !(k in props));
      return (
        <div className="jr-sub">
          {schema.title && <div className="jr-sub-title">{schema.title}</div>}
          <div className="jr-form">
            {Object.entries(props).map(([key, sub]) => {
              const isRequired = (schema.required || []).includes(key);
              const child = obj[key];
              return (
                <React.Fragment key={key}>
                  <label title={sub.description}>
                    {sub.title || key}{isRequired && <span style={{ color: 'var(--vscode-errorForeground)' }}> *</span>}
                  </label>
                  <div>
                    <SchemaNode
                      value={child}
                      schema={sub}
                      path={[...path, key]}
                      onCommit={onCommit}
                      requiredByParent={isRequired}
                    />
                  </div>
                </React.Fragment>
              );
            })}
            {extraKeys.map((key) => (
              <React.Fragment key={`__extra__${key}`}>
                <label title="Not declared in schema">
                  {key}
                  <span className="jr-badge" style={{ marginLeft: 6 }}>extra</span>
                </label>
                <div>
                  <ExtraField
                    value={obj[key]}
                    onCommit={(v) => onCommit([...path, key], v)}
                  />
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      );
    }

    case 'array': {
      const items = Array.isArray(value) ? value : [];
      const itemSchema = schema.items || {};
      return (
        <div className="jr-sub">
          <div className="jr-sub-title">
            {schema.title || 'Array'}
            <span className="jr-badge" style={{ marginLeft: 8 }}>{items.length}</span>
            <button
              className="jr-tab"
              style={{ marginLeft: 8 }}
              onClick={() => onCommit(path, [...items, defaultFor(itemSchema)])}
            >＋ Add</button>
          </div>
          {items.map((el, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
              <span className="jr-badge" style={{ minWidth: 24 }}>[{i}]</span>
              <div style={{ flex: 1 }}>
                <SchemaNode
                  value={el}
                  schema={itemSchema}
                  path={[...path, i]}
                  onCommit={onCommit}
                  requiredByParent={false}
                />
              </div>
              <button
                className="jr-tab"
                onClick={() => {
                  const next = items.slice();
                  next.splice(i, 1);
                  onCommit(path, next);
                }}
              >✕</button>
            </div>
          ))}
        </div>
      );
    }

    case 'boolean':
      return (
        <select
          defaultValue={value === true ? 'true' : value === false ? 'false' : ''}
          onChange={(e) => onCommit(path, e.target.value === '' ? null : e.target.value === 'true')}
        >
          {!requiredByParent && <option value="">(unset)</option>}
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );

    case 'integer':
    case 'number':
      return (
        <input
          type="number"
          step={type === 'integer' ? 1 : 'any'}
          min={schema.minimum}
          max={schema.maximum}
          defaultValue={value === undefined || value === null ? '' : String(value)}
          onBlur={(e) => {
            if (e.target.value === '') return onCommit(path, null);
            const n = Number(e.target.value);
            onCommit(path, type === 'integer' ? Math.trunc(n) : n);
          }}
        />
      );

    case 'string':
    default: {
      const strVal = value === undefined || value === null ? '' : String(value);
      const longBySchema = schema.format === 'textarea' || (schema.maxLength !== undefined && schema.maxLength > 120);
      const longByValue = strVal.length >= 80 || /\r|\n/.test(strVal);
      if (longBySchema || longByValue) {
        const rows = Math.min(10, Math.max(4, strVal.split(/\r?\n/).length + 1));
        return (
          <textarea
            className="jr-textarea"
            rows={rows}
            defaultValue={strVal}
            onBlur={(e) => onCommit(path, e.target.value)}
            maxLength={schema.maxLength}
          />
        );
      }
      return (
        <input
          type={schema.format === 'email' ? 'email' : schema.format === 'uri' ? 'url' : 'text'}
          defaultValue={strVal}
          onBlur={(e) => onCommit(path, coerce(e.target.value, value))}
          minLength={schema.minLength}
          maxLength={schema.maxLength}
          pattern={schema.pattern}
        />
      );
    }
  }
};

function normalizeType(schema: JsonSchema): string {
  if (Array.isArray(schema.type)) return schema.type.find((t) => t !== 'null') ?? 'string';
  if (schema.type) return schema.type;
  if (schema.properties) return 'object';
  if (schema.items) return 'array';
  if (schema.enum) return 'string';
  return 'string';
}

/**
 * 额外字段输入框：schema 未声明的 key 走这里。
 * 根据原始值类型分支渲染：boolean → select；number → number input；
 * object / array → 只读 JSON 文本框（避免破坏结构，用户想编辑请补充到 schema）；
 * 其他 → 文本框。
 */
const ExtraField: React.FC<{ value: unknown; onCommit: (v: unknown) => void }> = ({
  value,
  onCommit,
}) => {
  if (typeof value === 'boolean') {
    return (
      <select
        defaultValue={value ? 'true' : 'false'}
        onChange={(e) => onCommit(e.target.value === 'true')}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (typeof value === 'number') {
    return (
      <input
        type="number"
        defaultValue={String(value)}
        onBlur={(e) => {
          if (e.target.value === '') return onCommit(null);
          const n = Number(e.target.value);
          onCommit(Number.isNaN(n) ? e.target.value : n);
        }}
      />
    );
  }
  if (value !== null && typeof value === 'object') {
    return (
      <textarea
        rows={3}
        defaultValue={JSON.stringify(value, null, 2)}
        onBlur={(e) => {
          try {
            onCommit(JSON.parse(e.target.value));
          } catch {
            // 解析失败就保持原值，用户下次 blur 再改
          }
        }}
      />
    );
  }
  if (typeof value === 'string' && (value.length >= 80 || /\r|\n/.test(value))) {
    const rows = Math.min(10, Math.max(3, value.split(/\r?\n/).length + 1));
    return (
      <textarea
        className="jr-textarea"
        rows={rows}
        defaultValue={value}
        onBlur={(e) => onCommit(e.target.value)}
      />
    );
  }
  return (
    <input
      type="text"
      defaultValue={value === null || value === undefined ? '' : String(value)}
      onBlur={(e) => onCommit(coerce(e.target.value, value))}
    />
  );
};

function defaultFor(schema: JsonSchema): unknown {
  if (schema.default !== undefined) return schema.default;
  switch (normalizeType(schema)) {
    case 'object': return {};
    case 'array': return [];
    case 'boolean': return false;
    case 'number':
    case 'integer': return 0;
    default: return '';
  }
}

function castEnum(raw: string, options: unknown[]): unknown {
  for (const o of options) if (String(o) === raw) return o;
  return raw;
}

export function validate(value: unknown, schema: JsonSchema, pathLabel: string): string[] {
  const errors: string[] = [];
  const push = (msg: string) => errors.push(`${pathLabel || '(root)'} ${msg}`);
  const type = normalizeType(schema);

  if (value === undefined || value === null) {
    // leave required check to parent
    return errors;
  }

  if (schema.enum && !schema.enum.some((o) => o === value)) {
    push(`must be one of ${JSON.stringify(schema.enum)}`);
  }

  switch (type) {
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) { push('must be object'); break; }
      const obj = value as Record<string, unknown>;
      for (const r of schema.required || []) {
        if (obj[r] === undefined || obj[r] === null || obj[r] === '') {
          errors.push(`${pathLabel ? pathLabel + '.' : ''}${r} is required`);
        }
      }
      if (schema.properties) {
        for (const [k, sub] of Object.entries(schema.properties)) {
          errors.push(...validate(obj[k], sub, pathLabel ? `${pathLabel}.${k}` : k));
        }
      }
      break;
    }
    case 'array': {
      if (!Array.isArray(value)) { push('must be array'); break; }
      if (schema.items) {
        value.forEach((el, i) => errors.push(...validate(el, schema.items!, `${pathLabel}[${i}]`)));
      }
      break;
    }
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) push('must be integer');
      break;
    case 'number':
      if (typeof value !== 'number') push('must be number');
      break;
    case 'boolean':
      if (typeof value !== 'boolean') push('must be boolean');
      break;
    case 'string':
      if (typeof value !== 'string') { push('must be string'); break; }
      if (schema.minLength !== undefined && value.length < schema.minLength) push(`length < ${schema.minLength}`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) push(`length > ${schema.maxLength}`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) push(`must match /${schema.pattern}/`);
      break;
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) push(`< ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) push(`> ${schema.maximum}`);
  }
  return errors;
}
