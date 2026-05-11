import React, { useMemo, useState } from 'react';
import { useVSCodeBridge, HttpResponseResult } from '../hooks/useVSCodeBridge';
import { getByPath, setByPath, parsePathExpr } from './viewUtils';

/**
 * __form 约定（写在 JSON 文件本身）：
 *
 * {
 *   "__form": {
 *     "auth": { "bearer": "{{token}}" }, // 可选；自动注入 Authorization: Bearer xxx
 *     "submit": [ ... SubmitConfig ... ] // 对象或数组，见下方接口
 *   }
 * }
 *
 * SubmitConfig 所有字段见下。type 为 "reset" 时是客户端重置按钮，不发请求。
 */
export interface SubmitConfig {
  /** "http"（默认）或 "reset" */
  type?: 'http' | 'reset';
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, unknown>;
  bodyPath?: string;
  body?: unknown;
  responsePath?: string;
  requiredPaths?: string[];
  label?: string;
  confirm?: string;
  timeoutMs?: number;
  variant?: 'primary' | 'secondary' | 'danger';
  /** 成功后打开此 URL（支持模板插值，通常引用 responsePath 下字段） */
  openUrl?: string;
}

export interface FormAuth {
  bearer?: string;
}

export interface FormMeta {
  auth?: FormAuth;
  submit?: SubmitConfig | SubmitConfig[];
}

export const FORM_META_KEY = '__form';

/** 读取提交配置；同时支持旧的对象与新的数组；非法配置返回 null */
export function readSubmitConfig(data: unknown): SubmitConfig[] | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const meta = (data as any)[FORM_META_KEY] as FormMeta | undefined;
  if (!meta || typeof meta !== 'object') return null;
  const raw = meta.submit;
  if (!raw) return null;
  const list = Array.isArray(raw) ? raw : [raw];
  const valid = list.filter((x) => {
    if (!x || typeof x !== 'object') return false;
    if (x.type === 'reset') return true;
    return typeof x.url === 'string' && x.url.length > 0;
  }) as SubmitConfig[];
  return valid.length ? valid : null;
}

function readAuth(data: unknown): FormAuth | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const meta = (data as any)[FORM_META_KEY] as FormMeta | undefined;
  return meta?.auth;
}

/**
 * 把字符串中的 {{path.to.field}} 替换为 data 对应的值。
 * - 整个字符串就是一个 {{...}} → 返回原始类型
 * - 否则拼接为字符串
 */
export function interpolate(input: unknown, data: unknown): unknown {
  if (typeof input !== 'string') {
    if (Array.isArray(input)) return input.map((x) => interpolate(x, data));
    if (input && typeof input === 'object') {
      // 保留 $file 占位符，不递归插值内部的 path（path 一般是绝对路径）
      if (isFilePlaceholder(input)) return input;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
        out[k] = interpolate(v, data);
      }
      return out;
    }
    return input;
  }
  const WHOLE = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/;
  const m = input.match(WHOLE);
  if (m) return getByPath(data, m[1].trim());
  return input.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_all, expr: string) => {
    const v = getByPath(data, expr.trim());
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') {
      try { return JSON.stringify(v); } catch { return String(v); }
    }
    return String(v);
  });
}

/** `{ "$file": "/abs/path.png", "field": "avatar", "filename": "x.png", "contentType": "image/png" }` */
function isFilePlaceholder(v: unknown): v is { $file: string; field?: string; filename?: string; contentType?: string } {
  return !!v && typeof v === 'object' && typeof (v as any).$file === 'string';
}

function buildQueryString(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const el of v) {
        if (el === undefined || el === null) continue;
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(el))}`);
      }
    } else if (typeof v === 'object') {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(JSON.stringify(v))}`);
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.join('&');
}

function appendQuery(url: string, qs: string): string {
  if (!qs) return url;
  return url + (url.includes('?') ? '&' : '?') + qs;
}

