/* 班级工作台 · 前端应用（Vue 3 全局构建，无构建步骤） */
"use strict";

const { createApp, reactive, computed } = Vue;

// ---------- 基础设施 ----------

const api = {
  async get(p) {
    const r = await fetch("/api" + p);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    return j;
  },
  async send(method, p, body) {
    const r = await fetch("/api" + p, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    return j;
  },
  put(p, b) { return this.send("PUT", p, b); },
  post(p, b) { return this.send("POST", p, b); },
  del(p) { return this.send("DELETE", p); },
};

const store = reactive({
  route: (location.hash || "#/dashboard").replace(/^#\//, "") || "dashboard",
  boot: null,
  toast: null,
  theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
});
let lastHash = location.hash || "#/dashboard";
window.addEventListener("hashchange", () => {
  // 导航守卫统一放在 hashchange：侧栏点击、go()、浏览器前进/后退都经过这里
  if (!confirmLeaveNav()) {
    // 拒绝切换：URL 回退到原地址（路由状态尚未变化）
    history.replaceState(null, "", lastHash);
    return;
  }
  lastHash = location.hash || "#/dashboard";
  store.route = (location.hash || "#/dashboard").replace(/^#\//, "") || "dashboard";
});

let toastTimer = null;
function toast(msg, ok = true) {
  store.toast = { msg, ok };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (store.toast = null), 2600);
}

async function refreshBoot() {
  store.boot = await api.get("/bootstrap");
  return store.boot;
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function num(v) {
  // 空白（含纯空格）视为缺考：Number(" ") 是 0，不能放行
  if (v == null || String(v).trim() === "" || isNaN(Number(v))) return null;
  return Math.round(Number(v) * 10) / 10;
}
function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

// 分隔符嗅探：Excel 粘贴是 Tab 分隔、CSV 文件是逗号分隔，取前 5 行中更多的那个
// （引号内的分隔符不计入，保证带引号的 CSV 不会被误判）
function detectDelim(text) {
  let tabs = 0, commas = 0, inQ = false;
  for (const c of text.split(/\r?\n/).slice(0, 5).join("\n")) {
    if (c === '"') inQ = !inQ;
    else if (!inQ) { if (c === "\t") tabs++; else if (c === ",") commas++; }
  }
  return tabs > commas ? "\t" : ",";
}

// 共享 CSV 解析（与后端 csv.ts 同规则：引号转义、\r\n、BOM），导入功能统一使用
function parseCsvText(text) {
  if (text.startsWith("\ufeff")) text = text.slice(1);
  const delim = detectDelim(text);
  const rows = [];
  let row = [], field = "", inQ = false, i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === delim) { row.push(field); field = ""; i++; continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      i++; row.push(field); rows.push(row); row = []; field = ""; continue;
    }
    field += c; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

// 学号排序：能转数字的按数值，否则按字符串
function compareById(a, b) {
  const na = Number(a.student_id), nb = Number(b.student_id);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.student_id < b.student_id ? -1 : a.student_id > b.student_id ? 1 : 0;
}

// ---------- 未保存修改的全局守卫 ----------
// 各视图把自己的「是否有未保存修改」探测函数注册进来，根组件统一拦截导航
let unsavedProbe = () => false;
function confirmLeaveNav() {
  return !unsavedProbe() || confirm("有未保存的修改，离开将丢失，确定？");
}

// ---------- 各视图组件 ----------

const Dashboard = {
  data: () => ({ store, busy: false, pulling: false }),
  computed: {
    boot() { return store.boot; },
    scoredCount() {
      return Object.keys(store.boot?.scores ?? {}).length;
    },
  },
  methods: {
    gitClass(r) { return r.isRepo ? (r.dirty ? "badge warn" : "badge pub") : "badge off"; },
    async doSeed() {
      this.busy = true;
      try {
        await api.post("/seed");
        await refreshBoot();
        toast("示例数据已生成，可到各页面体验");
      } catch (e) { toast(e.message, false); }
      this.busy = false;
    },
    // 未保存守卫在 hashchange 里统一处理，这里直接改地址即可
    go(r) { location.hash = "#/" + r; },
    // 换电脑 / 误清空后从云端数据仓库恢复
    async pullData() {
      if (!confirm("从云端数据仓库拉取并同步到本机？\n若本机有未备份的修改，请先到「发布中心 → 备份数据」。确定继续？")) return;
      this.pulling = true;
      try {
        const r = await api.post("/repo/data/pull", {});
        await refreshBoot();
        toast(r.detail || "已拉取云端数据");
      } catch (e) { toast(e.message, false); }
      this.pulling = false;
    },
  },
  template: `
<div>
  <div class="page-head"><h1>总览</h1></div>

  <div class="card" v-if="boot && !boot.students.length && !boot.journals.length">
    <h2>👋 欢迎使用班级工作台</h2>
    <p class="hint">当前没有任何数据。可先生成一份示例数据体验全部功能，或直接前往「班级名单」录入学生。</p>
    <button class="btn" :disabled="busy" @click="doSeed">生成示例数据（40 名学生 / 5 次考试 / 4 篇日志 / 积分流水）</button>
  </div>

  <div class="cards" v-if="boot">
    <div class="stat"><div class="num">{{ boot.students.length }}</div><div class="lbl">学生</div></div>
    <div class="stat"><div class="num">{{ boot.groups.length }}</div><div class="lbl">小组</div></div>
    <div class="stat"><div class="num">{{ Object.keys(boot.seatings || {}).length }}</div><div class="lbl">座位场景</div></div>
    <div class="stat"><div class="num">{{ scoredCount }}/{{ boot.exams.length }}</div><div class="lbl">已出成绩考试</div></div>
    <div class="stat"><div class="num">{{ boot.journals.length }}</div><div class="lbl">日志</div></div>
  </div>

  <div class="card" v-if="boot">
    <h2>发布与备份</h2>
    <p>
      <span :class="gitClass(boot.git.data)">数据仓库</span>
      {{ boot.git.data.lastCommit ? "上次提交：" + boot.git.data.lastCommit.subject : "还没有提交记录" }}
      <span v-if="!boot.git.data.isRepo" class="muted">（首次发布/备份时会自动初始化 git 仓库）</span>
    </p>
    <p>
      <span :class="gitClass(boot.git.site)">站点仓库</span>
      {{ boot.git.site.lastCommit ? "上次发布：" + boot.git.site.lastCommit.subject : "还没有发布过" }}
    </p>
    <div class="row" style="margin-top:6px">
      <button class="btn" @click="go('publish')">🚀 前往发布中心</button>
      <button class="btn-ghost" @click="go('journal')">✍️ 写班级日志</button>
      <button class="btn-ghost" :disabled="pulling" @click="pullData">{{ pulling ? "拉取中…" : "⬇ 拉取云端数据" }}</button>
    </div>
  </div>
</div>`,
};

const Students = {
  data: () => ({
    store,
    list: [],
    dirty: false,
    ready: false, // 初始化完成后才允许自动保存
    saveTimer: null,
    impOpen: false,
    impText: "",
    impMsg: "",
    impBusy: false,
  }),
  computed: {
    groups() { return store.boot?.groups ?? []; },
  },
  watch: {
    // 名单/文字记录是高频小编辑，做防抖自动保存；保存按钮保留为立即保存
    list: {
      deep: true,
      handler() {
        if (!this.ready) return;
        this.dirty = true;
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.save(true), 900);
      },
    },
  },
  async created() {
    if (!store.boot) await refreshBoot();
    this.sync();
    this.$nextTick(() => (this.ready = true));
  },
  methods: {
    sync() {
      this.ready = false;
      this.list = clone(store.boot?.students ?? []);
      this.dirty = false;
    },
    add() {
      const nums = this.list.map((s) => Number(s.student_id)).filter((n) => Number.isFinite(n));
      const next = (nums.length ? Math.max(...nums) : 2000) + 1;
      this.list.push({ student_id: String(next), name: "", gender: "", group_id: "", note: "" });
    },
    del(i) {
      if (confirm("确定删除 " + (this.list[i].name || "该行") + "？")) {
        this.list.splice(i, 1);
      }
    },
    // ---- Excel / 粘贴导入：识别 学号/姓名/性别/小组/备注 列，组名不存在时自动建组 ----
    findStudentHeader(aoa) {
      for (let i = 0; i < Math.min(aoa.length, 6); i++) {
        const row = (aoa[i] || []).map((c) => String(c ?? "").trim());
        const colOf = (...kws) => row.findIndex((c) => c && kws.some((k) => c.includes(k)));
        const head = {
          id: colOf("学号"),
          name: colOf("姓名"),
          gender: colOf("性别"),
          group: colOf("小组", "组别", "分组"),
          note: colOf("备注"),
        };
        if (head.id >= 0 || head.name >= 0) return { headerIdx: i, ...head };
      }
      return null;
    },
    parseStudentAoa(aoa) {
      const head = this.findStudentHeader(aoa);
      let cols = { id: 0, name: 1, gender: 2, group: -1, note: 3 };
      let start = 0, hasHeader = false;
      if (head) {
        cols = { id: head.id, name: head.name, gender: head.gender, group: head.group, note: head.note };
        start = head.headerIdx + 1;
        hasHeader = true;
      }
      const rows = [];
      for (let i = start; i < aoa.length; i++) {
        const r = aoa[i] || [];
        const sid = String(r[cols.id] ?? "").trim();
        const nm = String(r[cols.name] ?? "").trim();
        if (!sid || !nm) continue; // 学号姓名必填，与原粘贴导入规则一致
        rows.push({
          student_id: sid,
          name: nm,
          gender: cols.gender >= 0 ? String(r[cols.gender] ?? "").trim() : "",
          groupRaw: cols.group >= 0 ? String(r[cols.group] ?? "").trim() : "",
          note: cols.note >= 0 ? String(r[cols.note] ?? "").trim() : "",
        });
      }
      return { rows, hasHeader, hasGroupCol: !!head && head.group >= 0, idColFound: !head || head.id >= 0 };
    },
    async applyStudentAoa(aoa, srcLabel) {
      const { rows, hasHeader, hasGroupCol, idColFound } = this.parseStudentAoa(aoa);
      if (!rows.length) {
        this.impMsg = srcLabel + "：" + (!idColFound
          ? "表头中未识别到「学号」列，导入需要学号（补上后重试）"
          : "未解析出学生行（每行需同时有学号和姓名）");
        return;
      }
      // 组名 → 组 id 映射；文件里出现的新组自动创建并立即保存
      const groups = clone(store.boot?.groups ?? []);
      const byName = new Map(groups.map((g) => [g.name, g.group_id]));
      const newGroups = [];
      const groupIdOf = (raw) => {
        if (!raw) return "";
        if (byName.has(raw)) return byName.get(raw);
        const nums = groups.map((g) => Number(g.group_id.replace(/\D/g, "")) || 0);
        const gid = "G" + ((nums.length ? Math.max(...nums) : 0) + 1);
        const g = { group_id: gid, name: raw, leader_id: "" };
        groups.push(g);
        byName.set(raw, gid);
        newGroups.push(g);
        return gid;
      };
      let added = 0, updated = 0, groupSet = 0;
      for (const p of rows) {
        const gid = hasGroupCol ? groupIdOf(p.groupRaw) : "";
        const idx = this.list.findIndex((s) => s.student_id === p.student_id);
        if (idx >= 0) {
          const old = this.list[idx];
          this.list.splice(idx, 1, {
            student_id: p.student_id,
            name: p.name,
            gender: p.gender || old.gender,
            // 文件带小组列才覆盖归属，否则沿用旧值（沿用原粘贴导入约定）
            group_id: gid || old.group_id,
            note: p.note || old.note,
          });
          updated++;
        } else {
          this.list.push({ student_id: p.student_id, name: p.name, gender: p.gender, group_id: gid, note: p.note });
          added++;
        }
        if (gid) groupSet++;
      }
      if (newGroups.length) {
        try {
          await api.put("/groups", { groups });
          await refreshBoot();
        } catch (e) {
          this.impMsg = "小组自动创建失败：" + e.message + "（学生小组归属未写入）";
          return;
        }
      }
      this.impMsg = (newGroups.length ? "自动新建 " + newGroups.length + " 个小组；" : "") +
        srcLabel + "：" + (hasHeader ? "识别到表头；" : "未见表头，按「学号 姓名 性别 备注」列序解析；") +
        "新增 " + added + " 人，覆盖 " + updated + " 人" +
        (hasGroupCol ? "，写入小组 " + groupSet + " 人" : "");
    },
    async doImport() {
      const rows = parseCsvText(this.impText).map((r) => r.map((c) => c.trim()));
      if (!rows.length) { toast("先粘贴内容", false); return; }
      await this.applyStudentAoa(rows, "粘贴导入");
    },
    async onFile(e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = ""; // 允许重复选择同一文件
      if (!file) return;
      this.impBusy = true;
      try {
        let aoa;
        if (/\.csv$/i.test(file.name)) {
          const buf = await file.arrayBuffer();
          let text = new TextDecoder("utf-8").decode(buf);
          // 国内 Excel 导出的 CSV 常是 GBK 编码：解出乱码就用 GBK 重解
          if (text.includes("\uFFFD")) {
            try { text = new TextDecoder("gbk").decode(buf); } catch { /* 环境不支持则按原样 */ }
          }
          aoa = parseCsvText(text).map((r) => r.map((c) => c.trim()));
        } else {
          if (typeof XLSX === "undefined") throw new Error("解析库未加载");
          const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
          // 自动挑选含「学号/姓名」表头的 Sheet，找不到再用第一个
          aoa = null;
          for (const name of wb.SheetNames) {
            const probe = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: "" });
            if (this.findStudentHeader(probe)) { aoa = probe; break; }
          }
          if (!aoa) {
            aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
          }
        }
        await this.applyStudentAoa(aoa, "文件「" + file.name + "」");
      } catch (err) {
        this.impMsg = "文件解析失败：" + err.message;
      }
      this.impBusy = false;
    },
    async save(silent = false) {
      const snapshot = JSON.stringify(this.list);
      const clean = this.list.filter((s) => s.student_id.trim() && s.name.trim());
      const dropped = this.list.length - clean.length;
      const ids = new Set(clean.map((s) => s.student_id));
      if (ids.size !== clean.length) {
        // 自动保存也要给出可见反馈，否则用户不知道为什么一直没保存上
        toast("存在重复学号，修改未保存，请检查名单", false);
        return;
      }
      try {
        await api.put("/students", { students: clean });
        await refreshBoot();
        // 保存期间没有新输入才清除 dirty，避免丢掉正在进行的编辑
        if (JSON.stringify(this.list) === snapshot) this.dirty = false;
        if (!silent) toast("名单已保存" + (dropped ? "（" + dropped + " 行缺少学号/姓名被忽略）" : ""));
      } catch (e) { toast(e.message, false); }
    },
  },
  template: `
<div>
  <div class="page-head">
    <h1>班级名单 <span class="count">{{ list.length }} 人</span></h1>
    <div class="row">
      <button class="btn-ghost" @click="impOpen = !impOpen">📥 导入名单</button>
      <button class="btn" :disabled="!dirty" @click="save">💾 保存</button>
    </div>
  </div>

  <div class="card" v-if="impOpen">
    <p class="hint">
      方式一：上传 Excel（.xlsx/.xls）或 CSV 文件，自动识别<b>学号 / 姓名 / 性别 / 小组 / 备注</b>列（多 Sheet 自动挑选，CSV 兼容 GBK）；<br>
      方式二：从 Excel 复制区域粘贴到下面（Tab 或逗号分隔，含表头行更准）。已有学号将被覆盖，性别/备注留空沿用旧值；小组填组名，组不存在会自动创建。修改会自动保存。
    </p>
    <div class="row" style="margin-bottom:10px">
      <input type="file" accept=".xlsx,.xls,.csv" @change="onFile" :disabled="impBusy">
      <span class="hint" v-if="impBusy">解析中…</span>
    </div>
    <textarea v-model="impText" rows="6" placeholder="2026001	王梓涵	女"></textarea>
    <div class="row" style="margin-top:8px">
      <button class="btn" @click="doImport">导入粘贴内容</button>
      <span class="hint" v-if="impMsg">{{ impMsg }}</span>
    </div>
  </div>

  <table class="tbl">
    <thead><tr><th style="width:110px">学号</th><th style="width:120px">姓名</th><th style="width:80px">性别</th><th style="width:130px">小组</th><th>备注</th><th style="width:56px"></th></tr></thead>
    <tbody>
      <tr v-for="(s, i) in list" :key="i">
        <td><input type="text" v-model="s.student_id" @input="dirty = true"></td>
        <td><input type="text" v-model="s.name" @input="dirty = true"></td>
        <td>
          <select v-model="s.gender" @change="dirty = true">
            <option value=""></option><option>男</option><option>女</option>
          </select>
        </td>
        <td>
          <select v-model="s.group_id" @change="dirty = true">
            <option value="">未分组</option>
            <option v-for="g in groups" :key="g.group_id" :value="g.group_id">{{ g.name }}</option>
          </select>
        </td>
        <td><input type="text" v-model="s.note" @input="dirty = true"></td>
        <td><button class="link danger" @click="del(i)">删除</button></td>
      </tr>
    </tbody>
  </table>
  <p style="margin-top:10px"><button class="btn-ghost" @click="add">＋ 添加学生</button>
  <span class="hint" v-if="dirty" style="margin-left:10px">有未保存的修改</span></p>
</div>`,
};

