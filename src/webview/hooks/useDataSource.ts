import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormInstance } from 'antd';
import { FormItemDataSource } from '../views/formConfigTypes';
import { HttpRequestOptions, HttpResponseResult } from '../hooks/useVSCodeBridge';
import { interpolate, buildQueryString, appendQuery } from '../views/SubmitBar';
import { jsonPath } from '../../common/jsonPath';

interface CacheEntry {
  options: Array<{ label: string; value: unknown; disabled?: boolean }>;
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function generateCacheKey(url: string, query: Record<string, unknown> | undefined): string {
  const qs = query ? Object.keys(query).sort().map((k) => `${k}=${JSON.stringify(query[k])}`).join('&') : '';
  return `${url}?${qs}`;
}

function getCached(key: string, ttl: number): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function setCache(key: string, options: Array<{ label: string; value: unknown; disabled?: boolean }>, value: unknown, ttl: number): void {
  cache.set(key, { options, value, expiresAt: Date.now() + ttl });
}

function evaluateCondition(condition: string, data: unknown): boolean {
  const interpolated = interpolate(condition, data);
  if (typeof interpolated === 'string') {
    const trimmed = interpolated.trim();
    if (trimmed === '' || trimmed === '0' || trimmed === 'false' || trimmed === 'null' || trimmed === 'undefined') return false;
    return true;
  }
  if (typeof interpolated === 'number') return interpolated !== 0;
  if (typeof interpolated === 'boolean') return interpolated;
  return interpolated !== null && interpolated !== undefined;
}

/**
 * 提取响应数据：统一使用 JSONPath 语法（必须以 $ 开头）
 * 若 path 为空则返回整个 body；若不以 $ 开头则自动补全
 */
function extractData(body: unknown, path: string): unknown {
  if (!path) return body;
  const normalized = path.startsWith('$') ? path : `$.${path}`;
  const results = jsonPath(body, normalized);
  return results.length > 0 ? results[0] : undefined;
}

function transformResponse(
  body: unknown,
  transform: NonNullable<FormItemDataSource['transform']>,
): Array<{ label: string; value: unknown; disabled?: boolean }> {
  const data = extractData(body, transform.path ?? '');
  if (!Array.isArray(data)) return [];

  const labelField = transform.labelField ?? 'label';
  const valueField = transform.valueField ?? 'value';
  const disabledField = transform.disabledField;

  return data.map((item: Record<string, unknown>) => ({
    label: String(item[labelField] ?? ''),
    value: item[valueField],
    ...(disabledField && item[disabledField] !== undefined ? { disabled: Boolean(item[disabledField]) } : {}),
  }));
}

function extractValue(body: unknown, transform: NonNullable<FormItemDataSource['transform']>): unknown {
  return extractData(body, transform.path ?? '');
}

const SELECT_LIKE_COMPONENTS = new Set(['Select', 'TreeSelect', 'Cascader', 'Transfer', 'Checkbox.Group', 'Radio.Group']);

/** 请求失败后的重试退避延迟（毫秒） */
const RETRY_DELAYS = [0, 1000, 3000, 5000, 10000];

export function useDataSource(
  dataSource: FormItemDataSource | undefined,
  form: FormInstance,
  httpRequest: (req: HttpRequestOptions) => Promise<HttpResponseResult>,
  componentType?: string,
): { options: Array<{ label: string; value: unknown; disabled?: boolean }>; loading: boolean; error: string | null; value: unknown } {
  const [options, setOptions] = useState<Array<{ label: string; value: unknown; disabled?: boolean }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState<unknown>(undefined);
  const requestRef = useRef(0);
  const failureCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 稳定 watchValues 引用，仅在表单值实际变化时重建
  const watchValues: Record<string, unknown> = useMemo(() => {
    if (!dataSource?.watch) return {};
    const result: Record<string, unknown> = {};
    for (const key of dataSource.watch) {
      result[key] = form.getFieldValue(key);
    }
    return result;
  }, [dataSource, form, ...((dataSource?.watch ?? []).map((k) => form.getFieldValue(k)))]);

  const effectiveMode = dataSource?.mode ?? (componentType && SELECT_LIKE_COMPONENTS.has(componentType) ? 'options' : 'value');

  const fetchData = useCallback(async () => {
    if (!dataSource?.http?.url) return;

    // 清理之前的重试定时器
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    const currentRequestId = ++requestRef.current;

    if (dataSource.condition && !evaluateCondition(dataSource.condition, form.getFieldsValue())) {
      failureCountRef.current = 0;
      setOptions(dataSource.fallback ?? []);
      setValue(undefined);
      setError(null);
      return;
    }

    const httpConfig = dataSource.http;
    const interpolatedUrl = String(interpolate(httpConfig.url, form.getFieldsValue()) ?? '');
    const interpolatedQuery = interpolate(httpConfig.query, form.getFieldsValue()) as Record<string, unknown> | undefined;
    const interpolatedHeaders = interpolate(httpConfig.headers, form.getFieldsValue()) as Record<string, string> | undefined;
    const interpolatedBody = interpolate(httpConfig.body, form.getFieldsValue());

    const qs = buildQueryString(interpolatedQuery);
    const fullUrl = appendQuery(interpolatedUrl, qs);

    const ttl = dataSource.cache?.ttl ?? 30000;
    const cacheKey = generateCacheKey(fullUrl, interpolatedQuery);
    const cached = getCached(cacheKey, ttl);
    if (cached) {
      failureCountRef.current = 0;
      if (effectiveMode === 'options') {
        setOptions(cached.options);
      } else {
        setValue(cached.value);
      }
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const resp = await httpRequest({
        url: fullUrl,
        method: httpConfig.method ?? 'GET',
        headers: interpolatedHeaders,
        body: httpConfig.method === 'GET' ? undefined : interpolatedBody,
        timeoutMs: httpConfig.timeoutMs,
      });

      if (currentRequestId !== requestRef.current) return;

      if (resp.ok) {
        failureCountRef.current = 0;
        if (effectiveMode === 'options' || !dataSource.transform) {
          const transformed = dataSource.transform
            ? transformResponse(resp.body, dataSource.transform)
            : (Array.isArray(resp.body)
              ? resp.body.map((item: any) => ({ label: String(item.label ?? item.value ?? ''), value: item.value ?? item.label }))
              : []);
          setOptions(transformed);
          setCache(cacheKey, transformed, undefined, ttl);
        } else {
          const extracted = dataSource.transform
            ? extractValue(resp.body, dataSource.transform)
            : resp.body;
          setValue(extracted);
          setCache(cacheKey, [], extracted, ttl);
        }
      } else {
        failureCountRef.current = Math.min(failureCountRef.current + 1, RETRY_DELAYS.length - 1);
        setOptions(dataSource.fallback ?? []);
        setValue(undefined);
        setError(resp.error ?? `HTTP ${resp.status}`);
        // 失败后退避重试
        const delay = RETRY_DELAYS[failureCountRef.current];
        if (delay > 0) {
          retryTimerRef.current = setTimeout(() => {
            if (requestRef.current === currentRequestId) {
              fetchData();
            }
          }, delay);
        }
      }
    } catch (e: any) {
      if (currentRequestId !== requestRef.current) return;
      failureCountRef.current = Math.min(failureCountRef.current + 1, RETRY_DELAYS.length - 1);
      setOptions(dataSource.fallback ?? []);
      setValue(undefined);
      setError(e?.message ?? 'Request failed');
      // 失败后退避重试
      const delay = RETRY_DELAYS[failureCountRef.current];
      if (delay > 0) {
        retryTimerRef.current = setTimeout(() => {
          if (requestRef.current === currentRequestId) {
            fetchData();
          }
        }, delay);
      }
    } finally {
      if (currentRequestId === requestRef.current) {
        setLoading(false);
      }
    }
  }, [dataSource, httpRequest, form, watchValues, effectiveMode]);

  useEffect(() => {
    if (!dataSource?.http?.url) {
      setOptions([]);
      setValue(undefined);
      return;
    }
    fetchData();
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [fetchData, dataSource]);

  return { options, loading, error, value };
}
