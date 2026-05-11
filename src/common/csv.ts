/**
 * 轻量 CSV 解析 / 生成（零依赖）
 * 规则：
 *  - 分隔符：逗号（默认）
 *  - 支持双引号包裹字段；字段内双引号通过 "" 转义
 *  - 支持 \r\n / \n 换行
 *  - 首行为表头
 */

export function csvParse(text: string, delimiter = ','): Record<string, string>[] {
  const rows = parseRows(text, delimiter);
  if (rows.length === 0) return [];
  const header = rows[0];
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 1 && row[0] === '') continue; // 跳过空行
    const obj: Record<string, string> = {};
    header.forEach((h, i) => { obj[h] = row[i] ?? ''; });
    out.push(obj);
  }
  return out;
}

export function csvStringify(rows: Record<string, unknown>[], delimiter = ','): string {
  if (!rows.length) return '';
  const cols = new Set<string>();
  rows.forEach((r) => Object.keys(r).forEach((k) => cols.add(k)));
  const header = Array.from(cols);
  const lines: string[] = [header.map((h) => escape(h, delimiter)).join(delimiter)];
  for (const r of rows) {
    lines.push(header.map((c) => {
      const v = r[c];
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return escape(JSON.stringify(v), delimiter);
      return escape(String(v), delimiter);
    }).join(delimiter));
  }
  return lines.join('\n');
}

function escape(s: string, delimiter: string): string {
  if (s.includes('"') || s.includes(delimiter) || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++;
    } else {
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === delimiter) { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') {
        row.push(field); rows.push(row);
        row = []; field = ''; i++; continue;
      }
      field += c; i++;
    }
  }
  // flush
  row.push(field);
  rows.push(row);
  return rows;
}
