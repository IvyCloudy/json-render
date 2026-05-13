import React, { useMemo, useState } from 'react';
import { useVSCodeBridge, HttpResponseResult } from '../hooks/useVSCodeBridge';
import { getByPath, setByPath, parsePathExpr } from './viewUtils';
import { FORM_META_KEY, FORM_DATA_KEY, FORM_CONFIG_KEY, getFormData } from './formConfigTypes';
import { jsonPath } from '../../common/jsonPath';

/** 内联确认弹窗 */
const ConfirmDialog: React.FC<{ message: string; onConfirm: () => void; onCancel: () => void }> = ({ message, onConfirm, onCancel }) => (
  <div className="jr-confirm-overlay" onClick={onCancel}>
    <div className="jr-confirm-dialog" onClick={(e) => e.stopPropagation()}>
      <p className="jr-confirm-message">{message}</p>
      <div className="jr-confirm-actions">
        <button type="button" className="jr-confirm-btn jr-confirm-cancel" onClick={onCancel}>Cancel</button>
        <button type="button" className="jr-confirm-btn jr-confirm-ok" onClick={onConfirm}>OK</button>
      </div>
    </div>
  </div>
);

/** 响应结果弹窗 */
const ResponseModal: React.FC<{ result: HttpResponseResult; onClose: () => void }> = ({ result, onClose }) => (
  <div className="jr-response-overlay" onClick={onClose}>
    <div className="jr-response-dialog" onClick={(e) => e.stopPropagation()}>
      <div className="jr-response-header">
        <h3 className="jr-response-title">HTTP Response</h3>
        <button type="button" className="jr-response-close" onClick={onClose} title="Close">×</button>
      </div>
      <pre className="jr-response-body">{formatResponse(result)}</pre>
      <div className="jr-response-footer">
        <button type="button" className="jr-response-close-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  </div>
);

/**
 * __form 约定（写在 JSON 文件本身）：
 *
 * {
 *   "__form": {
 *     "auth": {
 *       "bearer": "{{token}}",          // 可选；静态 Bearer token
 *       "tokenRequest": {               // 可选；提交前先请求 token
 *         "url": "https://...",
 *         "method": "POST",
 *         "headers": {},
 *         "body": {},
 *         "timeoutMs": 10000
 *       }
 *     },
 *     "submit": [ ... SubmitConfig ... ] // 对象或数组，见下方接口
 *   }
 * }
 *
 * SubmitConfig.headers 中支持：
 *   - "$tokenResponse" 特殊 key：其值为 JSONPath，解析后合并字段到 headers
 *   - "$.xxx" JSONPath 值：从 token 响应中提取指定字段
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
  tokenRequest?: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  };
}

export interface FormMeta {
  auth?: FormAuth;
  submit?: SubmitConfig | SubmitConfig[];
}

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

/** 特殊 key：在 SubmitConfig.headers 中表示将 token 响应合并到 headers */
const TOKEN_RESPONSE_KEY = '$tokenResponse';

/**
 * 从 tokenResponse 中用 JSONPath 提取值。
 * 返回单个值（单匹配）或数组（多匹配）。
 */
function resolveJsonPath(expr: string, target: unknown): unknown {
  if (!expr || typeof expr !== 'string' || !expr.startsWith('$')) return expr;
  try {
    const results = jsonPath(target, expr);
    if (results.length === 0) return undefined;
    if (results.length === 1) return results[0];
    return results;
  } catch {
    return undefined;
  }
}

/**
 * 对字符串中 $ 开头的 JSONPath 表达式进行替换。
 * 支持纯 JSONPath（整个字符串就是 `$.xxx`）和混合字符串（`Bearer $.token`）。
 */
function resolveTokenRefs(raw: string, tokenResponse: unknown): string {
  if (!tokenResponse || typeof raw !== 'string') return raw;
  return raw.replace(/\$(?:\.(?:\w+|\*)|\[\d+\]|\[\*\])+/g, (match) => {
    const v = resolveJsonPath(match, tokenResponse);
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') {
      try { return JSON.stringify(v); } catch { return String(v); }
    }
    return String(v);
  });
}

/**
 * 处理 SubmitConfig.headers：先通过 interpolate 替换 mustache 模板，
 * 再解析 $tokenResponse 特殊 key 和 $ JSONPath 值。
 */
