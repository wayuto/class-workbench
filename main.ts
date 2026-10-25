/**
 * 班级工作台 · 原型服务入口
 * deno task dev  →  http://127.0.0.1:7788
 *
 * 职责：JSON API（读写 CSV 数据 / git / 发布）、工作台前端静态服务、
 *      /preview/* 下预览发布产物（site/ 目录）。
 */
import {
  loadConfig,
  saveConfig,
  loadStudents,
  saveStudents,
  loadGroups,
  saveGroups,
  loadExams,
  saveExams,
  deleteScores,
  loadScores,
  saveScores,
  listScoredExamIds,
  loadRemarks,
  saveRemarks,
  loadPoints,
  savePoints,
  listSeatings,
  saveSeating,
  deleteSeating,
  renameScoreColumns,
  dataDir,
  siteDir,
  webDir,
  type Student,
  type Group,
  type Exam,
  type ScoreRow,
  type Remark,
  type PointEntry,
} from "./src/store.ts";
import {
  listJournals,
  readJournal,
  saveJournal,
  deleteJournal,
  isValidDate,
} from "./src/journal.ts";
import { renderMarkdown } from "./src/markdown.ts";
import { commitAll, pushIfRemote, repoInfo, ensureRepo, pullRepo, git } from "./src/gitcmd.ts";
import { generateSite } from "./src/ssg.ts";
import { seedData } from "./src/seed.ts";

const PORT = Number(Deno.env.get("PORT") ?? 7788);

// ---------- 工具 ----------

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const badRequest = (msg: string) => json({ error: msg }, 400);

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

const now = () => new Date().toLocaleString("zh-CN", { hour12: false });

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

// ---------- 数据校验 ----------

const EXAM_ID_RE = /^[A-Za-z0-9_-]{1,24}$/;
const SCEN_NAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_-]{1,16}$/;

function asStudents(v: unknown): Student[] | null {
  if (!Array.isArray(v)) return null;
  const ok = v.every(
    (s): s is Student =>
      typeof s === "object" && s != null &&
      typeof (s as Student).student_id === "string" &&
      typeof (s as Student).name === "string",
  );
  return ok ? v : null;
}

function asGroups(v: unknown): Group[] | null {
  if (!Array.isArray(v)) return null;
  const ok = v.every(
    (g): g is Group =>
      typeof g === "object" && g != null &&
      typeof (g as Group).group_id === "string" &&
      typeof (g as Group).name === "string",
  );
  return ok ? v : null;
}

function asExams(v: unknown): Exam[] | null {
  if (!Array.isArray(v)) return null;
  const ok = v.every(
    (e): e is Exam =>
      typeof e === "object" && e != null &&
      typeof (e as Exam).exam_id === "string" &&
      EXAM_ID_RE.test((e as Exam).exam_id),
  );
  return ok ? v : null;
}

function asScoreRows(v: unknown): ScoreRow[] | null {
  if (!Array.isArray(v)) return null;
  const ok = v.every(
    (r): r is ScoreRow =>
      typeof r === "object" && r != null &&
      typeof (r as ScoreRow).student_id === "string" &&
      (r as ScoreRow).scores != null && typeof (r as ScoreRow).scores === "object" &&
      Object.values((r as ScoreRow).scores).every((x) =>
        x === null || (typeof x === "number" && Number.isFinite(x) && x >= 0)
      ),
  );
  return ok ? v : null;
}

function asRemarks(v: unknown): Remark[] | null {
  if (!Array.isArray(v)) return null;
  const ok = v.every(
    (r): r is Remark =>
      typeof r === "object" && r != null && "content" in (r as object),
  );
  return ok ? v as Remark[] : null;
}

function asPoints(v: unknown): PointEntry[] | null {
  if (!Array.isArray(v)) return null;
  const ok = v.every(
    (p): p is PointEntry =>
      typeof p === "object" && p != null &&
      typeof (p as PointEntry).date === "string" &&
      typeof (p as PointEntry).student_id === "string" &&
      typeof (p as PointEntry).reason === "string" &&
      typeof (p as PointEntry).delta === "number" &&
      Number.isFinite((p as PointEntry).delta) &&
      (p as PointEntry).delta !== 0,
  );
  return ok ? v : null;
}

