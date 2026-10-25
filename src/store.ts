/**
 * 数据层：data/ 目录下的 CSV 是唯一事实源。
 * 排名、平均分等派生数据不落盘，由前端/发布时现算。
 */
import { objectsToCsv, parseCsv, parseObjects, toCsv } from "./csv.ts";

export const dataDir = new URL("../data/", import.meta.url);
export const siteDir = new URL("../site/", import.meta.url);
export const webDir = new URL("../web/", import.meta.url);

export interface Student {
  student_id: string;
  name: string;
  gender: string;
  group_id: string;
  note: string;
}
export interface Group {
  group_id: string;
  name: string;
  leader_id: string;
}
export interface Exam {
  exam_id: string;
  date: string;
  title: string;
  type: string;
}
/** 一名学生在一次考试中的成绩：每科一个分数（null = 缺考/未录入） */
export interface ScoreRow {
  student_id: string;
  scores: Record<string, number | null>;
}
export interface Remark {
  date: string;
  student_id: string;
  category: string;
  content: string;
}
export interface ClassConfig {
  class_name: string;
  term: string;
  subjects: string[];
  /** 各科满分（如主科 120、其余 100）；未列出的科目按 100 */
  subject_full: Record<string, number>;
}

/** 高一九科 */
export const DEFAULT_SUBJECTS = [
  "语文",
  "数学",
  "英语",
  "物理",
  "化学",
  "生物",
  "政治",
  "历史",
  "地理",
];
/** 主科（默认 150 分制） */
const MAIN_SUBJECTS = ["语文", "数学", "英语"];

export function defaultFulls(subjects: string[]): Record<string, number> {
  return Object.fromEntries(
    subjects.map((s) => [s, MAIN_SUBJECTS.includes(s) ? 150 : 100]),
  );
}

function num(v: string | undefined): number | null {
  // 空白（含纯空格）一律视为缺考：Number(" ") 是 0，不能放行
  if (v === undefined || v.trim() === "" || isNaN(Number(v))) return null;
  return Number(v);
}

async function readTextSafe(url: URL): Promise<string> {
  try {
    return await Deno.readTextFile(url);
  } catch {
    return "";
  }
}

async function writeTextEnsureDir(url: URL, text: string): Promise<void> {
  await Deno.mkdir(new URL("./", url), { recursive: true });
  await Deno.writeTextFile(url, text);
}

// ---------- config ----------

export async function loadConfig(): Promise<ClassConfig> {
  const text = await readTextSafe(new URL("config.json", dataDir));
  const subjects = DEFAULT_SUBJECTS;
  const fallback: ClassConfig = {
    class_name: "我的班级",
    term: "2026 秋季学期",
    subjects,
    subject_full: defaultFulls(subjects),
  };
  if (!text) return fallback;
  try {
    const j = JSON.parse(text);
    const subj = Array.isArray(j.subjects) && j.subjects.length
      ? j.subjects.map(String)
      : fallback.subjects;
    const fulls = defaultFulls(subj);
    if (j.subject_full && typeof j.subject_full === "object") {
      for (const [k, v] of Object.entries(j.subject_full)) {
        const n = Number(v);
        if (n > 0) fulls[k] = n;
      }
    }
    return {
      class_name: j.class_name ?? fallback.class_name,
      term: j.term ?? fallback.term,
      subjects: subj,
      subject_full: fulls,
    };
  } catch {
    return fallback;
  }
}

export async function saveConfig(cfg: ClassConfig): Promise<void> {
  await writeTextEnsureDir(
    new URL("config.json", dataDir),
    JSON.stringify(cfg, null, 2) + "\n",
  );
}

// ---------- students ----------

const STUDENT_HEADERS = ["student_id", "name", "gender", "group_id", "note"];

export async function loadStudents(): Promise<Student[]> {
  const objs = parseObjects(
    await readTextSafe(new URL("students.csv", dataDir)),
  );
  return objs.map((o) => ({
    student_id: o.student_id ?? "",
    name: o.name ?? "",
    gender: o.gender ?? "",
    group_id: o.group_id ?? "",
    note: o.note ?? "",
  }));
}

