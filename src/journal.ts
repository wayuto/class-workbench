/**
 * 班级日志：journal/ 下一天一个 Markdown 文件。
 * front-matter 含 title 与 publish（publish:false 的篇目不进入公开站点）。
 */
import { dataDir } from "./store.ts";

export interface JournalMeta {
  date: string;
  title: string;
  publish: boolean;
}
export interface JournalFull extends JournalMeta {
  content: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isValidDate(s: string): boolean {
  return DATE_RE.test(s);
}

function journalUrl(date: string): URL {
  return new URL(`journal/${date}.md`, dataDir);
}

function parseFrontMatter(text: string): JournalFull {
  const meta: JournalFull = { date: "", title: "", publish: false, content: text };
  if (!text.startsWith("---\n")) {
    meta.title = firstLine(text).slice(0, 50) || "（无标题）";
    meta.content = text;
    return meta;
  }
  const lines = text.split("\n");
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    meta.content = text;
    return meta;
  }
  for (const line of lines.slice(1, end)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key === "title") meta.title = value;
    if (key === "publish") meta.publish = value === "true";
  }
  meta.content = lines.slice(end + 1).join("\n").replace(/^\n+/, "");
  return meta;
}

function firstLine(text: string): string {
  return text.split("\n", 1)[0].replace(/^#+\s*/, "");
}

/** 列出全部日志，日期倒序 */
export async function listJournals(): Promise<JournalMeta[]> {
  const metas: JournalMeta[] = [];
  try {
    for await (const entry of Deno.readDir(new URL("journal/", dataDir))) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      const date = entry.name.slice(0, -3);
      if (!isValidDate(date)) continue;
      const text = await Deno.readTextFile(journalUrl(date));
      const full = parseFrontMatter(text);
      metas.push({ date, title: full.title, publish: full.publish });
    }
  } catch {
    // 目录尚不存在
  }
  metas.sort((a, b) => (a.date < b.date ? 1 : -1));
  return metas;
}

export async function readJournal(date: string): Promise<JournalFull | null> {
  try {
    const text = await Deno.readTextFile(journalUrl(date));
    const full = parseFrontMatter(text);
    full.date = date;
    return full;
  } catch {
    return null;
  }
}

export async function saveJournal(
  date: string,
  j: { title: string; publish: boolean; content: string },
): Promise<void> {
  const title = j.title.replace(/\n/g, " ").trim() || "（无标题）";
  const text =
    `---\ntitle: ${title}\npublish: ${j.publish ? "true" : "false"}\n---\n\n` +
    j.content.trim() +
    "\n";
  await Deno.mkdir(new URL("journal/", dataDir), { recursive: true });
  await Deno.writeTextFile(journalUrl(date), text);
}

export async function deleteJournal(date: string): Promise<void> {
  try {
    await Deno.remove(journalUrl(date));
  } catch {
    // 不存在则忽略
  }
}