// ---------- bootstrap ----------

async function bootstrap() {
  const config = await loadConfig();
  const [students, groups, exams, remarks, points, journals, scoredIds, seatings] =
    await Promise.all([
      loadStudents(),
      loadGroups(),
      loadExams(),
      loadRemarks(),
      loadPoints(),
      listJournals(),
      listScoredExamIds(),
      listSeatings(),
    ]);
  const scores: Record<string, ScoreRow[]> = {};
  for (const id of scoredIds) {
    scores[id] = await loadScores(id, config.subjects);
  }
  const [dataGit, siteGit] = await Promise.all([
    repoInfo(dataDir),
    repoInfo(siteDir),
  ]);
  return {
    config,
    students,
    groups,
    exams,
    scores,
    remarks,
    points,
    journals,
    seatings,
    git: { data: dataGit, site: siteGit },
    serverTime: now(),
  };
}

// ---------- API ----------

async function handleApi(
  method: string,
  path: string,
  req: Request,
): Promise<Response> {
  // bootstrap
  if (method === "GET" && path === "/api/bootstrap") {
    return json(await bootstrap());
  }

  // 示例数据
  if (method === "POST" && path === "/api/seed") {
    const r = await seedData();
    return json({ ok: true, ...r });
  }

  // config
  if (method === "PUT" && path === "/api/config") {
    const body = await readJsonBody(req);
    const current = await loadConfig();
    const subjects = Array.isArray(body.subjects)
      ? (body.subjects as unknown[]).map(String).filter((s) => s.trim())
      : undefined;
    let fulls = current.subject_full;
    if (body.subject_full && typeof body.subject_full === "object") {
      fulls = {};
      for (const [k, v] of Object.entries(body.subject_full as Record<string, unknown>)) {
        const n = Number(v);
        if (n > 0) fulls[k] = n;
      }
    }
    // 科目改名：先把历史成绩文件的列头迁移过去，再保存配置
    if (body.renames && typeof body.renames === "object") {
      const renames: Record<string, string> = {};
      for (const [k, v] of Object.entries(body.renames as Record<string, unknown>)) {
        if (typeof v === "string" && k.trim() && v.trim() && k !== v) renames[k.trim()] = v.trim();
      }
      if (Object.keys(renames).length) await renameScoreColumns(renames);
    }
    await saveConfig({
      class_name: String(body.class_name ?? current.class_name),
      term: String(body.term ?? current.term),
      subjects: subjects && subjects.length ? subjects : current.subjects,
      subject_full: fulls,
    });
    return json({ ok: true });
  }

  // students / groups / exams / remarks（整表替换保存）
  if (method === "PUT" && path === "/api/students") {
    const body = await readJsonBody(req);
    const list = asStudents(body.students);
    if (!list) return badRequest("students 格式不正确");
    await saveStudents(list);
    return json({ ok: true, count: list.length });
  }
  if (method === "PUT" && path === "/api/groups") {
    const body = await readJsonBody(req);
    const list = asGroups(body.groups);
    if (!list) return badRequest("groups 格式不正确");
    await saveGroups(list);
    return json({ ok: true, count: list.length });
  }
  if (method === "PUT" && path === "/api/exams") {
    const body = await readJsonBody(req);
    const list = asExams(body.exams);
    if (!list) return badRequest("exams 格式不正确");
    await saveExams(list);
    return json({ ok: true, count: list.length });
  }
  if (method === "PUT" && path === "/api/remarks") {
    const body = await readJsonBody(req);
    const list = asRemarks(body.remarks);
    if (!list) return badRequest("remarks 格式不正确");
    await saveRemarks(list);
    return json({ ok: true, count: list.length });
  }
  if (method === "PUT" && path === "/api/points") {
    const body = await readJsonBody(req);
    const list = asPoints(body.points);
    if (!list) return badRequest("积分记录格式不正确（需含日期/学号/非零分值）");
    await savePoints(list);
    return json({ ok: true, count: list.length });
  }

  // 单次考试
  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/api\/scores\/([^/]+)$/))) {
    const examId = safeDecode(m[1]!);
    if (!examId || !EXAM_ID_RE.test(examId)) return badRequest("考试编号不合法");
    if (method === "PUT") {
      const body = await readJsonBody(req);
      const rows = asScoreRows(body.rows);
      if (!rows) return badRequest("成绩行格式不正确");
      const config = await loadConfig();
      // 分数钳制到 [0, 该科满分]，非法值已在 asScoreRows 拒绝
      const fulls = config.subject_full;
      const cleanRows = rows.map((r) => ({
        student_id: r.student_id,
        scores: Object.fromEntries(
          config.subjects.map((s) => {
            const v = r.scores[s];
            const max = Number(fulls[s]) || 100;
            return [s, v == null ? null : Math.max(0, Math.min(max, v))];
          }),
        ),
      }));
      await saveScores(examId, cleanRows, config.subjects);
      return json({ ok: true, count: cleanRows.length });
    }
  }

  // 删除考试（exams.csv 行 + 成绩文件）
  if (method === "DELETE" && (m = path.match(/^\/api\/exams\/([^/]+)$/))) {
    const examId = safeDecode(m[1]!);
    if (!examId || !EXAM_ID_RE.test(examId)) return badRequest("考试编号不合法");
    const exams = await loadExams();
    const rest = exams.filter((e) => e.exam_id !== examId);
    if (rest.length === exams.length) return badRequest("考试不存在");
    // 先删成绩文件再删考试行：文件删除失败时整个请求报错、考试行保留，
    // 不会留下「考试行已删但成绩文件还在」的孤儿（孤儿会让新考试复活旧成绩）
    await deleteScores(examId);
    await saveExams(rest);
    return json({ ok: true });
  }

  // 日志
  if ((m = path.match(/^\/api\/journal\/(\d{4}-\d{2}-\d{2})$/))) {
    const date = m[1]!;
    if (method === "GET") {
      const j = await readJournal(date);
      if (!j) return json({ error: "日志不存在" }, 404);
      return json(j);
    }
    if (method === "PUT") {
      const body = await readJsonBody(req);
      await saveJournal(date, {
        title: String(body.title ?? ""),
        publish: body.publish === true,
        content: String(body.content ?? ""),
      });
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await deleteJournal(date);
      return json({ ok: true });
    }
  }

  // 座位表
  if ((m = path.match(/^\/api\/seating\/([^/]+)$/))) {
    const name = safeDecode(m[1]!);
    if (!name || !SCEN_NAME_RE.test(name)) return badRequest("场景名不合法（中文/字母/数字，最长 16 字）");
    if (method === "PUT") {
      const body = await readJsonBody(req);
      const seats = Array.isArray(body.seats)
        ? (body.seats as Array<Record<string, unknown>>).map((s) => ({
          row: Number(s.row) || 0,
          col: Number(s.col) || 0,
          student_id: String(s.student_id ?? ""),
        }))
        : null;
      if (!seats) return badRequest("座位数据格式不正确");
      await saveSeating(name, {
        rows: Number(body.rows) || 0,
        cols: Number(body.cols) || 0,
        seats,
      });
      return json({ ok: true, count: seats.length });
    }
    if (method === "DELETE") {
      await deleteSeating(name);
      return json({ ok: true });
    }
  }

  // Markdown 预览渲染
  if (method === "POST" && path === "/api/markdown") {
    const body = await readJsonBody(req);
    return json({ html: renderMarkdown(String(body.text ?? "")) });
  }

  // 附件上传（日志配图等），存 data/attachments/
  if (method === "POST" && path === "/api/attachment") {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return badRequest("缺少文件");
    if (file.size > 20 * 1024 * 1024) return badRequest("文件不能超过 20MB");
    const safeName =
      file.name.replace(/[\/\\]/g, "_").replace(/\s+/g, "-").replace(/^\.+/, "") || "file";
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
    const name = `${stamp}-${safeName}`;
    await Deno.mkdir(new URL("attachments/", dataDir), { recursive: true });
    await Deno.writeFile(
      new URL(`attachments/${name}`, dataDir),
      new Uint8Array(await file.arrayBuffer()),
    );
    return json({ ok: true, path: `attachments/${name}` });
  }

  // 发布：数据自动备份 → SSG 生成 → site/ 仓库 commit → push
  if (method === "POST" && path === "/api/publish") {
    const body = await readJsonBody(req);
    const scope = {
      groups: body.groups === true,
      scores: body.scores === true,
      honors: body.honors === true,
    };
    const log: string[] = [];
    // 发布前先把私有数据提交留档，任何一步失败都可回滚
    const bak = await commitAll(dataDir, `发布前自动备份 ${now()}`);
    log.push(bak.committed ? `✓ 数据已备份：${bak.detail}` : `· 数据备份：${bak.detail}`);
    const bakPush = await pushIfRemote(dataDir);
    if (bakPush.pushed) log.push(`✓ 数据${bakPush.detail}`);
    try {
      const gen = await generateSite(scope);
      log.push(`✓ 静态站点已生成：${gen.journalCount} 篇日志${scope.groups ? " + 小组风采" : ""}${scope.scores ? " + 成绩查询" : ""}${scope.honors ? " + 积分光荣榜" : ""}（${gen.files.length} 个文件）`);
    } catch (e) {
      return json({ ok: false, log: [`站点生成失败：${e instanceof Error ? e.message : String(e)}`] }, 500);
    }
    const commit = await commitAll(siteDir, `发布 ${now()}`);
    log.push(commit.committed ? `✓ ${commit.detail}` : `· ${commit.detail}`);
    const push = await pushIfRemote(siteDir);
    log.push(push.pushed ? `✓ ${push.detail}` : `· ${push.detail}`);
    return json({ ok: true, log, preview: "/preview/index.html" });
  }

  // 备份：data/ 仓库 commit → push
  if (method === "POST" && path === "/api/backup") {
    const log: string[] = [];
    const commit = await commitAll(dataDir, `备份 ${now()}`);
    log.push(commit.committed ? `✓ ${commit.detail}` : `· ${commit.detail}`);
    const push = await pushIfRemote(dataDir);
    log.push(push.pushed ? `✓ ${push.detail}` : `· ${push.detail}`);
    return json({ ok: true, log });
  }

  // 仓库设置：为 data/ 或 site/ 配置 origin 远程（url 留空 = 解除远程）
  if (method === "PUT" && (m = path.match(/^\/api\/repo\/(data|site)\/remote$/))) {
    const dir = m[1] === "data" ? dataDir : siteDir;
    const body = await readJsonBody(req);
    const url = String(body.url ?? "").trim();
    await ensureRepo(dir);
    if (!url) {
      await git(dir, "remote", "remove", "origin");
      return json({ ok: true, detail: "已解除远程仓库配置" });
    }
    if (/\s/.test(url)) return badRequest("仓库地址不能包含空格");
    const exists = await git(dir, "remote", "get-url", "origin");
    const r = exists.ok
      ? await git(dir, "remote", "set-url", "origin", url)
      : await git(dir, "remote", "add", "origin", url);
    if (!r.ok) return json({ error: "设置失败：" + (r.err || r.out) }, 500);
    return json({ ok: true, detail: "远程仓库已保存：" + url });
  }

  // 拉取云端：data/ 恢复数据，site/ 恢复已发布站点
  if (method === "POST" && (m = path.match(/^\/api\/repo\/(data|site)\/pull$/))) {
    const dir = m[1] === "data" ? dataDir : siteDir;
    const r = await pullRepo(dir);
    if (!r.ok) return badRequest(r.detail);
    return json(r);
  }

  // 清空全部数据（恢复全新状态）：先把现有数据留档提交，误触也能从 git 历史找回
  if (method === "DELETE" && path === "/api/data") {
    const log: string[] = [];
    const bak = await commitAll(dataDir, `清空数据前自动留档 ${now()}`);
    log.push(bak.committed ? `✓ 旧数据已留档：${bak.detail}` : `· 留档：${bak.detail}`);
    await saveStudents([]);
    await saveGroups([]);
    await saveExams([]);
    await saveRemarks([]);
    await savePoints([]);
    for (const dir of ["scores/", "journal/", "seating/", "attachments/"]) {
      try { await Deno.remove(new URL(dir, dataDir), { recursive: true }); } catch { /* 不存在则忽略 */ }
    }
    try { await Deno.remove(new URL("config.json", dataDir)); } catch { /* 不存在则忽略 */ }
    log.push("✓ 已清空：名单 / 小组 / 考试与成绩 / 个人积分 / 文字记录 / 日志 / 座位表，配置恢复默认");
    return json({ ok: true, log });
  }

  return json({ error: `未知接口：${method} ${path}` }, 404);
}