export async function saveStudents(list: Student[]): Promise<void> {
  await writeTextEnsureDir(
    new URL("students.csv", dataDir),
    objectsToCsv(list as unknown as Record<string, string>[], STUDENT_HEADERS),
  );
}

// ---------- groups ----------

const GROUP_HEADERS = ["group_id", "name", "leader_id"];

export async function loadGroups(): Promise<Group[]> {
  const objs = parseObjects(await readTextSafe(new URL("groups.csv", dataDir)));
  return objs.map((o) => ({
    group_id: o.group_id ?? "",
    name: o.name ?? "",
    leader_id: o.leader_id ?? "",
  }));
}

export async function saveGroups(list: Group[]): Promise<void> {
  await writeTextEnsureDir(
    new URL("groups.csv", dataDir),
    objectsToCsv(list as unknown as Record<string, string>[], GROUP_HEADERS),
  );
}

// ---------- exams / scores ----------

const EXAM_HEADERS = ["exam_id", "date", "title", "type"];

export async function loadExams(): Promise<Exam[]> {
  const objs = parseObjects(await readTextSafe(new URL("exams.csv", dataDir)));
  return objs.map((o) => ({
    exam_id: o.exam_id ?? "",
    date: o.date ?? "",
    title: o.title ?? "",
    type: o.type ?? "测验",
  }));
}

export async function saveExams(list: Exam[]): Promise<void> {
  await writeTextEnsureDir(
    new URL("exams.csv", dataDir),
    objectsToCsv(list as unknown as Record<string, string>[], EXAM_HEADERS),
  );
}

export function scoreFileUrl(examId: string): URL {
  return new URL(`scores/${encodeURIComponent(examId)}.csv`, dataDir);
}

export async function loadScores(
  examId: string,
  subjects: string[],
): Promise<ScoreRow[]> {
  const objs = parseObjects(await readTextSafe(scoreFileUrl(examId)));
  return objs.map((o) => ({
    student_id: o.student_id ?? "",
    scores: Object.fromEntries(subjects.map((s) => [s, num(o[s])])),
  }));
}

export async function saveScores(
  examId: string,
  rows: ScoreRow[],
  subjects: string[],
): Promise<void> {
  await writeTextEnsureDir(
    scoreFileUrl(examId),
    objectsToCsv(
      rows.map((r) => ({
        student_id: r.student_id,
        ...Object.fromEntries(subjects.map((s) => [s, r.scores[s] ?? ""])),
      })),
      ["student_id", ...subjects],
    ),
  );
}