const Groups = {
  data: () => ({ store, list: [], dirty: false }),
  async created() {
    if (!store.boot) await refreshBoot();
    this.sync();
  },
  methods: {
    sync() { this.list = clone(store.boot?.groups ?? []); this.dirty = false; },
    members(gid) { return (store.boot?.students ?? []).filter((s) => s.group_id === gid); },
    add() {
      const nums = this.list.map((g) => Number(g.group_id.replace(/\D/g, "")) || 0);
      const next = (nums.length ? Math.max(...nums) : 0) + 1;
      this.list.push({ group_id: "G" + next, name: "新小组" + next, leader_id: "" });
      this.dirty = true;
    },
    async del(i) {
      const g = this.list[i];
      const ms = this.members(g.group_id);
      if (!confirm("确定删除 " + g.name + "？" + (ms.length ? "（" + ms.length + " 名成员将变为未分组）" : ""))) return;
      this.list.splice(i, 1);
      // 同步清除成员归属
      const students = clone(store.boot.students);
      students.forEach((s) => { if (s.group_id === g.group_id) s.group_id = ""; });
      this.dirty = true;
      try {
        await api.put("/groups", { groups: this.list });
        await api.put("/students", { students });
        await refreshBoot();
        this.sync();
        toast("小组已删除");
      } catch (e) { toast(e.message, false); }
    },
    async save() {
      try {
        await api.put("/groups", { groups: this.list });
        await refreshBoot();
        this.sync();
        toast("小组已保存");
      } catch (e) { toast(e.message, false); }
    },
  },
  template: `
<div>
  <div class="page-head">
    <h1>小组管理 <span class="count">{{ list.length }} 个</span></h1>
    <div class="row">
      <button class="btn-ghost" @click="add">＋ 新建小组</button>
      <button class="btn" :disabled="!dirty" @click="save">💾 保存</button>
    </div>
  </div>
  <p class="hint" style="margin-top:-8px">成员归属在「班级名单」页设置；组长从本组成员中选择。</p>

  <div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">
    <div class="card" v-for="(g, i) in list" :key="i" style="margin:0">
      <div class="row">
        <input type="text" v-model="g.name" @input="dirty = true" style="font-weight:600;font-size:15px;flex:1">
        <button class="link danger" @click="del(i)">删除</button>
      </div>
      <div class="row" style="margin:8px 0">
        <span class="hint">组长：</span>
        <select v-model="g.leader_id" @change="dirty = true">
          <option value="">（未指定）</option>
          <option v-for="m in members(g.group_id)" :key="m.student_id" :value="m.student_id">{{ m.name }}</option>
        </select>
      </div>
      <div>
        <span v-if="members(g.group_id).length === 0" class="hint">暂无成员（去「班级名单」把学生分到本组）</span>
        <template v-else>
          <span v-for="m in members(g.group_id)" :key="m.student_id"
            class="chip" :class="{ leader: m.student_id === g.leader_id }">{{ m.name }}{{ m.student_id === g.leader_id ? " 👑" : "" }}</span>
        </template>
      </div>
    </div>
  </div>
</div>`,
};

