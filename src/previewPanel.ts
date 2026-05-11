import * as vscode from 'vscode';
import * as path from 'path';
import { jsonlParse, jsonlStringify, isJsonlFileName } from './common/jsonl';

type FileKind = 'json' | 'jsonl';

type InboundMessage =
  | { type: 'ready' }
  | { type: 'update'; payload: unknown }
  | { type: 'error'; message: string }
  | { type: 'exportCsv'; content: string; suggestedName: string }
  | { type: 'importCsvRequest' }
  | { type: 'openUrl'; url: string }
  | {
      type: 'httpRequest';
      requestId: string;
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
      timeoutMs?: number;
      /** 如果提供，则走 multipart/form-data：text fields + 文件字段 */
      multipart?: {
        fields?: Record<string, string>;
        files?: Array<{ field: string; path: string; filename?: string; contentType?: string }>;
      };
    };

type OutboundMessage =
  | {
      type: 'init';
      payload: unknown;
      fileName: string;
      fileKind: FileKind;
      defaultView: string;
      autoSync: boolean;
      schema: unknown | null;
    }
  | { type: 'sync'; payload: unknown; fileKind: FileKind; schema?: unknown | null }
  | { type: 'config'; defaultView: string; autoSync: boolean }
  | { type: 'importCsvResult'; rows: Record<string, string>[] | null; error?: string }
  | {
      type: 'httpResponse';
      requestId: string;
      ok: boolean;
      status?: number;
      statusText?: string;
      headers?: Record<string, string>;
      body?: unknown;
      error?: string;
      durationMs: number;
    };

/**
 * 全局单例预览面板：一次只有一个 JSON Render 窗口，
 * 新打开的 JSON 文件会复用已有窗口并覆盖其内容。
 */
export class PreviewPanel {
  private static readonly viewType = 'jsonRender.preview';
  private static instance: PreviewPanel | null = null;

  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private document: vscode.TextDocument;
  /** 面板级别的订阅（整个 webview 生命周期内只注册一次） */
  private disposables: vscode.Disposable[] = [];
  /** 文档级别的订阅（每次切换文档时重建） */
  private docDisposables: vscode.Disposable[] = [];
  private suppressNextDocChange = false;
  private writeTimer: NodeJS.Timeout | undefined;
  private pendingValue: unknown;

