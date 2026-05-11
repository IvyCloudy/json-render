#!/usr/bin/env node
/* eslint-disable */
/**
 * 本地验证后端（纯 Node，零依赖）
 * ------------------------------------------------------------------
 * 用于验证 examples/11-form-submit-advanced.json 里 __form.submit 的所有按钮。
 *
 * 启动：
 *     node examples/backend/server.js
 *     # 或指定端口
 *     PORT=39870 node examples/backend/server.js
 *
 * 端点：
 *     POST /echo                    回显请求（200）
 *     PUT  /echo                    同上（任意方法都支持）
 *     DELETE /echo
 *     POST /slow?ms=6000            等待 ms 后再回显，用来测试 timeoutMs
 *     POST /fail?code=500           返回指定错误状态码
 *     POST /upload                  解析 multipart/form-data 并回显字段 / 文件概要
 *     GET  /view/:id                openUrl 跳转后的确认页（HTML）
 *     GET  /health                  健康检查
 *
 * 响应体里统一带 redirect 字段指向 /view/<随机 id>，方便与 __form.submit.openUrl 配合验证。
 */

'use strict';

const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 39870;
const HOST = process.env.HOST || '127.0.0.1';

// ----------------------------- utils ------------------------------
const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
};
const c = (color, s) => `${COLORS[color] || ''}${s}${COLORS.reset}`;

function nowTag() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  // 允许浏览器跨域调用，方便未来扩展
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Source, X-Req-Id');
  res.end(body);
}

function sendHtml(res, status, html) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(html));
  res.end(html);
}

function urlBase(req) {
  return `http://${req.headers.host || `${HOST}:${PORT}`}`;
}

function parseQuery(u) {
  const out = {};
  u.searchParams.forEach((v, k) => {
    if (k in out) {
      out[k] = Array.isArray(out[k]) ? [...out[k], v] : [out[k], v];
    } else {
      out[k] = v;
    }
  });
  return out;
}

// ------------------------- multipart parser -----------------------
function parseBoundary(ct) {
  const m = /boundary=([^;]+)/i.exec(ct || '');
  if (!m) return null;
  return m[1].trim().replace(/^"|"$/g, '');
}

/** 返回 { fields: [[name,value]], files: [{field,filename,contentType,size,preview}] } */
function parseMultipart(buf, boundary) {
  const fields = [];
  const files = [];
  const sep = Buffer.from(`--${boundary}`);
  const end = Buffer.from(`--${boundary}--`);

  let start = buf.indexOf(sep);
  if (start < 0) return { fields, files };
  start += sep.length;
  while (start < buf.length) {
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
    let next = buf.indexOf(sep, start);
    if (next < 0) next = buf.indexOf(end, start);
    if (next < 0) break;
    const partEnd = next - 2 >= start ? next - 2 : next;
    const part = buf.subarray(start, partEnd);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd < 0) { start = next + sep.length; continue; }
    const rawHeaders = part.subarray(0, headerEnd).toString('utf8');
    const content = part.subarray(headerEnd + 4);
    const disp = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(rawHeaders)?.[1] || '';
    const name = /name="([^"]*)"/i.exec(disp)?.[1] || '';
    const filename = /filename="([^"]*)"/i.exec(disp)?.[1];
    const ct = (/content-type:\s*([^\r\n]+)/i.exec(rawHeaders)?.[1] || 'text/plain').trim();
    if (filename !== undefined) {
      const preview = content
        .subarray(0, Math.min(80, content.length))
        .toString('utf8')
        .replace(/[\x00-\x1f]/g, '.');
      files.push({ field: name, filename, contentType: ct, size: content.length, preview });
    } else {
      fields.push([name, content.toString('utf8')]);
    }
    if (buf.indexOf(end, start) === next) break;
    start = next + sep.length;
  }
  return { fields, files };
}