const Scores = {
  data: () => ({
    store,
    exams: [],
    examsDirty: false,
    cur: "",
    rows: [], // [{student_id, name, scores:{语文:num|null, ...}}]
    scoresDirty: false,
    impOpen: false, impText: "", impMsg: "", impBusy: false,
    showNew: false,
    newExam: { date: todayStr(), title: "", type: "考试" },
    subjOpen: false, subjRows: [],
    trend: null, trendSvg: "", trendSubject: "_t",
  }),
  async created() {
    if (!store.boot) await refreshBoot();
    this.exams = clone(store.boot?.exams ?? []);
    this.pickCurrent();
    this.loadRows();
  },
  computed: {
    subjects() {
      const s = store.boot?.config?.subjects;
      return Array.isArray(s) && s.length ? s : ["总分"];
    },
    curExam() { return this.exams.find((e) => e.exam_id === this.cur); },
    stats() {
      if (!this.rows.length || !this.curExam) return null;
      const per = {};
      for (const s of this.subjects) {
        const vals = this.rows.map((r) => num(r.scores[s])).filter((v) => v != null);
        per[s] = vals.length
          ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
          : null;
      }
      // 总分平均只统计全科实考的学生：缺考者的残缺总分不能拉低班级平均
      const totals = this.rows.filter((r) => this.fullyAttended(r))
        .map((r) => this.totalOf(r)).filter((v) => v != null);
      return {
        per,
        n: totals.length,
        avgT: totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : null,
        fullT: this.subjects.reduce((a, s) => a + this.fullOf(s), 0),
      };
    },
    distSvg() {
      void store.theme; // 主题切换时重新取色渲染
      if (!this.stats || !this.stats.avgT) return "";
      const f = this.stats.fullT;
      const edges = [0.6, 0.7, 0.8, 0.9];
      const b = [0, 0, 0, 0, 0];
      this.rows.filter((r) => this.fullyAttended(r)).forEach((r) => {
        const t = this.totalOf(r);
        if (t == null) return;
        const ra = t / f;
        b[ra < edges[0] ? 0 : ra < edges[1] ? 1 : ra < edges[2] ? 2 : ra < edges[3] ? 3 : 4]++;
      });
      const label = (i) =>
        i === 0 ? "<" + Math.ceil(f * edges[0])
        : i === 4 ? Math.floor(f * edges[3]) + "+"
        : Math.round(f * edges[i - 1]) + "-" + Math.round(f * edges[i] - 1);
      return ChartLib.bars({
        w: 620, h: 160, values: b,
        labels: [0, 1, 2, 3, 4].map(label),
      });
    },
  },
  methods: {
    fullOf(s) {
      const f = store.boot?.config?.subject_full ?? {};
      return Number(f[s]) || 100;
    },
    // 全科实考：任何一科缺考（null）都算没有完整参加这次考试
    fullyAttended(row) {
      return this.subjects.every((s) => num(row.scores[s]) != null);
    },
    totalLabel(r) {
      const vals = this.subjects.map((s) => num(r.scores[s]));
      const got = vals.filter((v) => v != null);
      if (!got.length) return "—";
      const sum = got.reduce((a, b) => a + b, 0);
      const missing = vals.length - got.length;
      return missing ? sum + "（缺" + missing + "科）" : String(sum);
    },
    openSubj() {
      // orig 记录打开面板时的科目名，作为该行的身份，用于识别改名
      this.subjRows = this.subjects.map((s) => ({ name: s, orig: s, full: this.fullOf(s) }));
      this.subjOpen = true;
    },
    async saveSubj() {
      const names = this.subjRows.map((r) => r.name.trim()).filter(Boolean);
      if (new Set(names).size !== names.length) { toast("科目名重复", false); return; }
      if (!names.length) { toast("至少保留一个科目", false); return; }
      // 识别改名：行身份(orig)被改成新名、且新名不是已有科目、原科目名也没有
      // 被其他行占用时，视为改名并迁移历史成绩列；否则按「删旧建新」处理不迁移，
      // 避免把列头改到已有列上造成数据错位
      const oldSet = new Set(this.subjects);
      const newSet = new Set(names);
      const renames = {};
      this.subjRows.forEach((r) => {
        const name = r.name.trim();
        if (r.orig && name && name !== r.orig && !oldSet.has(name) && !newSet.has(r.orig)) {
          renames[r.orig] = name;
        }
      });
      const renamed = Object.keys(renames).length > 0;
      const removed = this.subjects.some((s) => !newSet.has(s) && !(s in renames));
      if (renamed || removed) {
        const msg = (renamed ? "检测到科目改名，历史成绩列将自动迁移。" : "") +
          (removed ? "检测到科目删除，该科目的列将在下次保存成绩时移除（文件数据保留）。" : "");
        if (!confirm(msg + "确定保存？")) return;
      }
      if (this.scoresDirty && this.hasAnyScore() &&
        !confirm("当前考试有未保存的成绩修改，保存科目设置后将重新载入并丢弃这些修改，确定？")) return;
      const fulls = {};
      for (const r of this.subjRows) {
        if (r.name.trim()) fulls[r.name.trim()] = Number(r.full) || 100;
      }
      try {
        await api.put("/config", { subjects: names, subject_full: fulls, renames });
        await refreshBoot();
        this.subjOpen = false;
        this.loadRows();
        toast("科目设置已保存" + (renamed ? "，历史成绩列已迁移" : ""));
      } catch (e) { toast(e.message, false); }
    },
    // 当前考试表格里是否录入了至少一个分数（dirty 但全空时无需确认丢弃）
    hasAnyScore() {
      return this.rows.some((r) => this.subjects.some((s) => num(r.scores[s]) != null));
    },
    totalOf(r) {
      const vals = this.subjects.map((s) => num(r.scores[s])).filter((v) => v != null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    },
    pickCurrent() {
      if (!this.exams.find((e) => e.exam_id === this.cur)) {
        const scored = this.exams.find((e) => (store.boot.scores[e.exam_id] || []).length);
        this.cur = (scored || this.exams[this.exams.length - 1] || {}).exam_id ?? "";
      }
    },
    loadRows() {
      const students = clone(store.boot?.students ?? []).sort(compareById);
      const saved = store.boot?.scores[this.cur] ?? [];
      const byId = Object.fromEntries(saved.map((r) => [r.student_id, r.scores || {}]));
      this.rows = students.map((s) => ({
        student_id: s.student_id,
        name: s.name,
        scores: Object.fromEntries(
          this.subjects.map((sub) => [sub, num(byId[s.student_id]?.[sub])]),
        ),
      }));
      this.scoresDirty = false;
    },
    onPickExam(e) {
      const target = e.target.value;
      if (!target || target === this.cur) return;
      if ((this.scoresDirty || this.examsDirty) &&
        !confirm("当前有未保存的修改（成绩或考试信息），切换将丢失，确定？")) {
        // 取消切换：下拉框恢复为当前考试，绝不能让表格数据和显示的考试错位
        e.target.value = this.cur;
        return;
      }
      this.cur = target;
      this.loadRows();
    },
    async addExam() {
      const n = this.newExam;
      if (!n.title.trim()) { toast("请填写考试名称", false); return; }
      // 与切换考试同一保护：已录入分数的未保存修改不能被静默丢弃
      if (this.scoresDirty && this.hasAnyScore() &&
        !confirm("当前考试有未保存的成绩修改，创建新考试后将丢弃，确定？")) return;
      // 复用被删除考试留下的空号，避免编号跳着走；
      // 已有成绩文件的编号不复用（防止孤儿成绩文件「复活」到新考试名下）
      const idOf = (i) => "E" + String(i).padStart(2, "0");
      let num = 1;
      while (
        this.exams.some((e) => e.exam_id === idOf(num)) ||
        store.boot?.scores?.[idOf(num)] !== undefined
      ) num++;
      const id = idOf(num);
      this.exams.push({
        exam_id: id, date: n.date, title: n.title.trim(), type: n.type,
      });
      try {
        await api.put("/exams", { exams: this.exams });
        await refreshBoot();
        this.exams = clone(store.boot.exams);
        this.cur = id;
        this.loadRows();
        this.scoresDirty = true; // 提示保存（生成成绩文件）
        this.examsDirty = false; // 考试信息（含其他考试的修改）已随本次提交保存
        this.showNew = false;
        this.newExam = { date: todayStr(), title: "", type: "考试" };
        toast("考试已创建，导入或录入成绩后保存");
      } catch (e) { toast(e.message, false); }
    },
    async delExam() {
      const e = this.curExam;
      if (!e || !confirm("删除「" + e.title + "」及其全部成绩？此操作不可恢复！" +
        (this.examsDirty ? "（其他考试未保存的信息修改将一并丢弃）" : ""))) return;
      try {
        await api.del("/exams/" + e.exam_id);
        await refreshBoot();
        this.exams = clone(store.boot.exams);
        this.examsDirty = false; // 本地列表已替换为服务器状态，避免幽灵「未保存」提示
        this.cur = "";
        this.pickCurrent();
        this.loadRows();
        toast("考试已删除");
      } catch (err) { toast(err.message, false); }
    },
    async saveExamMeta() {
      try {
        await api.put("/exams", { exams: this.exams });
        await refreshBoot();
        this.examsDirty = false;
        toast("考试信息已保存");
      } catch (e) { toast(e.message, false); }
    },
    // ---- 导入：Excel 文件 / 粘贴，统一走 AOA（二维数组）解析 ----
    // 在前 6 行内识别表头行（学号/姓名/科目列），供解析与多 Sheet 挑选共用
    findHeader(aoa) {
      const subj = this.subjects;
      for (let i = 0; i < Math.min(aoa.length, 6); i++) {
        const row = (aoa[i] || []).map((c) => String(c ?? "").trim());
        const hi = row.findIndex((c) => c.includes("学号"));
        const hn = row.findIndex((c) => c.includes("姓名"));
        const hasSubj = row.some((c) => subj.includes(c));
        if (hi >= 0 || hn >= 0 || hasSubj) {
          const subjCol = {};
          row.forEach((c, ci) => {
            if (subj.includes(c)) subjCol[c] = ci;
          });
          return { headerIdx: i, idCol: hi, nameCol: hn, subjCol };
        }
      }
      return null;
    },
    parseAoa(aoa) {
      const subj = this.subjects;
      const head = this.findHeader(aoa);
      let headerIdx = -1, idCol = -1, nameCol = -1;
      const subjCol = {};
      let dataStart = 0;
      if (head) {
        headerIdx = head.headerIdx;
        idCol = head.idCol;
        nameCol = head.nameCol;
        Object.assign(subjCol, head.subjCol);
        dataStart = headerIdx + 1;
      } else {
        // 无表头：按首行数据探测（纯数字列 → 学号）
        const first = (aoa[0] || []).map((c) => String(c ?? "").trim());
        if (/^\d{3,}$/.test(first[0] || "")) {
          idCol = 0; nameCol = 1;
          subj.forEach((s, si) => (subjCol[s] = 2 + si));
        } else {
          nameCol = 0;
          subj.forEach((s, si) => (subjCol[s] = 1 + si));
        }
      }
      const parsed = [];
      for (let i = dataStart; i < aoa.length; i++) {
        const row = aoa[i] || [];
        const id = String(row[idCol] ?? "").trim();
        const name = String(row[nameCol] ?? "").trim();
        if (!id && !name) continue;
        // 汇总行（平均分/合计等）可能出现在学号或姓名任一列
        if (
          /^(班级平均|年级平均|平均分|合计|名次|排名)/.test(name) ||
          /^(班级平均|年级平均|平均分|合计)/.test(id)
        ) continue;
        const scores = {};
        for (const s of subj) {
          const ci = subjCol[s];
          scores[s] = ci == null ? null : num(row[ci]);
        }
        parsed.push({ student_id: id, name, scores });
      }
      return { parsed, subjCol, headerIdx };
    },
    applyAoa(aoa, srcLabel) {
      const { parsed, subjCol, headerIdx } = this.parseAoa(aoa);
      if (!parsed.length) {
        this.impMsg = srcLabel + "：未解析出数据行（需包含学号或姓名列）";
        return;
      }
      // 识别到表头却没有任何科目列：若仍提示「匹配 N 行」会让老师误以为导入成功
      const noSubjCol = headerIdx >= 0 && Object.keys(subjCol).length === 0;
      let hit = 0;
      const unmatched = [];
      for (const p of parsed) {
        const row = this.rows.find((r) =>
          (p.student_id && r.student_id === p.student_id) ||
          (p.name && r.name === p.name));
        if (!row) { unmatched.push(p.name || p.student_id); continue; }
        if (!noSubjCol) {
          for (const s of this.subjects) {
            // 空白单元格不覆盖已录入的分数，只写入文件里实际有值的单元格
            if (subjCol[s] != null && p.scores[s] != null) row.scores[s] = p.scores[s];
          }
        }
        hit++;
      }
      this.impMsg = srcLabel + "：" + (headerIdx >= 0 ? "识别到表头；" : "未见表头，按默认列序解析；") +
        (noSubjCol
          ? "表头中未识别到任何科目列，仅匹配到学生、未写入分数，请检查表头"
          : "匹配 " + hit + " 行" +
            (unmatched.length
              ? "；未匹配 " + unmatched.length + " 行（" + unmatched.slice(0, 3).join("、") +
                (unmatched.length > 3 ? "…" : "") + "不在名单）"
              : ""));
      if (hit && !noSubjCol) this.scoresDirty = true;
    },
    doImport() {
      const rows = parseCsvText(this.impText).map((r) => r.map((c) => c.trim()));
      if (!rows.length) { toast("先粘贴内容", false); return; }
      this.applyAoa(rows, "粘贴导入");
    },
    async onFile(e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = ""; // 允许重复选择同一文件
      if (!file) return;
      this.impBusy = true;
      try {
        let aoa;
        if (/\.csv$/i.test(file.name)) {
          const buf = await file.arrayBuffer();
          let text = new TextDecoder("utf-8").decode(buf);
          // 国内 Excel 导出的 CSV 常是 GBK 编码：解出乱码就用 GBK 重解
          if (text.includes("\uFFFD")) {
            try { text = new TextDecoder("gbk").decode(buf); } catch { /* 环境不支持则按原样 */ }
          }
          aoa = parseCsvText(text).map((r) => r.map((c) => c.trim()));
        } else {
          if (typeof XLSX === "undefined") throw new Error("解析库未加载");
          const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
          // 自动挑选含「学号/姓名/科目」表头的 Sheet，找不到再用第一个
          aoa = null;
          for (const name of wb.SheetNames) {
            const probe = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: "" });
            if (this.findHeader(probe)) { aoa = probe; break; }
          }
          if (!aoa) {
            aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
          }
        }
        this.applyAoa(aoa, "文件「" + file.name + "」");
      } catch (err) {
        this.impMsg = "文件解析失败：" + err.message;
      }
      this.impBusy = false;
    },
    // 导出当前考试成绩为 Excel（解析库不可用时降级为 CSV）
    exportXlsx() {
      const e = this.curExam;
      if (!e) return;
      const aoa = [["学号", "姓名", ...this.subjects, "总分"]];
      for (const r of this.rows) {
        aoa.push([
          r.student_id, r.name,
          ...this.subjects.map((s) => num(r.scores[s]) ?? ""),
          this.totalOf(r) ?? "",
        ]);
      }
      const base = (e.title || e.exam_id) + "-" + (e.date || "");
      try {
        if (typeof XLSX === "undefined") throw new Error("no xlsx");
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, (e.title || e.exam_id).replace(/[\\/?*[\]:]/g, "-").slice(0, 28));
        XLSX.writeFile(wb, base + ".xlsx");
        toast("已导出 Excel");
      } catch (err) {
        // 降级：带 BOM 的 CSV，Excel 双击直开
        const csv = "\ufeff" + aoa.map((row) =>
          row.map((c) => /[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : c).join(",")
        ).join("\r\n");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        a.download = base + ".csv";
        a.click();
        URL.revokeObjectURL(a.href);
        if (err.message !== "no xlsx") toast("Excel 导出失败，已改为 CSV：" + err.message, false);
      }
    },
    async saveScores() {
      try {
        await api.put("/scores/" + this.cur, {
          rows: this.rows.map((r) => ({
            student_id: r.student_id,
            scores: Object.fromEntries(
              this.subjects.map((s) => {
                const v = num(r.scores[s]);
                // 前端先钳制到 [0, 满分]，后端还会再校验一次
                return [s, v == null ? null : Math.max(0, Math.min(this.fullOf(s), v))];
              }),
            ),
          })),
        });
        await refreshBoot();
        this.scoresDirty = false;
        toast("成绩已保存到 " + (this.curExam?.title || this.cur));
      } catch (e) { toast(e.message, false); }
    },
    openTrend(row) {
      this.trend = { name: row.name, id: row.student_id };
      this.trendSubject = "_t";
      this.renderTrend();
    },
    renderTrend() {
      if (!this.trend) return;
      const key = this.trendSubject;
      const scored = this.exams
        .filter((e) => (store.boot.scores[e.exam_id] || []).length)
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      const val = (row, subj) => key === "_t"
        ? this.totalOfBoot(row)
        : num(row.scores[key]);
      const mine = [], cls = [];
      for (const e of scored) {
        const rows = store.boot.scores[e.exam_id];
        const me = rows.find((r) => r.student_id === this.trend.id);
        mine.push(me ? val(me) : null);
        // 总分平均只统计全科实考的学生，与统计卡片口径一致
        const pool = key === "_t" ? rows.filter((r) => this.fullyAttended(r)) : rows;
        const vals = pool.map((r) => val(r)).filter((v) => v != null);
        cls.push(vals.length
          ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10
          : null);
      }
      this.trendSvg = ChartLib.line({
        w: 680, h: 280,
        series: [
          { name: key === "_t" ? this.trend.name + "·总分" : this.trend.name + "·" + key, color: "#2f6fed", points: mine, dashed: false },
          { name: "班级平均", color: "#f59e0b", points: cls, dashed: true },
        ],
        xLabels: scored.map((e) => e.title),
      });
    },
    totalOfBoot(row) {
      const vals = this.subjects.map((s) => num(row.scores[s])).filter((v) => v != null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    },
  },
  template: `
<div>
  <div class="page-head">
    <h1>成绩管理</h1>
    <div class="row">
      <select :value="cur" @change="onPickExam" style="min-width:180px">
        <option value="" disabled>选择考试…</option>
        <option v-for="e in exams" :key="e.exam_id" :value="e.exam_id">{{ e.exam_id }} · {{ e.title }}（{{ e.date }}）</option>
      </select>
      <button class="btn-ghost" @click="showNew = !showNew">＋ 新考试</button>
      <button class="btn" :disabled="!cur || !scoresDirty" @click="saveScores">💾 保存成绩</button>
    </div>
  </div>

  <div class="card" v-if="showNew">
    <h2>新建考试</h2>
    <div class="row">
      <label>日期 <input type="date" v-model="newExam.date"></label>
      <label>名称 <input type="text" v-model="newExam.title" placeholder="如：期中考试" style="width:170px"></label>
      <label>类型
        <select v-model="newExam.type"><option>测验</option><option>考试</option><option>作业</option></select>
      </label>
      <button class="btn" @click="addExam">创建</button>
    </div>
  </div>

  <div class="card" v-if="subjOpen">
    <h2>科目与满分设置</h2>
    <div class="row" v-for="(r, i) in subjRows" :key="i" style="margin-bottom:6px">
      <input type="text" v-model="r.name" placeholder="科目名" style="width:110px">
      <input type="number" v-model.number="r.full" min="10" style="width:80px"> 分
      <button class="link danger" @click="subjRows.splice(i, 1)">移除</button>
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn-ghost" @click="subjRows.push({ name: '', orig: null, full: 100 })">＋ 添加科目</button>
      <button class="btn" @click="saveSubj">保存设置</button>
      <span class="hint">总分满分 {{ subjRows.reduce((a, r) => a + (Number(r.full) || 0), 0) }} 分</span>
    </div>
    <p class="hint">默认主科（语数英）150 分、其余 100 分；科目改名会自动迁移历史成绩列，删除科目后该列在下次保存成绩时移除。</p>
  </div>

  <template v-if="cur && curExam">
    <div class="card">
      <div class="row">
        <label>日期 <input type="date" v-model="curExam.date" @change="examsDirty = true"></label>
        <label>名称 <input type="text" v-model="curExam.title" @input="examsDirty = true" style="width:170px"></label>
        <label>类型
          <select v-model="curExam.type" @change="examsDirty = true"><option>测验</option><option>考试</option><option>作业</option></select>
        </label>
        <button class="btn-ghost" v-if="examsDirty" @click="saveExamMeta">保存考试信息</button>
        <span class="grow"></span>
        <button class="btn-danger" @click="delExam">🗑 删除考试</button>
      </div>
    </div>

    <div class="card" v-if="stats">
      <div class="row">
        <span class="chip"><b>总分平均 {{ stats.avgT }}</b>（满分 {{ stats.fullT }}）</span>
        <span class="chip">全科实考 {{ stats.n }} 人</span>
        <span class="chip" v-for="(v, s) in stats.per" :key="s">{{ s }} {{ v ?? "—" }}</span>
        <span class="grow"></span>
        <button class="btn-ghost" @click="openSubj">⚙ 科目设置</button>
        <button class="btn-ghost" @click="impOpen = !impOpen">📥 导入成绩（Excel / 粘贴）</button>
        <button class="btn-ghost" :disabled="!cur" @click="exportXlsx">⬇ 导出 Excel</button>
      </div>
      <div v-html="distSvg" v-if="distSvg" style="max-width:620px;margin-top:6px"></div>
    </div>

    <div class="card" v-if="impOpen">
      <h2>导入成绩</h2>
      <p class="hint">
        方式一：上传 Excel（.xlsx）或 CSV 文件，自动识别表头中的<b>学号 / 姓名 / 各科</b>列；<br>
        方式二：从 Excel 复制区域后粘贴。导入仅写入当前考试「{{ curExam.title }}」，点上方「保存成绩」生效；空白单元格不会覆盖已录入的分数。
      </p>
      <div class="row" style="margin-bottom:10px">
        <input type="file" accept=".xlsx,.xls,.csv" @change="onFile" :disabled="impBusy">
        <span class="hint" v-if="impBusy">解析中…</span>
      </div>
      <textarea v-model="impText" rows="4" placeholder="学号	姓名	语文	数学	英语	物理	化学	生物	政治	历史	地理（含或不含表头均可）"></textarea>
      <div class="row" style="margin-top:8px">
        <button class="btn" @click="doImport">解析粘贴内容</button>
      </div>
      <p class="hint" v-if="impMsg" style="margin:10px 0 0"><b>{{ impMsg }}</b></p>
    </div>

    <div style="overflow-x:auto">
      <table class="tbl">
        <thead>
          <tr>
            <th style="width:100px">学号</th>
            <th style="width:100px">姓名</th>
            <th v-for="s in subjects" :key="s" style="width:74px">{{ s }}</th>
            <th>总分</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.student_id">
            <td class="num-cell">{{ r.student_id }}</td>
            <td><button class="link" @click="openTrend(r)" title="查看趋势">{{ r.name }}<span class="trend-ic">↗</span></button></td>
            <td v-for="s in subjects" :key="s">
              <input type="number" v-model.number="r.scores[s]" @input="scoresDirty = true" min="0" :max="fullOf(s)"
                style="width:64px" :class="{ 'score-empty': r.scores[s] == null || r.scores[s] === '' }"
                title="留空 = 缺考/未录入">
            </td>
            <td class="num-cell"><b>{{ totalLabel(r) }}</b></td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="hint" v-if="scoresDirty" style="margin-top:8px">有未保存的分数修改（缺考科目请清空输入框）</p>
  </template>

  <div class="card" v-else-if="!exams.length">
    <h2>还没有考试记录</h2>
    <p class="hint">点击右上角「＋ 新考试」创建第一次考试，然后导入 Excel 或手动录入成绩。</p>
  </div>

  <div class="overlay" v-if="trend" @click.self="trend = null">
    <div class="modal">
      <div class="page-head">
        <h1 style="font-size:18px">{{ trend.name }} 的成绩趋势</h1>
        <div class="row">
          <label class="row" style="gap:6px">科目
            <select v-model="trendSubject" @change="renderTrend">
              <option value="_t">总分</option>
              <option v-for="s in subjects" :key="s" :value="s">{{ s }}</option>
            </select>
          </label>
          <button class="btn-ghost" @click="trend = null">关闭</button>
        </div>
      </div>
      <div v-html="trendSvg"></div>
      <p class="hint">虚线为班级平均；折线断点表示该次缺考。</p>
    </div>
  </div>
</div>`,
};