  static createOrShow(context: vscode.ExtensionContext, document: vscode.TextDocument) {
    const column = vscode.ViewColumn.Beside;
    const existing = PreviewPanel.instance;

    if (existing) {
      existing.switchDocument(document);
      existing.panel.reveal(column, true);
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      PreviewPanel.viewType,
      `JSON Render · ${path.basename(document.fileName)}`,
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist'),
          vscode.Uri.joinPath(context.extensionUri, 'media'),
        ],
      }
    );

    const instance = new PreviewPanel(panel, context, document);
    PreviewPanel.instance = instance;
    return instance;
  }

  static disposeAll() {
    PreviewPanel.instance?.dispose();
    PreviewPanel.instance = null;
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, document: vscode.TextDocument) {
    this.panel = panel;
    this.context = context;
    this.document = document;

    this.panel.webview.html = this.buildHtml();
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');
    this.panel.title = `JSON Render · ${path.basename(document.fileName)}`;

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg: InboundMessage) => this.handleInbound(msg),
      null,
      this.disposables
    );

    vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (e.affectsConfiguration('jsonRender')) {
          const cfg = this.readConfig();
          this.postMessage({ type: 'config', defaultView: cfg.defaultView, autoSync: cfg.autoSync });
        }
      },
      null,
      this.disposables
    );

    this.bindDocument();
  }

  /** 绑定当前 document 的变更 / 关闭订阅，切换文档时会被重建 */
  private bindDocument() {
    this.disposeDocSubscriptions();

    vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document.uri.toString() !== this.document.uri.toString()) return;
        if (this.suppressNextDocChange) {
          this.suppressNextDocChange = false;
          return;
        }
        this.pushToWebview('sync');
      },
      null,
      this.docDisposables
    );

    vscode.workspace.onDidCloseTextDocument(
      (doc) => {
        if (doc.uri.toString() === this.document.uri.toString()) {
          // 源文档被关闭时不再关闭窗口，保留 UI 在原状态供用户查看。
          // 若后续又打开另一个 JSON，会直接覆盖。
        }
      },
      null,
      this.docDisposables
    );
  }

  private disposeDocSubscriptions() {
    while (this.docDisposables.length) {
      const d = this.docDisposables.pop();
      try { d?.dispose(); } catch { /* noop */ }
    }
  }

  /** 切换面板展示的文档，复用已有 webview 。 */
  private switchDocument(document: vscode.TextDocument) {
    if (this.document.uri.toString() === document.uri.toString()) {
      // 同一文档：刷新一次数据即可
      this.pushToWebview('sync');
      return;
    }
    // 取消未落盘的写回，防止把旧文档的编辑数据写到新文档
    if (this.writeTimer) { clearTimeout(this.writeTimer); this.writeTimer = undefined; }
    this.pendingValue = undefined;
    this.suppressNextDocChange = false;

    this.document = document;
    this.panel.title = `JSON Render · ${path.basename(document.fileName)}`;
    this.bindDocument();
    // 下发 init 让 webview 完全重置（fileName / fileKind / schema / 默认视图等）
    this.pushToWebview('init');
  }

  private async handleInbound(msg: InboundMessage) {
    switch (msg.type) {
      case 'ready':
        await this.pushToWebview('init');
        break;
      case 'update':
        this.scheduleWriteBack(msg.payload);
        break;
      case 'error':
        vscode.window.showErrorMessage(`JSON Render: ${msg.message}`);
        break;
      case 'exportCsv':
        await this.saveCsv(msg.content, msg.suggestedName);
        break;
      case 'importCsvRequest':
        await this.pickCsv();
        break;
      case 'httpRequest':
        await this.doHttpRequest(msg);
        break;
      case 'openUrl':
        try {
          await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        } catch (e: any) {
          vscode.window.showErrorMessage(`JSON Render: open url failed - ${e?.message ?? e}`);
        }
        break;
    }
  }

  private async doHttpRequest(msg: Extract<InboundMessage, { type: 'httpRequest' }>) {
    const started = Date.now();
    const method = (msg.method || 'POST').toUpperCase();
    const headers: Record<string, string> = { ...(msg.headers || {}) };
    let body: string | Buffer | undefined;

    if (msg.multipart && (method !== 'GET' && method !== 'HEAD')) {
      // ---- multipart/form-data ----
      try {
        const baseDir = path.dirname(this.document.uri.fsPath);
        const normalized = {
          fields: msg.multipart.fields,
          files: (msg.multipart.files || []).map((f) => ({
            ...f,
            path: path.isAbsolute(f.path) ? f.path : path.resolve(baseDir, f.path),
          })),
        };
        const built = await buildMultipart(normalized);
        body = built.body;
        // 覆盖 content-type（带边界）
        for (const k of Object.keys(headers)) {
          if (k.toLowerCase() === 'content-type') delete headers[k];
        }
        headers['Content-Type'] = built.contentType;
      } catch (e: any) {
        this.postMessage({
          type: 'httpResponse',
          requestId: msg.requestId,
          ok: false,
          error: `multipart build failed - ${e?.message ?? e}`,
          durationMs: Date.now() - started,
        });
        return;
      }
    } else if (msg.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      // 仅对允许带 body 的方法序列化 body
      body = typeof msg.body === 'string' ? (msg.body as string) : JSON.stringify(msg.body);
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const timeoutMs = msg.timeoutMs && msg.timeoutMs > 0 ? msg.timeoutMs : 30000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Node 18+ / VSCode 运行时内置 fetch
      const res: any = await (globalThis as any).fetch(msg.url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed: unknown = text;
      const ct = String(res.headers?.get?.('content-type') || '');
      if (ct.includes('application/json')) {
        try { parsed = JSON.parse(text); } catch { parsed = text; }
      }
      const respHeaders: Record<string, string> = {};
      try {
        res.headers?.forEach?.((v: string, k: string) => { respHeaders[k] = v; });
      } catch { /* noop */ }
      this.postMessage({
        type: 'httpResponse',
        requestId: msg.requestId,
        ok: Boolean(res.ok),
        status: res.status,
        statusText: res.statusText,
        headers: respHeaders,
        body: parsed,
        durationMs: Date.now() - started,
      });
    } catch (e: any) {
      const aborted = e?.name === 'AbortError';
      this.postMessage({
        type: 'httpResponse',
        requestId: msg.requestId,
        ok: false,
        error: aborted ? `Timed out after ${timeoutMs}ms` : (e?.message ?? String(e)),
        durationMs: Date.now() - started,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private detectKind(): FileKind {
    if (isJsonlFileName(this.document.fileName)) return 'jsonl';
    if (this.document.languageId === 'jsonl' || this.document.languageId === 'ndjson') return 'jsonl';
    return 'json';
  }

  private parseDocument(): { ok: true; value: unknown; kind: FileKind } | { ok: false; message: string; raw: string; kind: FileKind } {
    const kind = this.detectKind();
    const text = this.document.getText();
    try {
      if (kind === 'jsonl') {
        const { items } = jsonlParse(text);
        return { ok: true, value: items, kind };
      }
      if (text.trim() === '') return { ok: true, value: null, kind };
      return { ok: true, value: JSON.parse(text), kind };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e), raw: text, kind };
    }
  }

  private async pushToWebview(kind: 'init' | 'sync') {
    const parsed = this.parseDocument();
    if (!parsed.ok) {
      this.postMessage({
        type: 'sync',
        fileKind: parsed.kind,
        payload: { __parseError: true, message: parsed.message, raw: parsed.raw },
      });
      return;
    }
    const schema = await this.loadSchema();
    if (kind === 'init') {
      const cfg = this.readConfig();
      this.postMessage({
        type: 'init',
        payload: parsed.value,
        fileName: path.basename(this.document.fileName),
        fileKind: parsed.kind,
        defaultView: cfg.defaultView,
        autoSync: cfg.autoSync,
        schema,
      });
    } else {
      this.postMessage({ type: 'sync', payload: parsed.value, fileKind: parsed.kind, schema });
    }
  }

  private scheduleWriteBack(value: unknown) {
    if (!this.readConfig().autoSync) return;
    this.pendingValue = value;
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.flushWriteBack(), 200);
  }

  private async flushWriteBack() {
    const value = this.pendingValue;
    this.pendingValue = undefined;
    try {
      const kind = this.detectKind();
      let newText: string;
      if (kind === 'jsonl') {
        if (!Array.isArray(value)) {
          throw new Error('JSONL root must be an array. Abort write-back.');
        }
        newText = jsonlStringify(value);
      } else {
        newText = JSON.stringify(value, null, 2);
      }
      if (newText === this.document.getText()) return;

      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        this.document.positionAt(0),
        this.document.positionAt(this.document.getText().length)
      );
      edit.replace(this.document.uri, fullRange, newText);
      this.suppressNextDocChange = true;
      const applied = await vscode.workspace.applyEdit(edit);
      // applyEdit 只改内存 TextDocument，磁盘文件并未变化；
      // 按配置 autoSave 自动保存，避免用户以为编辑没生效。
      if (applied && this.readConfig().autoSave && this.document.isDirty) {
        try {
          await this.document.save();
        } catch (saveErr: any) {
          vscode.window.showWarningMessage(
            `JSON Render: auto-save failed - ${saveErr?.message ?? saveErr}. The document is dirty; press Cmd/Ctrl+S to save manually.`
          );
        }
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`JSON Render: write back failed - ${e?.message ?? e}`);
    }
  }

  private async loadSchema(): Promise<unknown | null> {
    const cfg = this.readConfig();
    const docUri = this.document.uri;
    const dir = vscode.Uri.joinPath(docUri, '..');
    const candidates: vscode.Uri[] = [];
    if (cfg.schemaFile) {
      candidates.push(vscode.Uri.joinPath(dir, cfg.schemaFile));
    } else {
      const base = path.basename(this.document.fileName).replace(/\.(json|jsonc|jsonl|ndjson)$/i, '');
      candidates.push(vscode.Uri.joinPath(dir, `${base}.schema.json`));
      candidates.push(vscode.Uri.joinPath(dir, 'schema.json'));
    }
    for (const uri of candidates) {
      try {
        const data = await vscode.workspace.fs.readFile(uri);
        return JSON.parse(Buffer.from(data).toString('utf8'));
      } catch {
        /* not found, try next */
      }
    }
    return null;
  }

  private async saveCsv(content: string, suggestedName: string) {
    const dir = vscode.Uri.joinPath(this.document.uri, '..');
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(dir, suggestedName || 'export.csv'),
      filters: { CSV: ['csv'] },
    });
    if (!target) return;
    try {
      await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
      vscode.window.showInformationMessage(`CSV exported to ${target.fsPath}`);
    } catch (e: any) {
      vscode.window.showErrorMessage(`JSON Render: export CSV failed - ${e?.message ?? e}`);
    }
  }

  private async pickCsv() {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { CSV: ['csv'] },
    });
    if (!picked || !picked.length) {
      this.postMessage({ type: 'importCsvResult', rows: null });
      return;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(picked[0]);
      const text = Buffer.from(bytes).toString('utf8');
      const { csvParse } = await import('./common/csv');
      const rows = csvParse(text);
      this.postMessage({ type: 'importCsvResult', rows });
    } catch (e: any) {
      this.postMessage({ type: 'importCsvResult', rows: null, error: e?.message ?? String(e) });
    }
  }

  private postMessage(msg: OutboundMessage) {
    this.panel.webview.postMessage(msg);
  }

  private readConfig() {
    const cfg = vscode.workspace.getConfiguration('jsonRender');
    return {
      defaultView: cfg.get<string>('defaultView', 'tree'),
      autoSync: cfg.get<boolean>('autoSync', true),
      autoSave: cfg.get<boolean>('autoSave', true),
      schemaFile: cfg.get<string>('schemaFile', ''),
    };
  }

  private buildHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
    const nonce = getNonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>JSON Render</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose() {
    if (PreviewPanel.instance === this) {
      PreviewPanel.instance = null;
    }
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.disposeDocSubscriptions();
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      try { d?.dispose(); } catch { /* noop */ }
    }
  }
}

