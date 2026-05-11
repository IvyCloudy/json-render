import * as http from 'http';
import * as vscode from 'vscode';

/**
 * 轻量 mock HTTP 服务器，仅用于 SubmitBar 的离线自测。
 *
 * 端点（POST/PUT/DELETE/GET 都接受）：
 *   /echo          - 回显：200 + { method, path, query, headers, body, receivedAt, redirect }
 *   /slow?ms=5000  - 延迟 ms 毫秒后返回 /echo 的内容（用于测试 timeoutMs）
 *   /fail?code=500 - 返回指定状态码 + { error: "simulated" }
 *   /upload        - 专门接收 multipart/form-data；返回解析出的字段列表和文件概要
 *
 * 响应里带 redirect 字段，指向 /view/{随机 id}，可用 openUrl 配合验证。
 */
export interface MockServerInfo {
  port: number;
  baseUrl: string;
  dispose(): void;
}

export async function startMockServer(
  output: vscode.OutputChannel,
  preferredPort = 39870,
): Promise<MockServerInfo | null> {
  return new Promise<MockServerInfo | null>((resolve) => {
    const server = http.createServer((req, res) => handle(req, res, output));
    server.on('error', (err: any) => {
      output.appendLine(`[mock] failed to listen: ${err?.message ?? err}`);
      resolve(null);
    });
    server.listen(preferredPort, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : preferredPort;
      const baseUrl = `http://127.0.0.1:${port}`;
      output.appendLine(`[mock] listening on ${baseUrl}`);
      resolve({
        port,
        baseUrl,
        dispose: () => {
          try { server.close(); } catch { /* noop */ }
        },
      });
    });
  });
}

function handle(req: http.IncomingMessage, res: http.ServerResponse, out: vscode.OutputChannel) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = url.pathname;
  const query: Record<string, string | string[]> = {};
  url.searchParams.forEach((v, k) => {
    if (k in query) {
      const prev = query[k];
      query[k] = Array.isArray(prev) ? [...prev, v] : [prev as string, v];
    } else {
      query[k] = v;
    }
  });

  collectBody(req).then(async (raw) => {
    const headers = req.headers as Record<string, string | string[] | undefined>;
    const ct = String(headers['content-type'] || '');

    out.appendLine(`[mock] ${req.method} ${pathname} (${raw.length} bytes)`);

    if (pathname === '/fail') {
      const code = Math.max(400, Math.min(599, Number(query.code) || 500));
      return json(res, code, { error: 'simulated failure', code });
    }

    if (pathname === '/slow') {
      const ms = Math.max(0, Math.min(60000, Number(query.ms) || 3000));
      await wait(ms);
      return json(res, 200, echoPayload(req, pathname, query, headers, ct, raw));
    }

    if (pathname === '/upload') {
      if (!ct.toLowerCase().startsWith('multipart/form-data')) {
        return json(res, 400, { error: 'expect multipart/form-data' });
      }
      const boundary = parseBoundary(ct);
      if (!boundary) return json(res, 400, { error: 'missing boundary' });
      const parsed = parseMultipart(raw, boundary);
      return json(res, 200, {
        method: req.method,
        fieldCount: parsed.fields.length,
        fileCount: parsed.files.length,
        fields: Object.fromEntries(parsed.fields),
        files: parsed.files.map((f) => ({
          field: f.field,
          filename: f.filename,
          contentType: f.contentType,
          size: f.size,
          preview: f.preview,
        })),
        redirect: `${urlBase(req)}/view/${randomId()}`,
        receivedAt: new Date().toISOString(),
      });
    }

    // 默认：/echo 或其他都按 echo 返回
    return json(res, 200, echoPayload(req, pathname, query, headers, ct, raw));
  }).catch((err) => {
    json(res, 500, { error: err?.message ?? String(err) });
  });
}

function echoPayload(
  req: http.IncomingMessage,
  pathname: string,
  query: Record<string, unknown>,
  headers: Record<string, unknown>,
  ct: string,
  raw: Buffer,
) {
  let body: unknown = raw.toString('utf8');
  if (ct.includes('application/json')) {
    try { body = JSON.parse(body as string); } catch { /* keep string */ }
  }
  return {
    method: req.method,
    path: pathname,
    query,
    headers,
    body,
    redirect: `${urlBase(req)}/view/${randomId()}`,
    receivedAt: new Date().toISOString(),
  };
}

function urlBase(req: http.IncomingMessage): string {
  const host = req.headers.host || '127.0.0.1';
  return `http://${host}`;
}

function json(res: http.ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(data));
}

function wait(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function collectBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseBoundary(ct: string): string | null {
  const m = /boundary=([^;]+)/i.exec(ct);
  if (!m) return null;
  return m[1].trim().replace(/^"|"$/g, '');
}

/** 极简 multipart 解析，足以自测用 */
function parseMultipart(buf: Buffer, boundary: string): {
  fields: Array<[string, string]>;
  files: Array<{ field: string; filename: string; contentType: string; size: number; preview: string }>;
} {
  const fields: Array<[string, string]> = [];
  const files: Array<{ field: string; filename: string; contentType: string; size: number; preview: string }> = [];
  const sep = Buffer.from(`--${boundary}`);
  const end = Buffer.from(`--${boundary}--`);

  let start = buf.indexOf(sep);
  if (start < 0) return { fields, files };
  start += sep.length;
  while (start < buf.length) {
    // 跳过 CRLF
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
    // 找下一个 boundary
    let next = buf.indexOf(sep, start);
    if (next < 0) next = buf.indexOf(end, start);
    if (next < 0) break;
    // part = [start, next - 2)  （去掉 \r\n）
    const partEnd = next - 2 >= start ? next - 2 : next;
    const part = buf.subarray(start, partEnd);
    // 解析 part
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd < 0) { start = next + sep.length; continue; }
    const rawHeaders = part.subarray(0, headerEnd).toString('utf8');
    const content = part.subarray(headerEnd + 4);
    const disp = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(rawHeaders)?.[1] || '';
    const name = /name="([^"]*)"/i.exec(disp)?.[1] || '';
    const filename = /filename="([^"]*)"/i.exec(disp)?.[1];
    const ct = /content-type:\s*([^\r\n]+)/i.exec(rawHeaders)?.[1]?.trim() || 'text/plain';
    if (filename !== undefined) {
      const preview = content.subarray(0, Math.min(80, content.length)).toString('utf8').replace(/[\x00-\x1f]/g, '.');
      files.push({ field: name, filename, contentType: ct, size: content.length, preview });
    } else {
      fields.push([name, content.toString('utf8')]);
    }
    if (buf.indexOf(end, start) === next) break;
    start = next + sep.length;
  }
  return { fields, files };
}
