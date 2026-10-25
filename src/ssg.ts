/**
 * 学生端公开站点生成器：从私有数据（CSV + 日志）渲染纯静态 H5 到 site/。
 * site/ 是独立 git 仓库，只放产物；敏感数据永远不进入这里（除非勾选成绩查询）。
 */
import { renderMarkdown, plainText } from "./markdown.ts";
import {
  dataDir,
  siteDir,
  webDir,
  loadStudents,
  loadGroups,
  loadExams,
  loadScores,
  loadPoints,
  listScoredExamIds,
  loadConfig,
  type ScoreRow,
} from "./store.ts";
import { listJournals, readJournal } from "./journal.ts";

export interface PublishScope {
  groups: boolean;
  scores: boolean;
  honors: boolean;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function writeFile(path: string, content: string): Promise<string> {
  const url = new URL(path, siteDir);
  await Deno.mkdir(new URL("./", url), { recursive: true });
  await Deno.writeTextFile(url, content);
  return path;
}

async function copyFile(from: URL, path: string): Promise<void> {
  const url = new URL(path, siteDir);
  await Deno.mkdir(new URL("./", url), { recursive: true });
  try {
    await Deno.copyFile(from, url);
  } catch {
    // 源不存在则跳过
  }
}

async function removeStale(path: string): Promise<void> {
  try {
    await Deno.remove(new URL(path, siteDir));
  } catch {
    // 不存在则忽略
  }
}

/** 学生成绩文件名：sha256(姓名|学号后四位) 前 16 位，静态站上无法反查、无法枚举 */
async function hashKey(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf).slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const SITE_CSS = `
:root{--blue:#2f6fed;--ink:#1f2937;--muted:#6b7280;--bg:#f5f7fb;--card:#fff;--radius:12px}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--ink);background:var(--bg);line-height:1.65}
.wrap{max-width:760px;margin:0 auto;padding:16px}
header.site{background:var(--blue);color:#fff;padding:14px 16px}
header.site .wrap{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
header.site h1{font-size:18px;margin:0}
nav.site a{color:#fff;text-decoration:none;margin-left:14px;font-size:14px;opacity:.92}
nav.site a:hover{opacity:1;text-decoration:underline}
nav.site a.on{opacity:1;font-weight:600;text-decoration:underline}
.card{background:var(--card);border-radius:var(--radius);padding:18px 20px;margin:14px 0;box-shadow:0 1px 4px rgba(15,35,80,.07)}
.post-item{display:flex;gap:14px;align-items:flex-start}
.post-date{flex:none;width:56px;text-align:center;background:#eef3ff;color:var(--blue);border-radius:10px;padding:6px 0;font-weight:600}
.post-date .d{font-size:20px;display:block;line-height:1.1}
.post-date .m{font-size:11px}
.post-item h2{margin:0 0 6px;font-size:17px}
.post-item h2 a{color:var(--ink);text-decoration:none}
.post-item p{margin:0;color:var(--muted);font-size:14px}
article.md h2{font-size:20px}article.md h3{font-size:17px}article.md h4{font-size:15px}
article.md img{max-width:100%;border-radius:8px}
article.md pre{background:#0f172a;color:#e2e8f0;padding:12px 14px;border-radius:8px;overflow-x:auto;font-size:13px}
article.md code{background:#eef1f6;padding:1px 5px;border-radius:4px;font-size:.92em}
article.md pre code{background:none;padding:0}
article.md blockquote{margin:10px 0;padding:6px 14px;border-left:3px solid var(--blue);background:#f2f6ff;color:#374151}
.meta{color:var(--muted);font-size:13px;margin:4px 0 14px}
.chip{display:inline-block;background:#eef3ff;color:#2b5fd9;border-radius:999px;padding:2px 12px;margin:2px 4px 2px 0;font-size:13px}
.chip.leader{background:#fff4e0;color:#b45309}
.btn{display:inline-block;background:var(--blue);color:#fff;border:none;border-radius:8px;padding:9px 22px;font-size:15px;cursor:pointer}
.btn:active{transform:translateY(1px)}
input.q{font-size:16px;padding:10px 12px;border:1px solid #d4dae3;border-radius:8px;width:100%;max-width:320px}
.score-table{width:100%;border-collapse:collapse;font-size:14px;margin-top:10px}
.score-table th,.score-table td{border-bottom:1px solid #edf0f4;padding:7px 8px;text-align:left}
.score-table th{color:var(--muted);font-weight:500}
.badge-off{background:#fdeaea;color:#c0392b;border-radius:6px;padding:2px 8px;font-size:12px}
.honor-cards{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin:16px 0}
.honor-card{background:#fff;border-radius:12px;padding:16px 20px;text-align:center;box-shadow:0 1px 4px rgba(15,35,80,.07);min-width:96px;border:1px solid #eef1f6}
.honor-card .m{font-size:30px;line-height:1.2}
.honor-card .n{font-weight:700;font-size:16px;margin-top:2px}
.honor-card .s{color:#b45309;font-weight:700;font-size:14px}
footer.site{color:var(--muted);font-size:12px;text-align:center;padding:20px 0 28px}
`;

interface PageCtx {
  title: string;
  active: string;
  withScores: boolean;
  withGroups: boolean;
  withHonors: boolean;
  body: string;
  headExtra?: string;
}

function page(ctx: PageCtx): string {
  // 日志详情页位于 journal/ 子目录，资源与导航都需要回上一级
  const rel = ctx.active.startsWith("journal/") ? "../" : "";
  const nav = [
    `<a href="${rel}index.html" ${ctx.active === "index" ? 'class="on"' : ""}>日志</a>`,
    ctx.withGroups
      ? `<a href="${rel}groups.html" ${ctx.active === "groups" ? 'class="on"' : ""}>小组风采</a>`
      : "",
    ctx.withScores
      ? `<a href="${rel}scores.html" ${ctx.active === "scores" ? 'class="on"' : ""}>成绩查询</a>`
      : "",
    ctx.withHonors
      ? `<a href="${rel}honors.html" ${ctx.active === "honors" ? 'class="on"' : ""}>光荣榜</a>`
      : "",
  ].filter(Boolean).join("");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(ctx.title)}</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="${rel}assets/style.css">
</head>
<body>
<header class="site"><div class="wrap"><h1>📢 ${esc(ctx.title) || "班级站点"}</h1><nav class="site">${nav}</nav></div></header>
<div class="wrap">
${ctx.body}
</div>
<footer class="site">由班级工作台生成 · 更新于 ${new Date().toLocaleString("zh-CN")}</footer>
</body>
</html>`;
}

export interface GenerateResult {
  files: string[];
  journalCount: number;
}

export async function generateSite(scope: PublishScope): Promise<GenerateResult> {
  const config = await loadConfig();
  // 公开站不带班级名：站点可能被转发给其他人，标题保持通用
  const siteTitle = "班级站点";
  const files: string[] = [];

  await Deno.mkdir(siteDir, { recursive: true });
  await copyFile(new URL("vendor/chart.js", webDir), "assets/chart.js");
  await writeFile("assets/style.css", SITE_CSS);

  // ---- 班级日志 ----
  const metas = (await listJournals()).filter((m) => m.publish);
  const items: string[] = [];
  for (const m of metas) {
    const full = await readJournal(m.date);
    const excerpt = full ? plainText(full.content).slice(0, 80) : "";
    const [, mm, dd] = m.date.split("-");
    items.push(`<div class="card post-item">
  <div class="post-date"><span class="d">${dd}</span><span class="m">${mm}月</span></div>
  <div><h2><a href="journal/${m.date}.html">${esc(m.title)}</a></h2><p>${esc(excerpt)}…</p></div>
</div>`);
    // 日志详情页（同时拷贝被引用的附件）
    let md = full?.content ?? "";
    const attRe = /\((attachments\/([^)\s]+))\)/g;
    let match: RegExpExecArray | null;
    while ((match = attRe.exec(md)) !== null) {
      const src = new URL(`attachments/${match[2]}`, dataDir);
      await copyFile(src, `assets/att/${match[2]}`);
      md = md.split(match[1]).join(`../assets/att/${match[2]}`);
    }
    await writeFile(
      `journal/${m.date}.html`,
      page({
        title: `${m.title} · ${siteTitle}`,
        active: "journal/",
        withScores: scope.scores,
        withGroups: scope.groups,
        withHonors: scope.honors,
        body: `<article class="md card">
<div class="meta">📅 ${m.date}</div>
<h2 style="margin-top:0">${esc(m.title)}</h2>
${renderMarkdown(md)}
</article>
<p><a href="../index.html" style="color:var(--blue)">← 返回列表</a></p>`,
      }),
    );
  }
  files.push(...metas.map((m) => `journal/${m.date}.html`));

  const quickLinks = [
    scope.groups ? `<a class="chip" href="groups.html">👥 小组风采</a>` : "",
    scope.scores ? `<a class="chip" href="scores.html">📈 成绩查询</a>` : "",
    scope.honors ? `<a class="chip" href="honors.html">🌟 积分光荣榜</a>` : "",
  ].filter(Boolean).join("");
  await writeFile(
    "index.html",
    page({
      title: siteTitle,
      active: "index",
      withScores: scope.scores,
      withGroups: scope.groups,
      withHonors: scope.honors,
      body: `${quickLinks ? `<div style="margin-top:14px">${quickLinks}</div>` : ""}
${items.join("\n") || '<div class="card">暂无已发布的日志</div>'}`,
    }),
  );
  files.push("index.html");

  // ---- 小组风采 ----
  if (scope.groups) {
    const [students, groups] = await Promise.all([loadStudents(), loadGroups()]);
    const cards = groups.map((g) => {
      const members = students.filter((s) => s.group_id === g.group_id);
      const chips = members
        .map((s) =>
          s.student_id === g.leader_id
            ? `<span class="chip leader">${esc(s.name)} 👑</span>`
            : `<span class="chip">${esc(s.name)}</span>`
        )
        .join("");
      return `<div class="card"><h2 style="margin:0 0 8px;font-size:17px">${esc(g.name)}</h2>${chips || '<span style="color:var(--muted);font-size:13px">暂无成员</span>'}</div>`;
    }).join("\n");
    await writeFile(
      "groups.html",
      page({
        title: `小组风采 · ${siteTitle}`,
        active: "groups",
        withScores: scope.scores,
        withGroups: true,
        withHonors: scope.honors,
        body: cards || '<div class="card">暂无小组数据</div>',
      }),
    );
    files.push("groups.html");
  }

  // ---- 成绩查询 ----
  if (scope.scores) {
    const subjects = config.subjects;
    const [students, exams, scoredIds] = await Promise.all([
      loadStudents(),
      loadExams(),
      listScoredExamIds(),
    ]);
    const examOrder = exams
      .filter((e) => scoredIds.includes(e.exam_id))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const scoreMap = new Map<string, ScoreRow[]>();
    for (const e of examOrder) {
      scoreMap.set(e.exam_id, await loadScores(e.exam_id, subjects));
    }
    const total = (row: ScoreRow | undefined): number | null => {
      if (!row) return null;
      const vals = subjects.map((s) => row.scores[s]).filter((v): v is number => v != null);
      if (!vals.length) return null;
      return vals.reduce((a, b) => a + b, 0);
    };
    // 全科实考（缺考任何一科都不计入总分平均，避免残缺总分拉低班级平均）
    const fullAttended = (row: ScoreRow | undefined): boolean =>
      !!row && subjects.every((s) => row.scores[s] != null);
    // 班级平均：每科（按实考该科的人）+ 总分（按全科实考的人）
    const avg: Record<string, Record<string, number>> = {};
    for (const e of examOrder) {
      const rows = scoreMap.get(e.exam_id) ?? [];
      const per: Record<string, number> = {};
      for (const s of subjects) {
        const vals = rows.map((r) => r.scores[s]).filter((v): v is number => v != null);
        per[s] = vals.length
          ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
          : 0;
      }
      const totals = rows.filter((r) => fullAttended(r))
        .map((r) => total(r)!)
        .filter((v) => v != null);
      per._t = totals.length
        ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length)
        : 0;
      avg[e.exam_id] = per;
    }
    // 班级级数据（无个人信息）与学生级数据分开存放：
    // 学生文件名 = sha256(姓名|学号后四位)，公开站上不可枚举、不可反查
    await writeFile(
      "data/avg.json",
      JSON.stringify({
        subjects,
        fulls: config.subject_full,
        fullT: subjects.reduce((a, s) => a + (config.subject_full[s] ?? 100), 0),
        exams: examOrder.map((e) => ({
          id: e.exam_id,
          date: e.date,
          title: e.title,
        })),
        avg,
      }),
    );

    try {
      await Deno.remove(new URL("data/s/", siteDir), { recursive: true });
    } catch {
      // 目录不存在
    }
    await Deno.mkdir(new URL("data/s/", siteDir), { recursive: true });
    const byKey = new Map<string, unknown[]>();
    for (const s of students) {
      const key = await hashKey(`${s.name}|${s.student_id.slice(-4)}`);
      const scores = Object.fromEntries(examOrder.map((e) => {
        const row = (scoreMap.get(e.exam_id) ?? []).find(
          (r) => r.student_id === s.student_id,
        );
        const per = row ? { ...row.scores } : {};
        return [e.exam_id, { ...per, _t: total(row) }];
      }));
      const rec = { name: s.name, id: s.student_id, scores };
      const list = byKey.get(key) ?? [];
      list.push(rec);
      byKey.set(key, list);
    }
    for (const [key, list] of byKey) {
      await writeFile(
        `data/s/${key}.json`,
        JSON.stringify(list.length === 1 ? list[0] : list),
      );
    }

    await writeFile(
      "scores.html",
    page({
      title: `成绩查询 · ${siteTitle}`,
      active: "scores",
      withScores: true,
      withGroups: scope.groups,
      withHonors: scope.honors,
        body: `<div class="card">
<h2 style="margin-top:0">📈 个人成绩查询</h2>
<p style="color:var(--muted);font-size:14px">输入<b>姓名</b>和<b>学号后四位</b>查看历次成绩（可切换科目，虚线为班级平均）</p>
<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
  <input class="q" id="q" placeholder="姓名" autocomplete="off">
  <input class="q" id="t4" placeholder="学号后四位" maxlength="8" autocomplete="off" style="max-width:130px">
  <select id="subj" class="q" style="max-width:130px" onchange="query()"><option value="_t">总分</option>${
          subjects.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")
        }</select>
  <button class="btn" onclick="query()">查询</button>
</div>
<div id="result"></div>
</div>
<script src="assets/chart.js"></script>
<script>
const SUBS = ${JSON.stringify(subjects)};
let AVG = null;
function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
async function keyOf(name, tail) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(name + "|" + tail));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
async function loadAvg() {
  if (!AVG) AVG = await (await fetch("data/avg.json")).json();
  return AVG;
}
async function query() {
  const name = document.getElementById("q").value.trim();
  const tail = document.getElementById("t4").value.trim();
  const key = document.getElementById("subj").value;
  const box = document.getElementById("result");
  if (!name || !tail) { box.innerHTML = '<p style="margin-top:14px">请输入姓名和学号后四位</p>'; return; }
  const r = await fetch("data/s/" + (await keyOf(name, tail)) + ".json");
  if (!r.ok) { box.innerHTML = '<p style="margin-top:14px">未找到该同学，请确认姓名和学号后四位</p>'; return; }
  const found = await r.json();
  const list = Array.isArray(found) ? found : [found];
  const stu = list[0];
  const db = await loadAvg();
  const mine = db.exams.map((e) => stu.scores[e.id] ? stu.scores[e.id][key] : null);
  const cls = db.exams.map((e) => (db.avg[e.id] || {})[key]);
  const rows = db.exams.map((e) => {
    const per = stu.scores[e.id] || {};
    const cells = SUBS.map((s) => "<td>" + (per[s] == null ? "—" : per[s]) + "</td>").join("");
    return '<tr><td>' + esc(e.title) + '</td><td>' + esc(e.date) + '</td>' + cells +
      '<td><b>' + (per._t == null ? "—" : per._t) + '</b></td></tr>';
  }).join("");
  box.innerHTML =
    '<div style="margin-top:16px"><b>' + esc(stu.name) + '</b>（学号 ' + esc(stu.id) + '）' +
    (list.length > 1 ? '<span class="meta">存在多条匹配，显示第一条</span>' : '') + '</div>' +
    '<div id="chart"></div>' +
    '<div style="overflow-x:auto"><table class="score-table"><thead><tr><th>考试</th><th>日期</th>${
      subjects.map((s) => "<th>" + esc(s) + "</th>").join("")
    }<th>总分</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  document.getElementById("chart").innerHTML = ChartLib.line({
    w: 680, h: 260,
    series: [
      { name: key === "_t" ? "我的总分" : "我的" + key, color: "#2f6fed", points: mine, dashed: false },
      { name: "班级平均", color: "#f59e0b", points: cls, dashed: true },
    ],
    xLabels: db.exams.map((e) => e.title),
  });
}
for (const id of ["q", "t4"]) {
  document.getElementById(id).addEventListener("keydown", (ev) => { if (ev.key === "Enter") query(); });
}
</script>`,
      }),
    );
    files.push("scores.html", "data/avg.json");
  }

  // ---- 积分光荣榜：公开姓名 + 最近一个月净得分（表扬性质，无其他个人信息） ----
  if (scope.honors) {
    const [students, points] = await Promise.all([loadStudents(), loadPoints()]);
    const months = [...new Set(points.map((p) => (p.date || "").slice(0, 7)))]
      .filter((m) => /^\d{4}-\d{2}$/.test(m))
      .sort();
    const month = months.length ? months[months.length - 1] : "";
    const agg = new Map<string, number>();
    for (const p of points) {
      if (month && (p.date || "").slice(0, 7) !== month) continue;
      if (!p.student_id) continue;
      agg.set(p.student_id, (agg.get(p.student_id) ?? 0) + p.delta);
    }
    const ranked = students
      .map((s) => ({ name: s.name, net: agg.get(s.student_id) ?? 0 }))
      .filter((r) => r.net > 0)
      .sort((a, b) => b.net - a.net);
    const cards = ranked.slice(0, 3).map((r, i) =>
      `<div class="honor-card"><div class="m">${["🥇", "🥈", "🥉"][i]}</div><div class="n">${esc(r.name)}</div><div class="s">+${r.net} 分</div></div>`
    ).join("");
    const rows = ranked.slice(3, 10).map((r, i) =>
      `<tr><td>${i + 4}</td><td>${esc(r.name)}</td><td>+${r.net}</td></tr>`
    ).join("");
    const monthLabel = month ? `${month.slice(0, 4)} 年 ${Number(month.slice(5, 7))} 月` : "";
    await writeFile(
      "honors.html",
      page({
        title: `积分光荣榜 · ${siteTitle}`,
        active: "honors",
        withScores: scope.scores,
        withGroups: scope.groups,
        withHonors: true,
        body: `<div class="card">
