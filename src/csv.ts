/**
 * CSV 读写：RFC 4180 转义 + UTF-8 BOM。
 * 写出的文件老师双击即可用 Excel 正常打开；git diff 逐行可读。
 */

/** 解析 CSV 文本（容忍 \r\n 与 \n、引号内逗号/换行/双引号转义） */
export function parseCsv(text: string): string[][] {
  if (text.startsWith("\ufeff")) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += c;
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // 过滤完全空白的行
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

function needsQuote(s: string): boolean {
  return /[",\n\r]/.test(s);
}

function encodeField(s: string): string {
  if (needsQuote(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** 生成 CSV 文本（UTF-8 BOM + LF 行尾，末尾带换行） */
export function toCsv(rows: string[][]): string {
  const body = rows.map((r) => r.map(encodeField).join(",")).join("\n");
  return "\ufeff" + body + "\n";
}

/** 解析为对象数组（首行为表头） */
export function parseObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => (obj[h] = r[i] ?? ""));
    return obj;
  });
}

/** 对象数组 → CSV 文本（按给定表头顺序） */
export function objectsToCsv(
  objs: Record<string, string | number | null>[],
  headers: string[],
): string {
  const rows = [headers];
  for (const o of objs) {
    rows.push(headers.map((h) => String(o[h] ?? "")));
  }
  return toCsv(rows);
}