// ---------- 静态文件 ----------

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  ico: "image/x-icon",
  md: "text/markdown; charset=utf-8",
};

async function serveStatic(
  root: URL,
  rel: string,
  fallbackIndex = false,
): Promise<Response> {
  const decoded = safeDecode(rel);
  if (decoded == null) return new Response("bad request", { status: 400 });
  const clean = decoded.replace(/^\/+/, "");
  let target = new URL(clean || "./", root);
  // URL 规范化后必须仍在 root 内：拦截 ../、%2e%2e（双重编码）等一切穿越写法
  if (!target.href.startsWith(root.href)) {
    return new Response("forbidden", { status: 403 });
  }
  let stat = await Deno.stat(target).catch(() => null);
  if (stat?.isDirectory) {
    target = new URL("index.html", target);
    stat = await Deno.stat(target).catch(() => null);
  }
  if (!stat) {
    if (fallbackIndex && !clean.includes(".")) {
      // 工作台前端：未知路径回落到首页（前端 hash 路由）
      target = new URL("index.html", root);
      stat = await Deno.stat(target).catch(() => null);
    }
    if (!stat) return new Response("not found", { status: 404 });
  }
  const ext = target.pathname.split(".").pop()?.toLowerCase() ?? "";
  const body = await Deno.readFile(target);
  return new Response(body, {
    headers: {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": "no-cache",
    },
  });
}