const Journal = {
  data: () => ({
    store,
    sel: "",
    form: { title: "", publish: true, content: "" },
    preview: "",
    showPreview: false,
    dirty: false,
    previewTimer: null,
    uploading: false,
  }),
  computed: {
    list() { return store.boot?.journals ?? []; },
  },
  async created() {
    if (!store.boot) await refreshBoot();
    if (this.list.length) await this.select(this.list[0].date);
  },
  methods: {
    async select(date) {
      if (this.dirty && !confirm("当前日志有未保存修改，放弃并切换？")) return;
      this.sel = date;
      try {
        const j = await api.get("/journal/" + date);
        this.form = { title: j.title, publish: j.publish, content: j.content };
        this.dirty = false;
        this.renderPreview();
      } catch (e) { toast(e.message, false); }
    },
    async newToday() {
      const d = todayStr();
      if (this.list.find((j) => j.date === d)) {
        await this.select(d);
        return;
      }
      if (this.dirty && !confirm("当前日志有未保存修改，放弃并新建？")) return;
      this.sel = d;
      this.form = { title: "", publish: true, content: "" };
      this.dirty = true;
      this.renderPreview();
    },
    onEdit() {
      this.dirty = true;
      clearTimeout(this.previewTimer);
      this.previewTimer = setTimeout(() => this.renderPreview(), 400);
    },
    async renderPreview() {
      if (!this.showPreview) return;
      const r = await api.post("/markdown", { text: this.form.content });
      this.preview = r.html;
    },
    // ---- 图片上传：编辑器一键插入 / 直接粘贴截图 ----
    onPickFileChange(e) {
      const files = e.target.files ? [...e.target.files] : [];
      e.target.value = "";
      this.uploadImages(files);
    },
    onPaste(e) {
      const files = e.clipboardData?.files;
      if (files && files.length) {
        e.preventDefault();
        this.uploadImages([...files]);
      }
    },
    async uploadImages(files) {
      for (const f of files) {
        if (!/^image\/(png|jpe?g|gif|webp)$/i.test(f.type)) {
          toast("仅支持 png/jpg/gif/webp 图片：" + f.name, false);
          continue;
        }
        if (f.size > 20 * 1024 * 1024) {
          toast("图片超过 20MB：" + f.name, false);
          continue;
        }
        this.uploading = true;
        try {
          const fd = new FormData();
          fd.append("file", f);
          const r = await fetch("/api/attachment", { method: "POST", body: fd });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
          this.insertAtCursor(`![图片](${j.path})\n`);
          toast("图片已插入，记得保存日志");
        } catch (e) {
          toast("上传失败：" + e.message, false);
        }
        this.uploading = false;
      }
    },
    insertAtCursor(text) {
      const el = this.$refs.editor;
      if (el && el.selectionStart != null) {
        const s = el.selectionStart, e2 = el.selectionEnd;
        this.form.content = this.form.content.slice(0, s) + text + this.form.content.slice(e2);
      } else {
        this.form.content += (this.form.content && !this.form.content.endsWith("\n") ? "\n" : "") + text;
      }
      this.onEdit();
    },
    async save() {
      if (!this.sel) return;
      if (!this.form.title.trim()) { toast("请填写标题", false); return; }
      try {
        await api.put("/journal/" + this.sel, this.form);
        await refreshBoot();
        this.dirty = false;
        toast("日志已保存" + (this.form.publish ? "（发布时对学生可见）" : "（私有，仅本地）"));
      } catch (e) { toast(e.message, false); }
    },
    async del() {
      if (!this.sel || !confirm("删除 " + this.sel + " 的日志？")) return;
      try {
        await api.del("/journal/" + this.sel);
        await refreshBoot();
        this.sel = "";
        this.dirty = false;
        this.form = { title: "", publish: true, content: "" };
        if (this.list.length) await this.select(this.list[0].date);
        toast("日志已删除");
      } catch (e) { toast(e.message, false); }
    },
  },
  template: `
<div>
  <div class="page-head">
    <h1>班级日志 <span class="count">{{ list.length }} 篇</span></h1>
    <button class="btn" @click="newToday">✍️ 写今天</button>
  </div>

  <div class="journal-layout">
    <div class="j-list">
      <div v-for="j in list" :key="j.date" class="j-item" :class="{ on: j.date === sel }" @click="select(j.date)">
        <div class="t">{{ j.title }}</div>
        <div class="d">{{ j.date }}
          <span class="badge pub" v-if="j.publish">公开</span>
          <span class="badge priv" v-else>私有</span>
        </div>
      </div>
      <div v-if="!list.length" style="padding:16px" class="hint">还没有日志，点击右上角「写今天」开始第一篇。</div>
    </div>

    <div class="card" style="margin:0">
      <template v-if="sel">
        <div class="editor-tools">
          <input type="text" v-model="form.title" @input="onEdit" placeholder="标题">
          <label class="row" style="gap:6px;cursor:pointer">
            <input type="checkbox" v-model="form.publish" @change="onEdit">
            <span :class="form.publish ? '' : 'muted'">{{ form.publish ? "🌍 发布后学生可见" : "🔒 私有（仅本地）" }}</span>
          </label>
        </div>
        <textarea ref="editor" v-model="form.content" @input="onEdit" @paste="onPaste" rows="14"
          style="font-family:ui-monospace,Consolas,monospace;font-size:13.5px"
          placeholder="支持 Markdown：## 标题、**加粗**、- 列表、> 引用、[链接](url)、![图片](attachments/xx.jpg)（可直接粘贴截图）"></textarea>
        <div class="row" style="margin-top:10px">
          <button class="btn" :disabled="!dirty" @click="save">💾 保存</button>
          <button class="btn-ghost" @click="showPreview = !showPreview; renderPreview()">{{ showPreview ? "编辑模式" : "👁 预览" }}</button>
          <button class="btn-ghost" :disabled="uploading" @click="$refs.fileInput.click()">{{ uploading ? "上传中…" : "🖼 插入图片" }}</button>
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple
            ref="fileInput" style="display:none" @change="onPickFileChange">
          <span class="grow"></span>
          <button class="btn-danger" @click="del">删除</button>
        </div>
        <div class="preview" v-if="showPreview" v-html="preview"></div>
        <p class="hint" v-if="dirty" style="margin-top:8px">有未保存的修改</p>
      </template>
      <template v-else>
        <p class="hint">选择左侧日志，或新建一篇。</p>
      </template>
    </div>
  </div>
</div>`,
};