<h2 style="margin-top:0">🌟 ${monthLabel}积分光荣榜</h2>
<p style="color:var(--muted);font-size:14px">按当月个人净得分排名（加分 − 扣分），取前 10 名</p>
${ranked.length
  ? `<div class="honor-cards">${cards}</div>${rows ? `<table class="score-table"><thead><tr><th>名次</th><th>姓名</th><th>净得分</th></tr></thead><tbody>${rows}</tbody></table>` : ""}`
  : '<p style="color:var(--muted)">本月暂无上榜学生</p>'}
</div>`,
      }),
    );
    files.push("honors.html");
  }

  // ---- 清理上次发布的残留产物（否则「取消勾选」形同虚设） ----
  await removeStale("data/scores.json"); // 旧版全量成绩文件，已被按人拆分取代
  if (!scope.groups) await removeStale("groups.html");
  if (!scope.honors) await removeStale("honors.html");
  if (!scope.scores) {
    await removeStale("scores.html");
    try {
      // data/ 整个删掉：avg.json 与按人成绩文件（data/s/*.json）都不应残留
      await Deno.remove(new URL("data/", siteDir), { recursive: true });
    } catch {
      // 不存在则忽略
    }
  }
  try {
    const kept = new Set(metas.map((m) => `${m.date}.html`));
    for await (const entry of Deno.readDir(new URL("journal/", siteDir))) {
      if (entry.isFile && entry.name.endsWith(".html") && !kept.has(entry.name)) {
        await Deno.remove(new URL(`journal/${entry.name}`, siteDir));
      }
    }
  } catch {
    // journal 目录不存在
  }

  return { files, journalCount: metas.length };
}