function resolveHeaders(cfgHeaders: Record<string, string> | undefined, data: unknown, tokenResponse: unknown): Record<string, string> {
  const raw: Record<string, string> = cfgHeaders
    ? (interpolate(cfgHeaders, data) as Record<string, string>)
    : {};
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (key === TOKEN_RESPONSE_KEY) {
      // 若 JSONPath 以 .* 或 [*] 结尾，去掉末尾通配符，定位到父对象再合并其全部字段
      // 例：$.* → 合并根对象；$.json.* → 合并 tokenResponse.json
      let mergePath = value;
      if (mergePath.endsWith('.*')) mergePath = mergePath.slice(0, -2);
      else if (mergePath.endsWith('[*]')) mergePath = mergePath.slice(0, -3);

      const mergeSource = mergePath === '$' || mergePath === ''
        ? tokenResponse
        : resolveJsonPath(mergePath, tokenResponse);
      if (mergeSource && typeof mergeSource === 'object' && !Array.isArray(mergeSource)) {
        for (const [rk, rv] of Object.entries(mergeSource as Record<string, unknown>)) {
          out[rk] = rv === undefined || rv === null ? '' : String(rv);
        }
      }
      continue;
    }
    out[key] = resolveTokenRefs(value, tokenResponse);
  }

  return out;
}

/**
 * 对 body 中 $ 开头的 JSONPath 字符串值进行替换（递归处理嵌套对象）。
 * 应在 interpolate / buildSubmitBody 之后调用。
 */
function resolveBodyTokenRefs(body: unknown, tokenResponse: unknown): unknown {
  if (!tokenResponse) return body;
  if (body === null || body === undefined) return body;
  if (Array.isArray(body)) return body.map((item) => resolveBodyTokenRefs(item, tokenResponse));
  if (typeof body === 'string') return resolveTokenRefs(body, tokenResponse);
  if (typeof body !== 'object') return body;

  const obj = body as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      out[key] = resolveTokenRefs(value, tokenResponse);
    } else if (value && typeof value === 'object' && !isFilePlaceholder(value)) {
      out[key] = resolveBodyTokenRefs(value, tokenResponse);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * 把字符串中的 {{path.to.field}} 替换为 data 对应的值。
 * - 查找路径时，优先从 formData（若存在）取值，再 fallback 到根级
 * - 整个字符串就是一个 {{...}} → 返回原始类型
 * - 否则拼接为字符串
 */
export function interpolate(input: unknown, data: unknown): unknown {
  const scope = makeScope(data);
  if (typeof input !== 'string') {
    if (Array.isArray(input)) return input.map((x) => interpolate(x, data));
    if (input && typeof input === 'object') {
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
  if (m) return getByPath(scope, m[1].trim());
  return input.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_all, expr: string) => {
    const v = getByPath(scope, expr.trim());
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') {
      try { return JSON.stringify(v); } catch { return String(v); }
    }
    return String(v);
  });
}

/**
 * Build interpolation scope: formData fields first, then root-level as fallback.
 * This means {{name}} resolves to formData.name if it exists, otherwise data.name.
 */
function makeScope(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data as Record<string, unknown> || {};
  const obj = data as Record<string, unknown>;
  if (obj[FORM_DATA_KEY] && typeof obj[FORM_DATA_KEY] === 'object' && !Array.isArray(obj[FORM_DATA_KEY])) {
    return { ...(obj as Record<string, unknown>), ...(obj[FORM_DATA_KEY] as Record<string, unknown>) };
  }
  return obj;
}

/** `{ "$file": "/abs/path.png", "field": "avatar", "filename": "x.png", "contentType": "image/png" }` */
function isFilePlaceholder(v: unknown): v is { $file: string; field?: string; filename?: string; contentType?: string } {
  return !!v && typeof v === 'object' && typeof (v as any).$file === 'string';
}

