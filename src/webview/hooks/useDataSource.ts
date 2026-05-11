import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormInstance } from 'antd';
import { FormItemDataSource } from '../views/formConfigTypes';
import { HttpRequestOptions, HttpResponseResult } from '../hooks/useVSCodeBridge';
import { interpolate, buildQueryString, appendQuery } from '../views/SubmitBar';
import { getByPath } from '../views/viewUtils';

interface CacheEntry {
  options: Array<{ label: string; value: unknown; disabled?: boolean }>;
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

function setCache(key: string, options: Array<{ label: string; value: unknown; disabled?: boolean }>, ttl: number): void {
  cache.set(key, { options, expiresAt: Date.now() + ttl });
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

function transformResponse(
  body: unknown,
  transform: NonNullable<FormItemDataSource['transform']>,
): Array<{ label: string; value: unknown; disabled?: boolean }> {
  const path = transform.path ?? '';
  const data = path ? getByPath(body, path) : body;
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

export function useDataSource(
  dataSource: FormItemDataSource | undefined,
  form: FormInstance,
  httpRequest: (req: HttpRequestOptions) => Promise<HttpResponseResult>,
): { options: Array<{ label: string; value: unknown; disabled?: boolean }>; loading: boolean; error: string | null } {
  const [options, setOptions] = useState<Array<{ label: string; value: unknown; disabled?: boolean }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const watchValues: Record<string, unknown> = {};
  if (dataSource?.watch) {
    for (const key of dataSource.watch) {
      watchValues[key] = form.getFieldValue(key);
    }
  }

  const fetchData = useCallback(async () => {
    if (!dataSource?.http?.url) return;

    const currentRequestId = ++requestRef.current;

    if (dataSource.condition && !evaluateCondition(dataSource.condition, form.getFieldsValue())) {
      setOptions(dataSource.fallback ?? []);
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
      setOptions(cached.options);
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
        const transformed = dataSource.transform
          ? transformResponse(resp.body, dataSource.transform)
          : (Array.isArray(resp.body)
            ? resp.body.map((item: any) => ({ label: String(item.label ?? item.value ?? ''), value: item.value ?? item.label }))
            : []);
        setOptions(transformed);
        setCache(cacheKey, transformed, ttl);
      } else {
        setOptions(dataSource.fallback ?? []);
        setError(resp.error ?? `HTTP ${resp.status}`);
      }
    } catch (e: any) {
      if (currentRequestId !== requestRef.current) return;
      setOptions(dataSource.fallback ?? []);
      setError(e?.message ?? 'Request failed');
    } finally {
      if (currentRequestId === requestRef.current) {
        setLoading(false);
      }
    }
  }, [dataSource, httpRequest, form, watchValues]);

  useEffect(() => {
    if (!dataSource?.http?.url) {
      setOptions([]);
      return;
    }
    fetchData();
  }, [fetchData, dataSource]);

  return { options, loading, error };
}