// ---------- 入口 ----------

async function handler(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  const method = req.method.toUpperCase();

  // 防跨站触发（CSRF）：带 Origin 且不同源的非 GET 请求一律拒绝
  const origin = req.headers.get("origin");
  if (method !== "GET" && origin) {
    let same = false;
    try {
      same = new URL(origin).host === req.headers.get("host");
    } catch {
      same = false;
    }
    if (!same) return json({ error: "已拒绝跨站请求" }, 403);
  }

  try {
    if (pathname.startsWith("/api/")) {
      return await handleApi(method, pathname, req);
    }
    if (pathname === "/attachments" || pathname.startsWith("/attachments/")) {
      // 工作台内预览日志引用的本地附件
      return await serveStatic(
        new URL("attachments/", dataDir),
        pathname.slice("/attachments".length),
        false,
      );
    }
    if (pathname === "/preview" || pathname.startsWith("/preview/")) {
      return await serveStatic(
        siteDir,
        pathname.slice("/preview".length),
        false,
      );
    }
    return await serveStatic(webDir, pathname, true);
  } catch (e) {
    console.error(`[${now()}] ${method} ${pathname} →`, e);
    return json(
      { error: e instanceof Error ? e.message : "服务器内部错误" },
      500,
    );
  }
}

// 只监听本机回环：名单/成绩/谈话记录属敏感数据，不应暴露给局域网
Deno.serve({ hostname: "127.0.0.1", port: PORT }, handler);
console.log(`\n  🏫 班级工作台已启动`);
console.log(`     工作台界面  http://127.0.0.1:${PORT}/`);
console.log(`     学生站预览  http://127.0.0.1:${PORT}/preview/ （发布后可用）\n`);
// 设置导向：名单还是空的时候，把上手路线直接打在控制台里
if ((await loadStudents()).length === 0) {
  console.log(`  👋 还没有学生数据，推荐按这个顺序设置：
     ① 「班级名单」→ 上传 Excel 或粘贴导入，自动识别 学号·姓名·性别·小组·备注 列（组名不存在会自动建组）
     ② 「成绩管理」→ ⚙ 科目设置，调整科目与各科满分（默认高一九科，语数英 150 分）
     ③ 「小组管理」建组，或直接在总览页生成示例数据先体验
     ④ 日常使用：座位表排座 / 成绩录入 / 个人积分加减分 / 班级日志
     ⑤ 「发布中心」→ 生成学生站并备份数据
`);
}