/** 构造 body：body > bodyPath > 全体（剔除 __form） */
export function buildSubmitBody(data: unknown, cfg: SubmitConfig): unknown {
  if (cfg.body !== undefined) return interpolate(cfg.body, data);
  if (cfg.bodyPath) return getByPath(data, cfg.bodyPath);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const { [FORM_META_KEY]: _drop, ...rest } = data as Record<string, unknown>;
    return rest;
  }
  return data;
}

function validateRequired(data: unknown, paths: string[] | undefined): string[] {
  if (!paths || !paths.length) return [];
  const missing: string[] = [];
  for (const p of paths) {
    const v = getByPath(data, p);
    if (v === undefined || v === null || v === '') missing.push(p);
  }
  return missing;
}

/**
 * 从 body 里提取所有 $file 占位符，返回 multipart 需要的 fields + files。
 * 规则：
 * - 若 body 本身是对象，遍历顶层字段：
 *    - 值是 $file 占位符 → 加入 files（field 默认取 key）
 *    - 其他标量 → 加入 fields（非字符串会 JSON.stringify）
 * - 如果最终没有 files，返回 null 表示不需要 multipart
 */
function extractMultipart(body: unknown): null | {
  fields: Record<string, string>;
  files: Array<{ field: string; path: string; filename?: string; contentType?: string }>;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const fields: Record<string, string> = {};
  const files: Array<{ field: string; path: string; filename?: string; contentType?: string }> = [];
  let hasFile = false;
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (isFilePlaceholder(v)) {
      hasFile = true;
      files.push({
        field: v.field || k,
        path: v.$file,
        filename: v.filename,
        contentType: v.contentType,
      });
    } else if (v === undefined || v === null) {
      // skip
    } else if (typeof v === 'object') {
      fields[k] = JSON.stringify(v);
    } else {
      fields[k] = String(v);
    }
  }
  return hasFile ? { fields, files } : null;
}

interface Props {
  data: unknown;
  onChange: (next: unknown) => void;
  /** 由 FormView 在首次 data 到达时传入的快照，用于 reset 按钮 */
  initialSnapshot?: unknown;
}

export const SubmitBar: React.FC<Props> = ({ data, onChange, initialSnapshot }) => {
  const configs = useMemo(() => readSubmitConfig(data), [data]);
  if (!configs) return null;
  return (
    <div className="jr-submit-bar">
      {configs.map((cfg, i) => (
        <SubmitRow key={i} data={data} cfg={cfg} onChange={onChange} initialSnapshot={initialSnapshot} />
      ))}
    </div>
  );
};

interface RowProps {
  data: unknown;
  cfg: SubmitConfig;
  onChange: (next: unknown) => void;
  initialSnapshot?: unknown;
}