export async function deleteScores(examId: string): Promise<void> {
  try {
    await Deno.remove(scoreFileUrl(examId));
  } catch (e) {
    // 文件不存在属正常；其余错误上抛，避免静默失败留下孤儿成绩文件
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
}

/** 科目改名时同步迁移所有成绩文件的列头（旧列数据原样保留，仅换列名） */
export async function renameScoreColumns(
  renames: Record<string, string>,
): Promise<number> {
  const map = Object.fromEntries(
    Object.entries(renames).filter(([k, v]) => k && v && k !== v),
  );
  if (!Object.keys(map).length) return 0;
  let touched = 0;
  try {
    for await (const entry of Deno.readDir(new URL("scores/", dataDir))) {
      if (!entry.isFile || !entry.name.endsWith(".csv")) continue;
      const url = new URL(`scores/${entry.name}`, dataDir);
      const rows = parseCsv(await Deno.readTextFile(url));
      if (rows.length === 0) continue;
      let changed = false;
      const header = rows[0].map((h) => {
        const to = map[h];
        if (to) {
          changed = true;
          return to;
        }
        return h;
      });
      if (!changed) continue;
      await Deno.writeTextFile(url, toCsv([header, ...rows.slice(1)]));
      touched++;
    }
  } catch {
    // scores 目录尚不存在
  }
  return touched;
}

/** 已有成绩文件的考试 id（scores/ 目录文件名） */
export async function listScoredExamIds(): Promise<string[]> {
  const ids: string[] = [];
  try {
    for await (const entry of Deno.readDir(new URL("scores/", dataDir))) {
      if (entry.isFile && entry.name.endsWith(".csv")) {
        ids.push(entry.name.slice(0, -4));
      }
    }
  } catch {
    // 目录尚不存在
  }
  return ids;
}

// ---------- seating ----------

export interface Seat {
  row: number;
  col: number;
  student_id: string;
}
export interface SeatingData {
  rows: number;
  cols: number;
  seats: Seat[];
}

export async function loadSeating(name: string): Promise<SeatingData> {
  const objs = parseObjects(
    await readTextSafe(new URL(`seating/${encodeURIComponent(name)}.csv`, dataDir)),
  );
  let rows = 0, cols = 0;
  const seats: Seat[] = objs.map((o) => {
    const row = Number(o.row) || 0;
    const col = Number(o.col) || 0;
    rows = Math.max(rows, row);
    cols = Math.max(cols, col);
    return { row, col, student_id: o.student_id ?? "" };
  });
  return { rows, cols, seats };
}

export async function listSeatings(): Promise<Record<string, SeatingData>> {
  const out: Record<string, SeatingData> = {};
  try {
    for await (const entry of Deno.readDir(new URL("seating/", dataDir))) {
      if (!entry.isFile || !entry.name.endsWith(".csv")) continue;
      const name = decodeURIComponent(entry.name.slice(0, -4));
      out[name] = await loadSeating(name);
    }
  } catch {
    // 目录尚不存在
  }
  return out;
}

export async function saveSeating(
  name: string,
  data: SeatingData,
): Promise<void> {
  await writeTextEnsureDir(
    new URL(`seating/${encodeURIComponent(name)}.csv`, dataDir),
    objectsToCsv(
      data.seats.map((s) => ({ row: s.row, col: s.col, student_id: s.student_id })),
      ["row", "col", "student_id"],
    ),
  );
}

export async function deleteSeating(name: string): Promise<void> {
  try {
    await Deno.remove(new URL(`seating/${encodeURIComponent(name)}.csv`, dataDir));
  } catch {
    // 不存在则忽略
  }
}

// ---------- remarks ----------

const REMARK_HEADERS = ["date", "student_id", "category", "content"];

export async function loadRemarks(): Promise<Remark[]> {
  const objs = parseObjects(await readTextSafe(new URL("remarks.csv", dataDir)));
  return objs.map((o) => ({
    date: o.date ?? "",
    student_id: o.student_id ?? "",
    category: o.category ?? "评语",
    content: o.content ?? "",
  }));
}

export async function saveRemarks(list: Remark[]): Promise<void> {
  await writeTextEnsureDir(
    new URL("remarks.csv", dataDir),
    objectsToCsv(list as unknown as Record<string, string>[], REMARK_HEADERS),
  );
}

// ---------- points（个人积分流水） ----------

export interface PointEntry {
  /** 日期 YYYY-MM-DD */
  date: string;
  student_id: string;
  /** 正数加分、负数扣分，0 无意义 */
  delta: number;
  reason: string;
}

const POINT_HEADERS = ["date", "student_id", "delta", "reason"];

export async function loadPoints(): Promise<PointEntry[]> {
  const objs = parseObjects(await readTextSafe(new URL("points.csv", dataDir)));
  return objs.map((o) => ({
    date: o.date ?? "",
    student_id: o.student_id ?? "",
    delta: num(o.delta) ?? 0,
    reason: o.reason ?? "",
  }));
}

export async function savePoints(list: PointEntry[]): Promise<void> {
  await writeTextEnsureDir(
    new URL("points.csv", dataDir),
    objectsToCsv(
      list.map((p) => ({ date: p.date, student_id: p.student_id, delta: p.delta, reason: p.reason })),
      POINT_HEADERS,
    ),
  );
}