const Seating = {
  data: () => ({
    store,
    scenName: "",
    _loaded: "",
    rows: 6, cols: 8,
    grid: [], // grid[r][c] = student_id | ""
    dirty: false,
    sel: null, // {r, c}
    undoStack: [], // {rows, cols, grid} 快照
    newOpen: false,
    newName: "考试座次",
    rowsInput: 6,
    colsInput: 8,
  }),
  async created() {
    if (!store.boot) await refreshBoot();
    const names = Object.keys(store.boot?.seatings ?? {});
    if (names.length) this.load(names[0]);
    else { this.scenName = ""; this.initGrid(6, 8); this.dirty = false; }
  },
  computed: {
    scenNames() { return Object.keys(store.boot?.seatings ?? {}); },
    // 新建未保存的场景也要在下拉框里可见，否则显示为空白
    scenOptions() {
      const names = Object.keys(store.boot?.seatings ?? {});
      if (this.scenName && !names.includes(this.scenName)) return [this.scenName, ...names];
      return names;
    },
    students() { return store.boot?.students ?? []; },
    byId() {
      return Object.fromEntries(this.students.map((s) => [s.student_id, s]));
    },
    flatCells() { return this.grid.flat(); },
    selIdx() { return this.sel ? this.sel.r * this.cols + this.sel.c : -1; },
    seatedIds() {
      const set = new Set();
      this.grid.forEach((row) => row.forEach((id) => { if (id) set.add(id); }));
      return set;
    },
    unseated() {
      return this.students.filter((s) => !this.seatedIds.has(s.student_id));
    },
  },
  methods: {
    // ---- 撤销：每次改动前压入快照 ----
    pushUndo() {
      this.undoStack.push({ rows: this.rows, cols: this.cols, grid: clone(this.grid) });
      if (this.undoStack.length > 50) this.undoStack.shift();
    },
    undo() {
      const s = this.undoStack.pop();
      if (!s) return;
      this.rows = s.rows;
      this.cols = s.cols;
      this.grid = s.grid;
      this.syncSizeInputs();
      this.sel = null;
      this.dirty = true;
    },
    initGrid(rows, cols) {
      this.rows = rows;
      this.cols = cols;
      this.rowsInput = rows;
      this.colsInput = cols;
      this.grid = Array.from({ length: rows }, () => Array(cols).fill(""));
    },
    syncSizeInputs() {
      this.rowsInput = this.rows;
      this.colsInput = this.cols;
    },
    load(name) {
      const s = store.boot.seatings[name];
      this.scenName = name;
      this._loaded = name;
      this.initGrid(s.rows || 6, s.cols || 8);
      for (const seat of s.seats) {
        if (seat.row >= 1 && seat.row <= this.rows && seat.col >= 1 && seat.col <= this.cols) {
          this.grid[seat.row - 1][seat.col - 1] = seat.student_id || "";
        }
      }
      this.dirty = false;
      this.sel = null;
      this.undoStack = [];
    },
    switchScen(e) {
      const target = e.target.value;
      if (!target || target === this._loaded) return;
      if (this.dirty && !confirm("当前座位表有未保存修改，切换将丢失，确定？")) {
        // 未保存的新场景不在已保存列表里，恢复为当前名而不是置空
        this.scenName = this._loaded || this.scenName;
        e.target.value = this._loaded;
        return;
      }
      this.load(target);
    },
    clickSeat(i) {
      const r = Math.floor(i / this.cols), c = i % this.cols;
      if (this.sel) {
        const s = this.sel;
        if (s.r === r && s.c === c) { this.sel = null; return; }
        this.pushUndo();
        const tmp = this.grid[s.r][s.c];
        this.grid[s.r][s.c] = this.grid[r][c];
        this.grid[r][c] = tmp;
        this.sel = null;
        this.dirty = true;
      } else {
        this.sel = { r, c };
      }
    },
    dblSeat(i) {
      const r = Math.floor(i / this.cols), c = i % this.cols;
      if (this.grid[r][c]) {
        this.pushUndo();
        this.grid[r][c] = "";
        this.dirty = true;
      }
      this.sel = null;
    },
    pickUnseated(id) {
      if (!this.sel) { toast("先点击一个空座位，再点学生姓名", false); return; }
      this.pushUndo();
      this.grid[this.sel.r][this.sel.c] = id;
      this.dirty = true;
      this.sel = null;
    },
    addRow() {
      this.pushUndo();
      this.grid.push(Array(this.cols).fill(""));
      this.rows++;
      this.syncSizeInputs();
      this.dirty = true;
    },
    delRow() {
      if (this.rows <= 1) return;
      const leaving = this.grid[this.rows - 1].filter(Boolean).length;
      if (!confirm("删除最后一排？" + (leaving ? "该排 " + leaving + " 名学生将回到未排座列表。" : ""))) return;
      this.pushUndo();
      this.grid.pop();
      this.rows--;
      this.syncSizeInputs();
      this.sel = null;
      this.dirty = true;
    },
    addCol() {
      this.pushUndo();
      this.grid.forEach((r) => r.push(""));
      this.cols++;
      this.syncSizeInputs();
      this.dirty = true;
    },
    delCol() {
      if (this.cols <= 1) return;
      let leaving = 0;
      this.grid.forEach((r) => { if (r[this.cols - 1]) leaving++; });
      if (!confirm("删除最后一列？" + (leaving ? "该列 " + leaving + " 名学生将回到未排座列表。" : ""))) return;
      this.pushUndo();
      this.grid.forEach((r) => r.pop());
      this.cols--;
      this.syncSizeInputs();
      this.sel = null;
      this.dirty = true;
    },
    // ---- 任意位置插排/删排/插列/删列（以选中座位为基准） ----
    insertRowAbove(r) {
      this.pushUndo();
      this.grid.splice(r, 0, Array(this.cols).fill(""));
      this.rows++;
      this.syncSizeInputs();
      this.sel = null;
      this.dirty = true;
    },
    removeRowAt(r) {
      if (this.rows <= 1) { toast("至少保留一排", false); return; }
      const n = this.grid[r].filter(Boolean).length;
      if (!confirm("删除第 " + (r + 1) + " 排？" + (n ? "该排 " + n + " 名学生将回到未排座列表。" : ""))) return;
      this.pushUndo();
      this.grid.splice(r, 1);
      this.rows--;
      this.syncSizeInputs();
      this.sel = null;
      this.dirty = true;
    },
    insertColLeft(c) {
      this.pushUndo();
      this.grid.forEach((row) => row.splice(c, 0, ""));
      this.cols++;
      this.syncSizeInputs();
      this.sel = null;
      this.dirty = true;
    },
    removeColAt(c) {
      if (this.cols <= 1) { toast("至少保留一列", false); return; }
      let n = 0;
      this.grid.forEach((row) => { if (row[c]) n++; });
      if (!confirm("删除第 " + (c + 1) + " 列？" + (n ? "该列 " + n + " 名学生将回到未排座列表。" : ""))) return;
      this.pushUndo();
      this.grid.forEach((row) => row.splice(c, 1));
      this.cols--;
      this.syncSizeInputs();
      this.sel = null;
      this.dirty = true;
    },
    // ---- 一键应用尺寸（增长补空座，缩小移出多余学生） ----
    applySize() {
      const R = Math.max(1, Math.min(15, Math.round(this.rowsInput) || this.rows));
      const C = Math.max(1, Math.min(12, Math.round(this.colsInput) || this.cols));
      if (R === this.rows && C === this.cols) return;
      let leaving = 0;
      for (let r = R; r < this.rows; r++) leaving += this.grid[r].filter(Boolean).length;
      for (let c = C; c < this.cols; c++) {
        for (let r = 0; r < Math.min(this.rows, R); r++) if (this.grid[r][c]) leaving++;
      }
      if (leaving && !confirm("缩小尺寸将移出 " + leaving + " 名学生到未排座列表，确定？")) return;
      this.pushUndo();
      while (this.grid.length < R) this.grid.push(Array(this.cols).fill(""));
      while (this.grid.length > R) this.grid.pop();
      while (this.grid[0].length < C) this.grid.forEach((row) => row.push(""));
      while (this.grid[0].length > C) this.grid.forEach((row) => row.pop());
      this.rows = R;
      this.cols = C;
      this.syncSizeInputs();
      this.sel = null;
      this.dirty = true;
      toast("已调整为 " + R + " 排 × " + C + " 列" + (leaving ? "，" + leaving + " 人移回未排座" : ""));
    },
    fillSeats(ids) {
      this.pushUndo();
      let k = 0;
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          this.grid[r][c] = k < ids.length ? ids[k++] : "";
        }
      }
      this.dirty = true;
    },
    // createScen 用的静默版；按钮入口 autoFill 有覆盖确认
    fillByRoster() { this.fillSeats(this.students.map((s) => s.student_id)); },
    autoFill() {
      if (!confirm("按名单顺序重新排座将覆盖当前安排，确定？")) return;
      this.fillByRoster();
    },
    randomize() {
      if (!confirm("随机打乱全部座位（未排座学生也会填入）？")) return;
      const ids = this.students.map((s) => s.student_id);
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      this.fillSeats(ids);
      if (ids.length > this.rows * this.cols) {
        toast("座位数不足，" + (ids.length - this.rows * this.cols) + " 人未能入座", false);
      }
    },
    clearAll() {
      if (!confirm("清空当前场景全部座位？")) return;
      this.pushUndo();
      this.initGrid(this.rows, this.cols);
      this.dirty = true;
    },
    async createScen() {
      const name = this.newName.trim();
      if (!name) { toast("请填写场景名称", false); return; }
      if (this.scenNames.includes(name)) { toast("场景已存在", false); return; }
      if (this.dirty && !confirm("当前场景有未保存修改，丢弃并创建新场景？")) return;
      this.scenName = name;
      this._loaded = "";
      this.initGrid(6, 8);
      this.fillByRoster();
      this.newOpen = false;
      toast("已创建并按名单顺序排座，调整后记得保存");
    },
    async delScen() {
      if (!this.scenName || !confirm("删除场景「" + this.scenName + "」？不可恢复！")) return;
      try {
        await api.del("/seating/" + encodeURIComponent(this.scenName));
        await refreshBoot();
        this._loaded = "";
        this.scenName = "";
        const names = Object.keys(store.boot.seatings);
        if (names.length) this.load(names[0]);
        else { this.initGrid(6, 8); this.undoStack = []; }
        this.dirty = false;
        toast("场景已删除");
      } catch (e) { toast(e.message, false); }
    },
    async save() {
      if (!this.scenName) return;
      const seats = [];
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          seats.push({ row: r + 1, col: c + 1, student_id: this.grid[r][c] });
        }
      }
      try {
        await api.put("/seating/" + encodeURIComponent(this.scenName), {
          rows: this.rows, cols: this.cols, seats,
        });
        await refreshBoot();
        this._loaded = this.scenName;
        this.dirty = false;
        toast("座位表已保存");
      } catch (e) { toast(e.message, false); }
    },
    async exportPng() {
      const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const cellW = 86, cellH = 56, pad = 16, top = 84;
      const w = this.cols * cellW + (this.cols - 1) * 8 + pad * 2;
      const h = this.rows * cellH + (this.rows - 1) * 8 + pad + top;
      const cls = store.boot?.config?.class_name ?? "";
      let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h +
        '" viewBox="0 0 ' + w + " " + h +
        '" font-family="system-ui,\'PingFang SC\',\'Microsoft YaHei\',sans-serif">';
      s += '<rect width="' + w + '" height="' + h + '" fill="#f7f9fc"/>';
      s += '<text x="' + w / 2 + '" y="32" text-anchor="middle" font-size="18" font-weight="bold" fill="#1f2937">' +
        esc(cls + " · " + this.scenName) + "</text>";
      s += '<rect x="' + (w / 2 - 88) + '" y="44" width="176" height="26" rx="13" fill="#1e293b"/>' +
        '<text x="' + w / 2 + '" y="61" text-anchor="middle" font-size="13" fill="#fff" letter-spacing="4">讲 台</text>';
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const id = this.grid[r][c];
          const x = pad + c * (cellW + 8), y = top + r * (cellH + 8);
          if (id) {
            const name = this.byId[id] ? this.byId[id].name : "？";
            s += '<rect x="' + x + '" y="' + y + '" width="' + cellW + '" height="' + cellH +
              '" rx="8" fill="#ffffff" stroke="#c9d4e4"/>';
            s += '<text x="' + (x + cellW / 2) + '" y="' + (y + cellH / 2 + 5) +
              '" text-anchor="middle" font-size="14" fill="#1f2937">' +
              esc(name.length > 4 ? name.slice(0, 4) : name) + "</text>";
          } else {
            s += '<rect x="' + x + '" y="' + y + '" width="' + cellW + '" height="' + cellH +
              '" rx="8" fill="#f2f5fa" stroke="#dbe2ec" stroke-dasharray="4 3"/>';
          }
        }
      }
      s += "</svg>";
      try {
        const blob = new Blob([s], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        const canvas = document.createElement("canvas");
        canvas.width = w * 2;
        canvas.height = h * 2;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#f7f9fc";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((b) => {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(b);
          a.download = this.scenName + "-" + todayStr() + ".png";
          a.click();
        }, "image/png");
        toast("已导出 PNG");
      } catch (e) {
        toast("导出失败：" + e.message, false);
      }
    },
  },
  template: `
<div>
  <div class="page-head">
    <h1>座位表</h1>
    <div class="row">
      <select v-model="scenName" @change="switchScen" style="min-width:150px">
        <option value="" disabled>选择场景…</option>
        <option v-for="n in scenOptions" :key="n" :value="n">{{ n }}</option>
      </select>
      <button class="btn-ghost" @click="newOpen = !newOpen">＋ 新场景</button>
      <button class="btn" :disabled="!scenName || !dirty" @click="save">💾 保存</button>
      <button class="btn-ghost" :disabled="!scenName" @click="exportPng">🖼 导出图片</button>
    </div>
  </div>

  <div class="card" v-if="newOpen">
    <div class="row">
      <label>场景名称 <input type="text" v-model="newName" placeholder="如：考试座次、家长会"></label>
      <button class="btn" @click="createScen">创建（自动按名单顺序排座）</button>
    </div>
  </div>

  <template v-if="scenName">
    <div class="card">
      <div class="row">
        <button class="btn-ghost" @click="addRow">＋一排</button>
        <button class="btn-ghost" @click="delRow">－一排</button>
        <button class="btn-ghost" @click="addCol">＋一列</button>
        <button class="btn-ghost" @click="delCol">－一列</button>
        <label class="row" style="gap:4px">尺寸
          <input type="number" v-model.number="rowsInput" min="1" max="15" style="width:52px"> 排 ×
          <input type="number" v-model.number="colsInput" min="1" max="12" style="width:52px"> 列
        </label>
        <button class="btn-ghost" @click="applySize">应用</button>
        <span class="hint">{{ rows }} 排 × {{ cols }} 列（{{ rows * cols }} 座，未排座 {{ unseated.length }} 人）</span>
        <span class="grow"></span>
        <button class="btn-ghost" @click="autoFill">📋 按名单顺序排</button>
        <button class="btn-ghost" @click="randomize">🎲 随机排座</button>
        <button class="btn-ghost" :disabled="!undoStack.length" @click="undo">↩ 撤销</button>
        <button class="btn-danger" @click="clearAll">清空</button>
        <button class="btn-danger" @click="delScen">删除场景</button>
      </div>
      <div class="row" v-if="sel" style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--line)">
        <span class="hint">以 <b>第 {{ sel.r + 1 }} 排 · 第 {{ sel.c + 1 }} 列</b> 为基准：</span>
        <button class="btn-ghost" @click="insertRowAbove(sel.r)">⬆ 上方插入一排</button>
        <button class="btn-ghost" v-if="rows > 1" @click="removeRowAt(sel.r)">🗑 删除该排</button>
        <button class="btn-ghost" @click="insertColLeft(sel.c)">⬅ 左侧插入一列</button>
        <button class="btn-ghost" v-if="cols > 1" @click="removeColAt(sel.c)">🗑 删除该列</button>
      </div>
      <p class="hint">操作：<b>单击</b>两个座位 → 交换；单击座位再点右侧学生 → 放入；<b>双击</b>有人的座位 → 移出。选中座位后可在上方增删中间的排/列（开过道）。</p>
    </div>

    <div class="seat-layout">
      <div class="seat-main">
        <div class="podium">讲 台</div>
        <div class="seat-grid" :style="{ gridTemplateColumns: 'repeat(' + cols + ', 86px)' }">
          <div v-for="(cell, i) in flatCells" :key="i"
               class="seat" :class="{ sel: selIdx === i, empty: !cell }"
               @click="clickSeat(i)" @dblclick="dblSeat(i)">
            <span v-if="cell">{{ byId[cell] ? byId[cell].name : "？" }}</span>
            <span v-else>空</span>
          </div>
        </div>
      </div>
      <div class="seat-side card" style="margin:0">
        <h2 style="font-size:15px">未排座学生（{{ unseated.length }}）</h2>
        <div>
          <span v-for="s in unseated" :key="s.student_id" class="chip chip-pick"
                @click="pickUnseated(s.student_id)">{{ s.name }}</span>
          <span v-if="!unseated.length" class="hint">全部已入座 🎉</span>
        </div>
        <p class="hint" v-if="sel" style="margin-top:10px">
          已选中 <b>第 {{ sel.r + 1 }} 排 第 {{ sel.c + 1 }} 列</b>：点学生放入，或点另一座位交换
        </p>
      </div>
    </div>
    <p class="hint" v-if="dirty" style="margin-top:10px">有未保存的修改</p>
  </template>

  <div class="card" v-else>
    <h2>还没有座位场景</h2>
    <p class="hint">点击右上角「＋ 新场景」创建，会自动按名单顺序排座，然后自由调整。可建多个场景（日常 / 考试 / 家长会）。</p>
  </div>
</div>`,
};