function getNonce(): string {
  let t = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) t += chars.charAt(Math.floor(Math.random() * chars.length));
  return t;
}

/** 构造 multipart/form-data body（纯 Buffer 拼接，无依赖） */
async function buildMultipart(opts: {
  fields?: Record<string, string>;
  files?: Array<{ field: string; path: string; filename?: string; contentType?: string }>;
}): Promise<{ body: Buffer; contentType: string }> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const boundary = '----JsonRenderBoundary' + Math.random().toString(36).slice(2, 12);
  const CRLF = '\r\n';
  const parts: Buffer[] = [];

  for (const [name, value] of Object.entries(opts.fields || {})) {
    parts.push(Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${encodeFieldName(name)}"${CRLF}${CRLF}` +
      `${value ?? ''}${CRLF}`,
      'utf8',
    ));
  }

  for (const f of opts.files || []) {
    if (!f?.path || !f?.field) continue;
    const data = await fs.readFile(f.path);
    const filename = f.filename || path.basename(f.path);
    const ct = f.contentType || guessContentType(filename);
    parts.push(Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${encodeFieldName(f.field)}"; filename="${encodeFieldName(filename)}"${CRLF}` +
      `Content-Type: ${ct}${CRLF}${CRLF}`,
      'utf8',
    ));
    parts.push(data);
    parts.push(Buffer.from(CRLF, 'utf8'));
  }
  parts.push(Buffer.from(`--${boundary}--${CRLF}`, 'utf8'));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function encodeFieldName(s: string): string {
  // 遵循 RFC 7578：name 用 " 转义；这里简单替换即可
  return String(s).replace(/"/g, '%22').replace(/\r|\n/g, '');
}

function guessContentType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';
  const map: Record<string, string> = {
    json: 'application/json',
    txt: 'text/plain',
    csv: 'text/csv',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    pdf: 'application/pdf',
    zip: 'application/zip',
  };
  return map[ext] || 'application/octet-stream';
}