// ---------------------------- handlers ----------------------------
async function handle(req, res) {
  const startTs = Date.now();
  const u = new URL(req.url || '/', urlBase(req));
  const pathname = u.pathname;
  const query = parseQuery(u);

  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Source, X-Req-Id');
    res.end();
    return logReq(req, pathname, 204, Date.now() - startTs);
  }

  const raw = await collectBody(req);
  const ct = String(req.headers['content-type'] || '');

  try {
    // /health
    if (pathname === '/health') {
      sendJson(res, 200, { ok: true, uptime: process.uptime(), pid: process.pid });
      return logReq(req, pathname, 200, Date.now() - startTs);
    }

    // /view/:id —— 供 openUrl 跳转验证
    if (pathname.startsWith('/view/')) {
      const id = pathname.slice('/view/'.length) || '(empty)';
      sendHtml(res, 200, renderViewPage(id));
      return logReq(req, pathname, 200, Date.now() - startTs);
    }

    // /fail
    if (pathname === '/fail') {
      const code = Math.max(400, Math.min(599, Number(query.code) || 500));
      sendJson(res, code, { error: 'simulated failure', code, path: pathname });
      return logReq(req, pathname, code, Date.now() - startTs);
    }

    // /slow
    if (pathname === '/slow') {
      const ms = Math.max(0, Math.min(60000, Number(query.ms) || 3000));
      await wait(ms);
      const payload = echoPayload(req, pathname, query, raw, ct);
      sendJson(res, 200, payload);
      return logReq(req, pathname, 200, Date.now() - startTs, { waited: `${ms}ms` });
    }

    // /upload
    if (pathname === '/upload') {
      if (!ct.toLowerCase().startsWith('multipart/form-data')) {
        sendJson(res, 400, { error: 'expect multipart/form-data', got: ct });
        return logReq(req, pathname, 400, Date.now() - startTs);
      }
      const boundary = parseBoundary(ct);
      if (!boundary) {
        sendJson(res, 400, { error: 'missing boundary in content-type' });
        return logReq(req, pathname, 400, Date.now() - startTs);
      }
      const parsed = parseMultipart(raw, boundary);
      const resp = {
        method: req.method,
        fieldCount: parsed.fields.length,
        fileCount: parsed.files.length,
        fields: Object.fromEntries(parsed.fields),
        files: parsed.files,
        redirect: `${urlBase(req)}/view/${randomId()}`,
        receivedAt: new Date().toISOString(),
      };
      sendJson(res, 200, resp);
      return logReq(req, pathname, 200, Date.now() - startTs, {
        fields: parsed.fields.length,
        files: parsed.files.length,
      });
    }

    // /echo（默认）
    if (pathname === '/echo' || pathname === '/') {
      sendJson(res, 200, echoPayload(req, pathname, query, raw, ct));
      return logReq(req, pathname, 200, Date.now() - startTs);
    }

    // 404
    sendJson(res, 404, { error: 'not found', path: pathname });
    logReq(req, pathname, 404, Date.now() - startTs);
  } catch (err) {
    sendJson(res, 500, { error: err?.message || String(err) });
    logReq(req, pathname, 500, Date.now() - startTs, { err: err?.message });
  }
}

function echoPayload(req, pathname, query, raw, ct) {
  let body = raw.length ? raw.toString('utf8') : undefined;
  if (body && ct.includes('application/json')) {
    try { body = JSON.parse(body); } catch { /* keep string */ }
  }
  return {
    method: req.method,
    path: pathname,
    query,
    headers: req.headers,
    body,
    redirect: `${urlBase(req)}/view/${randomId()}`,
    receivedAt: new Date().toISOString(),
  };
}

function renderViewPage(id) {
  const safeId = String(id).replace(/[<>"']/g, (x) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[x]));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>json-render · view/${safeId}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { background: #1e293b; padding: 32px 40px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.4); text-align: center; }
  h1 { margin: 0 0 8px; font-size: 20px; color: #38bdf8; }
  code { background: #0f172a; padding: 4px 8px; border-radius: 4px; color: #fde68a; }
  p { color: #94a3b8; margin: 12px 0 0; }
</style>
</head>
<body>
  <div class="card">
    <h1>✓ openUrl reached</h1>
    <p>Record id: <code>${safeId}</code></p>
    <p>This page is served by json-render&apos;s local backend.</p>
  </div>
</body>
</html>`;
}

// ---------------------------- logging -----------------------------
function logReq(req, pathname, status, ms, extra) {
  const color = status >= 500 ? 'red' : status >= 400 ? 'yellow' : 'green';
  const method = (req.method || '').padEnd(6);
  const extraStr = extra
    ? ' ' + Object.entries(extra).map(([k, v]) => `${c('gray', k + '=')}${v}`).join(' ')
    : '';
  const auth = req.headers['authorization'] ? c('magenta', ' [auth]') : '';
  const line = `${c('gray', nowTag())}  ${c('cyan', method)} ${pathname.padEnd(16)} ${c(color, String(status))}  ${ms}ms${auth}${extraStr}`;
  console.log(line);
}

// ----------------------------- start ------------------------------
const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    try {
      sendJson(res, 500, { error: err?.message || String(err) });
    } catch { /* noop */ }
  });
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(c('red', `\n[json-render backend] port ${PORT} is already in use.`));
    console.error(c('yellow', `Tip: stop the other process or run with a different port:  PORT=39880 node examples/backend/server.js\n`));
    process.exit(1);
  }
  console.error(c('red', `[json-render backend] server error: ${err?.message || err}`));
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const base = `http://${HOST}:${PORT}`;
  console.log();
  console.log(c('bold', '🚀 json-render verification backend'));
  console.log(`   ${c('gray', 'listening on')} ${c('cyan', base)}`);
  console.log(`   ${c('gray', 'endpoints:')}`);
  console.log(`     ${c('green', 'GET ')} ${base}/health`);
  console.log(`     ${c('green', 'POST')} ${base}/echo`);
  console.log(`     ${c('green', 'POST')} ${base}/slow?ms=6000`);
  console.log(`     ${c('green', 'POST')} ${base}/fail?code=500`);
  console.log(`     ${c('green', 'POST')} ${base}/upload   ${c('gray', '(multipart/form-data)')}`);
  console.log(`     ${c('green', 'GET ')} ${base}/view/:id`);
  console.log();
  console.log(c('gray', '   Open examples/11-form-submit-advanced.json in the preview and click the buttons.'));
  console.log(c('gray', '   Press Ctrl+C to stop.'));
  console.log();
});

function shutdown(sig) {
  console.log(c('yellow', `\n[${sig}] shutting down...`));
  server.close(() => process.exit(0));
  // 保底退出
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
