/**
 * JSONL / NDJSON 解析 / 序列化
 * - 每行一个 JSON 值（对象/数组/字面量）
 * - 空行被忽略
 * - 某一行解析失败时抛出包含行号的错误
 */

export interface JsonlParseResult {
  items: unknown[];
}

export function jsonlParse(text: string): JsonlParseResult {
  const lines = text.split(/\r?\n/);
  const items: unknown[] = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line) continue;
    try {
      items.push(JSON.parse(line));
    } catch (e: any) {
      throw new Error(`Invalid JSONL at line ${idx + 1}: ${e?.message ?? e}`);
    }
  }
  return { items };
}

export function jsonlStringify(items: unknown[]): string {
  return items.map((x) => JSON.stringify(x)).join('\n') + (items.length ? '\n' : '');
}

export function isJsonlFileName(fileName: string): boolean {
  return /\.(jsonl|ndjson)$/i.test(fileName);
}