export function buildQueryString(query: Record<string, unknown> | undefined): string {
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

export function appendQuery(url: string, qs: string): string {
  if (!qs) return url;
  return url + (url.includes('?') ? '&' : '?') + qs;
}

function extractFormConfigValues(data: unknown): Record<string, unknown> {
  const formData = getFormData(data);
  if (Object.keys(formData).length > 0) return formData;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const config = (data as any)[FORM_CONFIG_KEY];
  if (!Array.isArray(config)) return {};
  const values: Record<string, unknown> = {};
  for (const item of config) {
    if (item && typeof item === 'object' && item.keyName) {
      if (item.keyValue !== undefined) {
        values[item.keyName] = item.keyValue;
      }
    }
  }
  return values;
}

/** 构造 body：body > bodyPath > 全体（剔除 __form / formConfig / formData） */
export function buildSubmitBody(data: unknown, cfg: SubmitConfig): unknown {
  if (cfg.body !== undefined) {
    const interpolated = interpolate(cfg.body, data);
    if (interpolated && typeof interpolated === 'object' && !Array.isArray(interpolated)) {
      const body = interpolated as Record<string, unknown>;
      if (body.$formConfig === true) {
        const { $formConfig: _drop, ...rest } = body;
        const formValues = extractFormConfigValues(data);
        return { ...formValues, ...rest };
      }
    }
    return interpolated;
  }
  if (cfg.bodyPath) return getByPath(makeScope(data), cfg.bodyPath);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const { [FORM_META_KEY]: _, [FORM_CONFIG_KEY]: __, [FORM_DATA_KEY]: ___, ...rest } = data as Record<string, unknown>;
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
  /** 自定义重置逻辑（如 Ant Design form.resetFields），若提供则优先调用 */
  onReset?: () => void;
}

export const SubmitBar: React.FC<Props> = ({ data, onChange, initialSnapshot, onReset }) => {
  const configs = useMemo(() => readSubmitConfig(data), [data]);
  if (!configs) return null;
  return (
    <div className="jr-submit-bar">
      {configs.map((cfg, i) => (
        <SubmitRow key={i} data={data} cfg={cfg} onChange={onChange} initialSnapshot={initialSnapshot} onReset={onReset} />
      ))}
    </div>
  );
};

interface RowProps {
  data: unknown;
  cfg: SubmitConfig;
  onChange: (next: unknown) => void;
  initialSnapshot?: unknown;
  onReset?: () => void;
}

const SubmitRow: React.FC<RowProps> = ({ data, cfg, onChange, initialSnapshot, onReset }) => {
  const { httpRequest, openUrl } = useVSCodeBridge();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HttpResponseResult | null>(null);
  const [showRespModal, setShowRespModal] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [pendingAction, setPendingAction] = useState<'reset' | 'submit' | null>(null);

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

  const executeReset = () => {
    if (onReset) {
      onReset();
    } else if (initialSnapshot !== undefined) {
      onChange(initialSnapshot);
    }
    setResult(null);
    setMissing([]);
  };

  const executeSubmit = async () => {
    const miss = validateRequired(data, cfg.requiredPaths);
    setMissing(miss);
    if (miss.length) return;

    const auth = readAuth(data);

    // —— 如果配置了 tokenRequest，先请求 token ——
    let tokenResponse: unknown = undefined;
    if (auth?.tokenRequest) {
      const tr = auth.tokenRequest;
      setLoading(true);
      try {
        const tresp = await httpRequest({
          url: String(interpolate(tr.url, data) ?? ''),
          method: (tr.method || 'POST').toUpperCase(),
          headers: interpolate(tr.headers, data) as Record<string, string> | undefined,
          body: interpolate(tr.body, data),
          timeoutMs: tr.timeoutMs,
        });
        if (!tresp.ok) {
          setResult(tresp);
          setShowRespModal(true);
          return;
        }
        tokenResponse = tresp.body;
      } catch (e: any) {
        setResult({ ok: false, error: `Token request failed: ${e?.message || e}`, durationMs: 0 });
        setShowRespModal(true);
        return;
      } finally {
        setLoading(false);
      }
    }

    // —— 构建 headers：先 mustache 模板 → 再 $tokenResponse / $.xxx 解析 ——
    const headers = resolveHeaders(cfg.headers, data, tokenResponse);

    // 如果没有显式设置 Authorization 头，且 auth.bearer 存在，注入 Bearer
    if (auth?.bearer && !Object.keys(headers).some((k) => k.toLowerCase() === 'authorization')) {
      const token = String(interpolate(auth.bearer, data) ?? '').trim();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    const url = appendQuery(
      String(interpolate(cfg.url || '', data) ?? ''),
      buildQueryString(interpolate(cfg.query, data) as Record<string, unknown> | undefined),
    );
    const rawBody = buildSubmitBody(data, cfg);
    const body = resolveBodyTokenRefs(rawBody, tokenResponse);
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
      setShowRespModal(true);

      if (resp.ok) {
        let nextData: unknown = data;
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
        if (cfg.openUrl) {
          const u = String(interpolate(cfg.openUrl, nextData) ?? '').trim();
          if (u) openUrl(u);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    if (cfg.confirm) {
      setPendingAction('reset');
    } else {
      executeReset();
    }
  };

  const handleSubmit = () => {
    const miss = validateRequired(data, cfg.requiredPaths);
    setMissing(miss);
    if (miss.length) return;
    if (cfg.confirm) {
      setPendingAction('submit');
    } else {
      executeSubmit();
    }
  };

  const handleConfirmOk = () => {
    setPendingAction(null);
    if (pendingAction === 'reset') {
      executeReset();
    } else if (pendingAction === 'submit') {
      executeSubmit();
    }
  };

  const handleConfirmCancel = () => {
    setPendingAction(null);
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
      {pendingAction && cfg.confirm && (
        <ConfirmDialog message={cfg.confirm} onConfirm={handleConfirmOk} onCancel={handleConfirmCancel} />
      )}
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
      </div>
      {missing.length > 0 && (
        <div className="jr-submit-missing">
          Missing required field{missing.length > 1 ? 's' : ''}: {missing.join(', ')}
        </div>
      )}
      {showRespModal && result && !isReset && (
        <ResponseModal result={result} onClose={() => setShowRespModal(false)} />
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