const Remarks = {
  data: () => ({
    store,
    list: [],
    dirty: false,
    ready: false,
    saveTimer: null,
    filterStudent: "",
    filterCategory: "",
  }),
  computed: {
    students() { return store.boot?.students ?? []; },
    categories() { return ["评语", "表扬", "谈话", "事件"]; },
    filteredList() {
      return this.list.filter((r) =>
        (!this.filterStudent || r.student_id === this.filterStudent) &&
        (!this.filterCategory || r.category === this.filterCategory));
    },
  },
  watch: {
    // 与名单页一致：防抖自动保存
    list: {
      deep: true,
      handler() {
        if (!this.ready) return;
        this.dirty = true;
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.save(true), 900);
      },
    },
  },
  async created() {
    if (!store.boot) await refreshBoot();
    this.list = clone(store.boot?.remarks ?? []);
    this.$nextTick(() => (this.ready = true));
  },
  methods: {
    studentName(id) {
      const s = (store.boot?.students ?? []).find((x) => x.student_id === id);
      return s ? s.name : "（已删除学生）";
    },
    // 顺手把这条记录转成个人积分：表扬 +2、谈话 -1，记录内容作为原因
    async addPoint(r, delta) {
      const pts = [...(store.boot?.points ?? []), {
        date: r.date || todayStr(),
        student_id: r.student_id,
        delta,
        reason: r.content.trim(),
      }];
      try {
        await api.put("/points", { points: pts });
        await refreshBoot();
        toast("已为 " + this.studentName(r.student_id) + " 记 " + (delta > 0 ? "+" + delta : delta) + " 分（积分页可调整）");
      } catch (e) { toast(e.message, false); }
    },
    add() {
      this.list.push({ date: todayStr(), student_id: "", category: "评语", content: "" });
    },
    del(r) {
      const i = this.list.indexOf(r);
      if (i >= 0 && confirm("删除这条记录？")) this.list.splice(i, 1);
    },
    async save(silent = false) {
      const snapshot = JSON.stringify(this.list);
      const clean = this.list.filter((r) => r.content.trim());
      try {
        await api.put("/remarks", { remarks: clean });
        await refreshBoot();
        if (JSON.stringify(this.list) === snapshot) this.dirty = false;
        if (!silent) toast("记录已保存" + (this.list.length - clean.length ? "（空白记录已忽略）" : ""));
      } catch (e) { toast(e.message, false); }
    },
  },
  template: `
<div>
  <div class="page-head">
    <h1>文字记录 <span class="count">{{ list.length }} 条</span></h1>
    <div class="row">
      <button class="btn-ghost" @click="add">＋ 添加记录</button>
      <button class="btn" :disabled="!dirty" @click="save">💾 保存</button>
    </div>
  </div>
  <p class="hint" style="margin:-8px 0 12px">评语、谈话、表扬、事件——保存在本地，仅老师可见（个人档案视图规划中）。修改会自动保存；「表扬 / 谈话」记录可一键 🌟 转成个人积分。</p>
  <div class="row" style="margin:-4px 0 12px">
    <select v-model="filterStudent" style="min-width:140px">
      <option value="">全部学生</option>
      <option v-for="s in students" :key="s.student_id" :value="s.student_id">{{ s.name }}（{{ s.student_id }}）</option>
    </select>
    <select v-model="filterCategory" style="min-width:110px">
      <option value="">全部类别</option>
      <option v-for="c in categories" :key="c">{{ c }}</option>
    </select>
    <span class="hint">显示 {{ filteredList.length }} / {{ list.length }} 条</span>
  </div>
  <table class="tbl">
    <thead><tr><th style="width:130px">日期</th><th style="width:140px">学生</th><th style="width:100px">类别</th><th>内容</th><th style="width:130px"></th></tr></thead>
    <tbody>
      <tr v-for="r in filteredList" :key="list.indexOf(r)">
        <td><input type="date" v-model="r.date" @change="dirty = true"></td>
        <td>
          <select v-model="r.student_id" @change="dirty = true">
            <option value="">（班级）</option>
            <option v-for="s in students" :key="s.student_id" :value="s.student_id">{{ s.name }}（{{ s.student_id }}）</option>
          </select>
        </td>
        <td>
          <select v-model="r.category" @change="dirty = true">
            <option v-for="c in categories" :key="c">{{ c }}</option>
          </select>
        </td>
        <td><input type="text" v-model="r.content" @input="dirty = true"></td>
        <td>
          <button v-if="r.student_id && r.category === '表扬'" class="link" @click="addPoint(r, 2)" title="记入个人积分 +2">🌟+2</button>
          <button v-if="r.student_id && r.category === '谈话'" class="link" @click="addPoint(r, -1)" title="记入个人积分 -1">🌟-1</button>
          <button class="link danger" @click="del(r)">删除</button>
        </td>
      </tr>
    </tbody>
  </table>
</div>`,
};