const SubmitRow: React.FC<RowProps> = ({ data, cfg, onChange, initialSnapshot }) => {
  const { httpRequest, openUrl } = useVSCodeBridge();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HttpResponseResult | null>(null);
  const [expandResp, setExpandResp] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);

  const isReset = cfg.type === 'reset';
  const method = (cfg.method || 'POST').toUpperCase();
  const label = cfg.label || (isReset ? 'Reset' : 'Submit');
  const variant: NonNullable<SubmitConfig['variant']> = cfg.variant || (isReset ? 'secondary' : 'primary');

  const previewUrl = (() => {
    if (isReset) return '';
    try {
      const u = String(interpolate(cfg.url || '', data) ?? '');
      const qs = buildQueryString(interpolate(cfg.query, data) as Record<string, unknown> | undefined);
      return appendQuery(u, qs);
    } catch {
      return cfg.url || '';
    }
  })();

  const handleReset = () => {
    if (cfg.confirm && !window.confirm(cfg.confirm)) return;
    if (initialSnapshot === undefined) return;
    onChange(initialSnapshot);
    setResult(null);
    setMissing([]);
  };

  const handleSubmit = async () => {
    const miss = validateRequired(data, cfg.requiredPaths);
    setMissing(miss);
    if (miss.length) return;
    if (cfg.confirm && !window.confirm(cfg.confirm)) return;

    // 合并 auth.bearer → Authorization 头
    const auth = readAuth(data);
    const headers: Record<string, string> = {
      ...(interpolate(cfg.headers, data) as Record<string, string> | undefined || {}),
    };
    if (auth?.bearer && !Object.keys(headers).some((k) => k.toLowerCase() === 'authorization')) {
      const token = String(interpolate(auth.bearer, data) ?? '').trim();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    const url = appendQuery(
      String(interpolate(cfg.url || '', data) ?? ''),
      buildQueryString(interpolate(cfg.query, data) as Record<string, unknown> | undefined),
    );
    const body = buildSubmitBody(data, cfg);
    const multipart = method === 'GET' || method === 'HEAD' ? null : extractMultipart(body);

    setLoading(true);
    setResult(null);
    try {
      const resp = await httpRequest({
        url,
        method,
        headers,
        body: multipart ? undefined : (method === 'GET' || method === 'HEAD' ? undefined : body),
        multipart: multipart || undefined,
        timeoutMs: cfg.timeoutMs,
      });
      setResult(resp);

      if (resp.ok) {
        let nextData: unknown = data;
        // 1) 写回 responsePath
        if (cfg.responsePath) {
          const segs = parsePathExpr(cfg.responsePath);
          if (segs.length > 0) {
            nextData = setByPath(
              data && typeof data === 'object' ? data : {},
              segs,
              resp.body,
            );
            onChange(nextData);
          }
        }
        // 2) openUrl（模板插值以 nextData 为准，能引用刚写回的字段）
        if (cfg.openUrl) {
          const u = String(interpolate(cfg.openUrl, nextData) ?? '').trim();
          if (u) openUrl(u);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const statusTag = (() => {
    if (loading) return <span className="jr-submit-status jr-submit-loading">Sending…</span>;
    if (!result) return null;
    if (result.ok) {
      return (
        <span className="jr-submit-status jr-submit-ok">
          ✓ {result.status ?? 'OK'} · {result.durationMs}ms
        </span>
      );
    }
    return (
      <span className="jr-submit-status jr-submit-err" title={result.error || ''}>
        ✕ {result.status ? `${result.status} ${result.statusText ?? ''}` : 'Failed'}
        {' · '}
        {result.durationMs}ms
      </span>
    );
  })();

  const iconPrefix = isReset ? '↺ ' : variant === 'danger' ? '🗑 ' : loading ? '⏳ ' : '📤 ';

  return (
    <div className="jr-submit-row">
      <div className="jr-submit-main">
        <button
          type="button"
          className={`jr-submit-btn jr-submit-${variant}`}
          onClick={isReset ? handleReset : handleSubmit}
          disabled={loading || (isReset && initialSnapshot === undefined)}
          title={isReset ? 'Reset form to initial state' : `${method} ${previewUrl}`}
        >
          {iconPrefix}
          {label}
        </button>
        {!isReset && (
          <span className="jr-submit-endpoint" title={previewUrl}>
            <span className="jr-submit-method">{method}</span>
            <span className="jr-submit-url">{previewUrl}</span>
          </span>
        )}
        {statusTag}
        {result && !isReset && (
          <button
            type="button"
            className="jr-tab jr-submit-toggle"
            onClick={() => setExpandResp((v) => !v)}
          >
            {expandResp ? 'Hide response' : 'Show response'}
          </button>
        )}
      </div>
      {missing.length > 0 && (
        <div className="jr-submit-missing">
          Missing required field{missing.length > 1 ? 's' : ''}: {missing.join(', ')}
        </div>
      )}
      {result && expandResp && !isReset && (
        <pre className="jr-submit-resp">
{formatResponse(result)}
        </pre>
      )}
    </div>
  );
};

function formatResponse(r: HttpResponseResult): string {
  if (r.error) return `[ERROR] ${r.error}`;
  const head = `HTTP ${r.status ?? ''} ${r.statusText ?? ''}`.trim();
  let body: string;
  if (typeof r.body === 'string') body = r.body;
  else {
    try { body = JSON.stringify(r.body, null, 2); } catch { body = String(r.body); }
  }
  return `${head}\n\n${body}`;
}
