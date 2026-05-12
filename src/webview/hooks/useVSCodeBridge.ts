import { useEffect, useRef, useState } from 'react';

interface VSCodeApi {
  postMessage(msg: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState<T = unknown>(state: T): void;
}

declare function acquireVsCodeApi(): VSCodeApi;

let vscodeApi: VSCodeApi | null = null;
function getApi(): VSCodeApi {
  if (!vscodeApi) vscodeApi = acquireVsCodeApi();
  return vscodeApi;
}

export type FileKind = 'json' | 'jsonl';

export interface BridgeState {
  data: unknown;
  fileName: string;
  fileKind: FileKind;
  defaultView: string;
  autoSync: boolean;
  parseError?: string;
  rawText?: string;
}

type CsvImportListener = (result: { rows: Record<string, string>[] | null; error?: string }) => void;

export interface HttpResponseResult {
  ok: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: unknown;
  error?: string;
  durationMs: number;
}

export interface HttpRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** 如果提供，则走 multipart/form-data（此时 body 被忽略） */
  multipart?: {
    fields?: Record<string, string>;
    files?: Array<{ field: string; path: string; filename?: string; contentType?: string }>;
  };
}

type HttpListener = (result: HttpResponseResult) => void;

export function useVSCodeBridge() {
  const [state, setState] = useState<BridgeState>({
    data: null,
    fileName: '',
    fileKind: 'json',
    defaultView: 'tree',
    autoSync: true,
  });
  const readyRef = useRef(false);
  const csvListenersRef = useRef<CsvImportListener[]>([]);
  const httpListenersRef = useRef<Map<string, HttpListener>>(new Map());

  useEffect(() => {
    const api = getApi();
    const onMsg = (e: MessageEvent) => {
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'init') {
        setState({
          data: msg.payload,
          fileName: msg.fileName,
          fileKind: msg.fileKind ?? 'json',
          defaultView: msg.defaultView,
          autoSync: msg.autoSync,
        });
      } else if (msg.type === 'sync') {
        const p = msg.payload as any;
        if (p && typeof p === 'object' && p.__parseError) {
          setState((s) => ({ ...s, parseError: p.message, rawText: p.raw, fileKind: msg.fileKind ?? s.fileKind }));
        } else {
          setState((s) => ({
            ...s,
            data: p,
            parseError: undefined,
            rawText: undefined,
            fileKind: msg.fileKind ?? s.fileKind,
          }));
        }
      } else if (msg.type === 'config') {
        setState((s) => ({ ...s, defaultView: msg.defaultView, autoSync: msg.autoSync }));
      } else if (msg.type === 'importCsvResult') {
        const listeners = csvListenersRef.current.slice();
        csvListenersRef.current = [];
        listeners.forEach((l) => l({ rows: msg.rows, error: msg.error }));
      } else if (msg.type === 'httpResponse') {
        const id = (msg as any).requestId as string;
        const resolver = httpListenersRef.current.get(id);
        if (resolver) {
          httpListenersRef.current.delete(id);
          resolver({
            ok: Boolean(msg.ok),
            status: msg.status,
            statusText: msg.statusText,
            headers: msg.headers,
            body: msg.body,
            error: msg.error,
            durationMs: msg.durationMs,
          });
        }
      }
    };
    window.addEventListener('message', onMsg);
    if (!readyRef.current) {
      readyRef.current = true;
      api.postMessage({ type: 'ready' });
    }
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const postUpdate = (payload: unknown) => {
    getApi().postMessage({ type: 'update', payload });
  };
  const postError = (message: string) => {
    getApi().postMessage({ type: 'error', message });
  };
  const exportCsv = (content: string, suggestedName: string) => {
    getApi().postMessage({ type: 'exportCsv', content, suggestedName });
  };
  const importCsv = () =>
    new Promise<{ rows: Record<string, string>[] | null; error?: string }>((resolve) => {
      csvListenersRef.current.push(resolve);
      getApi().postMessage({ type: 'importCsvRequest' });
    });

  const httpRequest = (opts: HttpRequestOptions) =>
    new Promise<HttpResponseResult>((resolve) => {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      httpListenersRef.current.set(requestId, resolve);
      getApi().postMessage({
        type: 'httpRequest',
        requestId,
        url: opts.url,
        method: opts.method,
        headers: opts.headers,
        body: opts.body,
        timeoutMs: opts.timeoutMs,
        multipart: opts.multipart,
      });
    });

  const openUrl = (url: string) => {
    getApi().postMessage({ type: 'openUrl', url });
  };

  return { state, postUpdate, postError, exportCsv, importCsv, httpRequest, openUrl };
}