// 个人积分：加分/扣分流水（时间 + 分值 + 原因），按月汇总排行
const Points = {
  data: () => ({
    store,
    list: [], // [{date, student_id, delta, reason}]
    dirty: false,
    ready: false,
    saveTimer: null,
    entry: { date: todayStr(), student_id: "", delta: 1, reason: "" },
    filterStudent: "",
    filterMonth: "",
    filterType: "",
    month: todayStr().slice(0, 7), // 月度汇总选中的月份，"" = 全部
    aggView: "student", // 月度汇总维度：student | group
  }),
  computed: {
    students() { return store.boot?.students ?? []; },
    sortedStudents() { return [...this.students].sort(compareById); },
    months() {
      const set = new Set(
        this.list.map((r) => (r.date || "").slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)),
      );
      set.add(todayStr().slice(0, 7)); // 当月即使还没有记录也出现在选项里
      return [...set].sort().reverse();
    },
    filteredList() {
      return this.list.filter((r) =>
        (!this.filterStudent || r.student_id === this.filterStudent) &&
        (!this.filterMonth || (r.date || "").slice(0, 7) === this.filterMonth) &&
        (!this.filterType || (this.filterType === "add" ? r.delta > 0 : r.delta < 0)));
    },
    // 历史按日期倒序展示（同日保持录入顺序）
    historyList() {
      return [...this.filteredList].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    },
    // 月度汇总：每人 加分小计/扣分小计/净得分，净分降序（并列按学号）
    monthRows() {
      const agg = new Map();
      for (const r of this.list) {
        if (this.month && (r.date || "").slice(0, 7) !== this.month) continue;
        if (!r.student_id || !Number.isFinite(r.delta)) continue;
        const a = agg.get(r.student_id) ?? { add: 0, sub: 0 };
        if (r.delta > 0) a.add += r.delta;
        else a.sub += r.delta;
        agg.set(r.student_id, a);
      }
      return this.students
        .slice()
        .sort(compareById)
        .map((s) => {
          const a = agg.get(s.student_id) ?? { add: 0, sub: 0 };
          return { id: s.student_id, name: s.name, add: a.add, sub: a.sub, net: a.add + a.sub };
        })
        .sort((a, b) => b.net - a.net || b.add - a.add);
    },
    monthTotal() { return this.monthRows.reduce((a, r) => a + r.net, 0); },
    groups() { return store.boot?.groups ?? []; },
    // 按小组聚合：组内成员的个人净得分求和（组榜 = 成员榜之和）
    groupRows() {
      const gidOf = {}, sizeOf = {};
      for (const s of this.students) {
        gidOf[s.student_id] = s.group_id;
        if (s.group_id) sizeOf[s.group_id] = (sizeOf[s.group_id] ?? 0) + 1;
      }
      const agg = new Map();
      for (const r of this.list) {
        if (this.month && (r.date || "").slice(0, 7) !== this.month) continue;
        const gid = gidOf[r.student_id];
        if (!gid) continue;
        const a = agg.get(gid) ?? { add: 0, sub: 0, members: new Set() };
        if (r.delta > 0) a.add += r.delta;
        else a.sub += r.delta;
        a.members.add(r.student_id);
        agg.set(gid, a);
      }
      return this.groups
        .map((g) => {
          const a = agg.get(g.group_id) ?? { add: 0, sub: 0, members: new Set() };
          return {
            id: g.group_id, name: g.name,
            add: a.add, sub: a.sub, net: a.add + a.sub,
            scored: a.members.size, total: sizeOf[g.group_id] ?? 0,
          };
        })
        .sort((a, b) => b.net - a.net || b.add - a.add);
    },
    groupTotal() { return this.groupRows.reduce((a, r) => a + r.net, 0); },
    aggTotal() { return this.aggView === "group" ? this.groupTotal : this.monthTotal; },
    // 历史里出现过的原因按频次排序，供输入框联想
    reasonSuggestions() {
      const counts = new Map();
      for (const r of this.list) if (r.reason) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([r]) => r);
    },
  },
  watch: {
    // 与名单/文字记录一致：防抖自动保存
    list: {
      deep: true,
      handler() {
        if (!this.ready) return;
        this.dirty = true;
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.save(true), 900);
      },
    },
  },
  async created() {
    if (!store.boot) await refreshBoot();
    this.list = clone(store.boot?.points ?? []);
    this.$nextTick(() => (this.ready = true));
  },
  methods: {
    rankMark(i, net) { return i < 3 && net > 0 ? ["🥇", "🥈", "🥉"][i] : String(i + 1); },
    monthLabel(m) {
      if (!m) return "全部月份";
      return m.slice(0, 4) + " 年 " + Number(m.slice(5, 7)) + " 月";
    },
    studentName(id) {
      const s = (store.boot?.students ?? []).find((x) => x.student_id === id);
      return s ? s.name : "（已删除学生）";
    },
    quickAdd() {
      const d = Math.round(num(this.entry.delta) ?? 0);
      if (!this.entry.student_id) { toast("请先选择学生", false); return; }
      if (d === 0) { toast("分值不能为 0", false); return; }
      if (!this.entry.reason.trim()) { toast("请填写原因", false); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(this.entry.date)) { toast("日期不正确", false); return; }
      this.list.push({
        date: this.entry.date,
        student_id: this.entry.student_id,
        delta: d,
        reason: this.entry.reason.trim(),
      });
      this.entry.reason = "";
      toast(d > 0 ? "已记加分 +" + d : "已记扣分 " + d);
    },
    del(r) {
      const i = this.list.indexOf(r);
      if (i >= 0 && confirm("删除这条积分记录？")) this.list.splice(i, 1);
    },
    async save(silent = false) {
      const snapshot = JSON.stringify(this.list);
      const clean = this.list.filter((r) =>
        r.student_id && r.date && Number.isFinite(r.delta) && r.delta !== 0);
      try {
        await api.put("/points", { points: clean });
        await refreshBoot();
        if (JSON.stringify(this.list) === snapshot) this.dirty = false;
        if (!silent) toast("积分记录已保存" + (this.list.length - clean.length ? "（不完整记录已忽略）" : ""));
      } catch (e) { toast(e.message, false); }
    },
  },
  template: `
<div>
  <div class="page-head">
    <h1>个人积分 <span class="count">{{ list.length }} 条记录</span></h1>
    <button class="btn" :disabled="!dirty" @click="save">💾 保存</button>
  </div>
  <p class="hint" style="margin:-8px 0 12px">加减分流水：每条含日期、分值、原因；下方按月汇总到每个学生。修改会自动保存。</p>

  <div class="card">
    <div class="row">
      <h2 style="margin:0">月度汇总</h2>
      <div class="seg">
        <button type="button" :class="{ on: aggView === 'student' }" @click="aggView = 'student'">按学生</button>
        <button type="button" :class="{ on: aggView === 'group' }" @click="aggView = 'group'">按小组</button>
      </div>
      <select v-model="month" style="min-width:140px">
        <option value="">全部月份</option>
        <option v-for="m in months" :key="m" :value="m">{{ monthLabel(m) }}</option>
      </select>
      <span class="hint">净得分合计 {{ aggTotal > 0 ? "+" + aggTotal : aggTotal }}</span>
    </div>
    <div style="overflow-x:auto;margin-top:10px">
      <table class="tbl" v-if="aggView === 'student'">
        <thead><tr><th style="width:64px">名次</th><th style="width:140px">学生</th><th style="width:90px">加分</th><th style="width:90px">扣分</th><th style="width:90px">净得分</th></tr></thead>
        <tbody>
          <tr v-for="(r, i) in monthRows" :key="r.id">
            <td class="num-cell">{{ rankMark(i, r.net) }}</td>
            <td>{{ r.name }}<span class="muted" style="font-size:12px">　{{ r.id }}</span></td>
            <td class="num-cell pt-pos">{{ r.add || "—" }}</td>
            <td class="num-cell pt-neg">{{ r.sub ? "-" + r.sub : "—" }}</td>
            <td class="num-cell"><b :class="r.net > 0 ? 'pt-pos' : r.net < 0 ? 'pt-neg' : ''">{{ r.net > 0 ? "+" + r.net : r.net }}</b></td>
          </tr>
        </tbody>
      </table>
      <table class="tbl" v-else>
        <thead><tr><th style="width:64px">名次</th><th>小组</th><th style="width:110px">有记录</th><th style="width:90px">加分</th><th style="width:90px">扣分</th><th style="width:90px">净得分</th></tr></thead>
        <tbody>
          <tr v-for="(r, i) in groupRows" :key="r.id">
            <td class="num-cell">{{ rankMark(i, r.net) }}</td>
            <td>{{ r.name }}<span class="muted" style="font-size:12px">　{{ r.id }}</span></td>
            <td class="num-cell">{{ r.scored }} / {{ r.total }} 人</td>
            <td class="num-cell pt-pos">{{ r.add || "—" }}</td>
            <td class="num-cell pt-neg">{{ r.sub ? "-" + r.sub : "—" }}</td>
            <td class="num-cell"><b :class="r.net > 0 ? 'pt-pos' : r.net < 0 ? 'pt-neg' : ''">{{ r.net > 0 ? "+" + r.net : r.net }}</b></td>
          </tr>
          <tr v-if="!groupRows.length"><td colspan="6" class="hint">还没有小组，到「小组管理」建组，或导入名单时自动创建。</td></tr>
        </tbody>
      </table>
    </div>
    <p class="hint" style="margin:8px 0 0">按净得分排名，并列时加分多者在前；{{ aggView === "group" ? "小组得分为组内成员净得分之和，括号内为有积分记录的人数。" : "0 分学生也列出，便于整体掌握。" }}</p>
  </div>

  <div class="card">
    <h2>记一笔</h2>
    <div class="row">
      <select v-model="entry.student_id" style="min-width:150px">
        <option value="" disabled>选择学生…</option>
        <option v-for="s in sortedStudents" :key="s.student_id" :value="s.student_id">{{ s.name }}（{{ s.student_id }}）</option>
      </select>
      <input type="number" v-model.number="entry.delta" step="1" style="width:78px" title="正数加分，负数扣分">
      <button class="btn-ghost" @click="entry.delta = 2">+2</button>
      <button class="btn-ghost" @click="entry.delta = 3">+3</button>
      <button class="btn-ghost" @click="entry.delta = 5">+5</button>
      <button class="btn-ghost" @click="entry.delta = -1">-1</button>
      <button class="btn-ghost" @click="entry.delta = -2">-2</button>
      <input type="date" v-model="entry.date" style="width:150px">
      <input type="text" v-model="entry.reason" list="point-reasons" placeholder="原因，如：课堂发言积极"
        style="flex:1;min-width:180px" @keydown.enter="quickAdd">
      <button class="btn" @click="quickAdd">➕ 记录</button>
    </div>
    <datalist id="point-reasons">
      <option v-for="r in reasonSuggestions" :key="r" :value="r"></option>
    </datalist>
    <p class="hint" style="margin:10px 0 0">分值正数加分、负数扣分，可用快捷按钮填入；日期默认今天，可补记往日。原因输入框会联想历史原因。</p>
  </div>

  <div class="row" style="margin:-4px 0 12px">
    <select v-model="filterStudent" style="min-width:140px">
      <option value="">全部学生</option>
      <option v-for="s in sortedStudents" :key="s.student_id" :value="s.student_id">{{ s.name }}（{{ s.student_id }}）</option>
    </select>
    <select v-model="filterMonth" style="min-width:130px">
      <option value="">全部月份</option>
      <option v-for="m in months" :key="m" :value="m">{{ monthLabel(m) }}</option>
    </select>
    <select v-model="filterType" style="min-width:110px">
      <option value="">加分和扣分</option>
      <option value="add">仅加分</option>
      <option value="sub">仅扣分</option>
    </select>
    <span class="hint">显示 {{ historyList.length }} / {{ list.length }} 条</span>
  </div>
  <table class="tbl">
    <thead><tr><th style="width:120px">日期</th><th style="width:150px">学生</th><th style="width:80px">分值</th><th>原因</th><th style="width:56px"></th></tr></thead>
    <tbody>
      <tr v-for="r in historyList" :key="list.indexOf(r)">
        <td class="num-cell">{{ r.date }}</td>
        <td>{{ studentName(r.student_id) }}</td>
        <td :class="r.delta > 0 ? 'num-cell pt-pos' : 'num-cell pt-neg'">{{ r.delta > 0 ? "+" + r.delta : r.delta }}</td>
        <td>{{ r.reason }}</td>
        <td><button class="link danger" @click="del(r)">删除</button></td>
      </tr>
      <tr v-if="!historyList.length"><td colspan="5" class="hint">暂无记录，用上方「记一笔」添加。</td></tr>
    </tbody>
  </table>
</div>`,
};

// 发布范围记忆：上次勾选什么，这次默认还是什么
function loadPublishScope() {
  try {
    const s = JSON.parse(localStorage.getItem("wb-publish-scope") || "");
    if (s && typeof s === "object") {
      return { groups: s.groups === true, scores: s.scores === true, honors: s.honors === true };
    }
  } catch (e) { /* 忽略坏数据 */ }
  return { groups: true, scores: false, honors: false };
}
function savePublishScope(scope) {
  try { localStorage.setItem("wb-publish-scope", JSON.stringify(scope)); } catch (e) { /* 隐私模式等 */ }
}

const Publish = {
  data: () => ({
    store,
    scope: loadPublishScope(),
    pubLog: [],
    bakLog: [],
    busy: "",
    dataUrl: "",
    siteUrl: "",
  }),
  watch: {
    scope: {
      deep: true,
      handler(v) { savePublishScope(v); },
    },
  },
  async created() {
    await refreshBoot();
    this.syncUrls();
  },
  methods: {
    gitClass(r) { return r.isRepo ? (r.dirty ? "badge warn" : "badge pub") : "badge off"; },
    gitText(r) { return !r.isRepo ? "未初始化" : r.dirty ? "有未提交修改" : "干净"; },
    syncUrls() {
      this.dataUrl = store.boot?.git?.data?.originUrl || "";
      this.siteUrl = store.boot?.git?.site?.originUrl || "";
    },
    // 保存/解除远程地址（留空 = 解除）
    async saveRemote(which) {
      const url = (which === "data" ? this.dataUrl : this.siteUrl).trim();
      this.busy = which + "-remote";
      try {
        const r = await api.put("/repo/" + which + "/remote", { url });
        toast(r.detail || "已保存");
        await refreshBoot();
        this.syncUrls();
      } catch (e) { toast(e.message, false); }
      this.busy = "";
    },
    // 从云端恢复：data/ 拉数据，site/ 拉已发布站点
    async pullRepo(which) {
      this.busy = which + "-pull";
      try {
        const r = await api.post("/repo/" + which + "/pull", {});
        toast(r.detail || "拉取完成");
        await refreshBoot();
        this.syncUrls();
      } catch (e) { toast(e.message, false); }
      this.busy = "";
    },
    async doPublish() {
      const warns = [];
      if (this.scope.scores) warns.push("成绩查询数据将随站点公开（查询需姓名 + 学号后四位）");
      if (this.scope.honors) warns.push("积分光荣榜将公开（最近一个月积分前 10 名的姓名与得分）");
      const msg = warns.length
        ? "将生成站点并提交。注意：" + warns.join("；") + "，确定继续？"
        : "将生成静态站点并提交到公开仓库，确定发布？";
      if (!confirm(msg)) return;
      savePublishScope(this.scope);
      this.busy = "pub";
      try {
        const r = await api.post("/publish", this.scope);
        this.pubLog = r.log;
        await refreshBoot();
        toast("发布流程完成");
      } catch (e) { this.pubLog = [e.message]; toast(e.message, false); }
      this.busy = "";
    },
    async doBackup() {
      this.busy = "bak";
      try {
        const r = await api.post("/backup", {});
        this.bakLog = r.log;
        await refreshBoot();
        toast("备份完成");
      } catch (e) { this.bakLog = [e.message]; toast(e.message, false); }
      this.busy = "";
    },
    async openPreview() {
      try {
        const r = await fetch("/preview/index.html");
        if (!r.ok) {
          toast("还没有发布过，请先「生成站点并发布」", false);
          return;
        }
      } catch (e) { /* 服务器异常时也允许尝试打开 */ }
      window.open("/preview/index.html", "_blank");
    },
  },
  template: `
<div>
  <div class="page-head"><h1>发布中心</h1></div>

  <div class="card">
    <h2>发布范围</h2>
    <p><label style="cursor:pointer"><input type="checkbox" disabled checked> 📰 班级日志（仅「公开」标记的篇目）</label></p>
    <p><label style="cursor:pointer"><input type="checkbox" v-model="scope.groups"> 👥 小组风采（各组成员与组长）</label></p>
    <p>
      <label style="cursor:pointer"><input type="checkbox" v-model="scope.honors"> 🌟 积分光荣榜（最近一个月积分前 10 名的姓名与得分）</label>
    </p>
    <p>
      <label style="cursor:pointer"><input type="checkbox" v-model="scope.scores"> 📈 个人成绩查询</label>
      <span class="badge warn" v-if="scope.scores">⚠️ 静态站点无鉴权，数据将随站点公开</span>
    </p>
    <div class="row" style="margin-top:14px">
      <button class="btn" :disabled="busy === 'pub'" @click="doPublish">{{ busy === 'pub' ? '发布中…' : '🚀 生成站点并发布' }}</button>
      <button class="btn-ghost" @click="openPreview">🔍 打开学生站预览</button>
      <button class="btn-ghost" :disabled="busy === 'bak'" @click="doBackup">☁️ 备份数据到私有仓库</button>
    </div>
    <p class="hint" style="margin-top:10px">
      发布 = 在本地渲染静态网页 → git 提交到 site/ 仓库 → 推送远程（若已配置）。远程仓库连接 EdgeOne Pages 后，push 即自动部署。
    </p>
  </div>

  <div class="card" v-if="pubLog.length"><h2>发布日志</h2><pre class="logbox">{{ pubLog.join("\\n") }}</pre></div>
  <div class="card" v-if="bakLog.length"><h2>备份日志</h2><pre class="logbox">{{ bakLog.join("\\n") }}</pre></div>

  <div class="card" v-if="store.boot">
    <h2>仓库设置与状态</h2>
    <div class="row" style="margin-bottom:6px">
      <span class="hint" style="width:132px"><b>数据仓库</b>（data/）</span>
      <input type="text" v-model="dataUrl" placeholder="远程仓库地址，留空保存 = 解除远程（建议私有仓库）" style="flex:1;min-width:200px">
      <button class="btn-ghost" :disabled="busy === 'data-remote'" @click="saveRemote('data')">{{ busy === 'data-remote' ? "保存中…" : "💾 保存" }}</button>
      <button class="btn-ghost" :disabled="busy === 'data-pull'" @click="pullRepo('data')">⬇ 拉取云端</button>
    </div>
    <p><span :class="gitClass(store.boot.git.data)">数据仓库（data/）{{ gitText(store.boot.git.data) }}</span>
      <span v-if="store.boot.git.data.lastCommit" class="muted">　上次提交：{{ store.boot.git.data.lastCommit.subject }}</span>
      <span v-if="!store.boot.git.data.remotes.length" class="muted">　（未配置远程）</span>
    </p>
    <div class="row" style="margin:10px 0 6px">
      <span class="hint" style="width:132px"><b>站点仓库</b>（site/）</span>
      <input type="text" v-model="siteUrl" placeholder="远程仓库地址，留空保存 = 解除远程（公开仓库，连 EdgeOne Pages）" style="flex:1;min-width:200px">
      <button class="btn-ghost" :disabled="busy === 'site-remote'" @click="saveRemote('site')">{{ busy === 'site-remote' ? "保存中…" : "💾 保存" }}</button>
      <button class="btn-ghost" :disabled="busy === 'site-pull'" @click="pullRepo('site')">⬇ 拉取云端</button>
    </div>
    <p><span :class="gitClass(store.boot.git.site)">站点仓库（site/）{{ gitText(store.boot.git.site) }}</span>
      <span v-if="store.boot.git.site.lastCommit" class="muted">　上次发布：{{ store.boot.git.site.lastCommit.subject }}</span>
      <span v-if="!store.boot.git.site.remotes.length" class="muted">　（未配置远程）</span>
    </p>
    <p class="hint" style="margin:10px 0 0">
      数据仓库建议用<b>私有</b>仓库（存名单成绩备份）；站点仓库推送到公开仓库后，EdgeOne Pages 自动部署。
      拉取 = 把云端数据 / 已发布站点恢复到本机（换电脑、误清空时用）；本机有未备份的修改时，请先点上方「备份」。
    </p>
  </div>
</div>`,
};

// ---------- 根应用 ----------

const VIEWS = {
  dashboard: Dashboard,
  students: Students,
  groups: Groups,
  seating: Seating,
  scores: Scores,
  remarks: Remarks,
  points: Points,
  journal: Journal,
  publish: Publish,
};

createApp({
  data: () => ({
    store,
    dark: document.documentElement.dataset.theme === "dark",
    revealWipe: false, // 隐藏的数据清空入口：双击侧栏班级名显示
    menus: [
      { key: "dashboard", icon: "🏠", label: "总览" },
      { key: "students", icon: "👥", label: "班级名单" },
      { key: "groups", icon: "🧩", label: "小组管理" },
      { key: "seating", icon: "🪑", label: "座位表" },
      { key: "scores", icon: "📈", label: "成绩管理" },
      { key: "remarks", icon: "📝", label: "文字记录" },
      { key: "points", icon: "⭐", label: "个人积分" },
      { key: "journal", icon: "✍️", label: "班级日志" },
      { key: "publish", icon: "🚀", label: "发布中心" },
    ],
  }),
  computed: {
    viewComp() { return VIEWS[store.route] || Dashboard; },
  },
  methods: {
    toggleTheme() {
      this.dark = !this.dark;
      store.theme = this.dark ? "dark" : "light";
      document.documentElement.dataset.theme = this.dark ? "dark" : "light";
      try { localStorage.setItem("wb-theme", this.dark ? "dark" : "light"); } catch (e) {}
    },
    // 当前视图是否有未保存修改（各视图的 dirty 字段命名不同，逐一探测）
    anyUnsaved() {
      const v = this.$refs.view;
      return !!(v && (v.dirty || v.scoresDirty || v.examsDirty));
    },
    // 隐藏入口的三次确认清空：留档由后端自动完成
    async wipeData() {
      const cancel = () => { this.revealWipe = false; };
      if (!confirm("【确认 1/3】即将清空全部数据：名单、小组、考试与成绩、个人积分、文字记录、班级日志、座位表。\n清空前会自动 git 留档，之后仍可从 git 历史找回。继续吗？")) { cancel(); return; }
      if (!confirm("【确认 2/3】清空后工作台立即恢复为全新状态，页面上看到的数据不会保留（仅 git 留档可找回）。继续吗？")) { cancel(); return; }
      if (!confirm("【确认 3/3】最后确认：真的要清空全部数据吗？")) { cancel(); return; }
      try {
        const r = await api.del("/data");
        await refreshBoot();
        this.revealWipe = false;
        toast("数据已清空（清空前已自动 git 留档）");
        console.log("[清空数据]\n" + (r.log || []).join("\n"));
        // 回总览：避免停留在带未保存编辑的页面，把旧数据又自动保存回去
        location.hash = "#/dashboard";
      } catch (e) { toast("清空失败：" + e.message, false); }
    },
  },
  created() {
    refreshBoot().catch((e) => toast("加载失败：" + e.message, false));
    // 关标签页/刷新时提示；侧栏导航与前进/后退的确认统一在 hashchange 守卫里
    unsavedProbe = () => this.anyUnsaved();
    window.addEventListener("beforeunload", (e) => {
      if (this.anyUnsaved()) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  },
}).mount("#app");
