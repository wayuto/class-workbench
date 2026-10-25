/**
 * 示例数据生成：deno task seed
 * 使用固定随机种子，重复执行结果一致。
 */
import {
  dataDir,
  saveConfig,
  saveGroups,
  saveStudents,
  saveExams,
  saveScores,
  saveRemarks,
  savePoints,
  saveSeating,
  type Exam,
  type Group,
  type Student,
} from "./store.ts";
import { commitAll } from "./gitcmd.ts";
import { saveJournal } from "./journal.ts";

// mulberry32：确定性伪随机
function prng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SURNAMES = "王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭".split("");
const GIVEN = [
  "梓涵", "雨轩", "浩然", "子墨", "欣怡", "嘉懿", "思远", "文博", "俊杰", "梦琪",
  "紫萱", "子睿", "晨曦", "宇轩", "雨桐", "心悦", "昊天", "思彤", "锦程", "安然",
  "若曦", "明轩", "晓彤", "泽宇", "诗涵", "博文", "静怡", "浩宇", "佳琪", "志强",
  "雪晴", "嘉禾", "卓然", "语嫣", "天佑", "慧敏", "鸿飞", "雅静", "俊驰", "雨泽",
  "乐怡", "承宇", "梦瑶", "靖琪", "瑾瑜", "皓轩", "芸熙",
];

const GROUP_NAMES = [
  "鲲鹏组", "启航组", "星辰组", "逐光组", "凌云组", "知行组", "晨曦组", "远山组",
];

const EXAMS: Exam[] = [
  { exam_id: "E01", date: "2026-09-10", title: "开学摸底", type: "测验" },
  { exam_id: "E02", date: "2026-09-25", title: "第一单元测验", type: "测验" },
  { exam_id: "E03", date: "2026-10-15", title: "第二单元测验", type: "测验" },
  { exam_id: "E04", date: "2026-10-20", title: "期中考试", type: "考试" },
  { exam_id: "E05", date: "2026-10-23", title: "作业讲评小测", type: "作业" },
];

const SUBJECTS = ["语文", "数学", "英语", "物理", "化学", "生物", "政治", "历史", "地理"];
// 主科 150 分制，其余 100
const FULLS = Object.fromEntries(
  SUBJECTS.map((s) => [s, ["语文", "数学", "英语"].includes(s) ? 150 : 100]),
);

const JOURNALS: Array<{ date: string; title: string; publish: boolean; content: string }> = [
  {
    date: "2026-10-13",
    title: "秋季运动会",
    publish: true,
    content: `今天是一年一度的秋季运动会，全班同学斗志昂扬。

## 成绩亮点

- **4×100 接力**：我班代表队获得年级第二，棒棒哒！
- **跳远**：两位同学分获三、五名
- 拔河比赛惜败于三班，但大家拼到了最后一秒

## 花絮

> 加油声浪一阵高过一阵，连隔壁班的老师都探出头来。

运动会结束后教室卫生打扫得干干净净，为每位同学点赞。`,
  },
  {
    date: "2026-10-17",
    title: "班会：值日安排与小组调整",
    publish: true,
    content: `本周班会确定了新学期的值日轮换表，并微调了两个小组的成员。

### 值日提醒

1. 每组值日一周，组长负责分工
2. 擦黑板、倒垃圾、扫地三项轮换
3. 周五大扫除全员参与

调整后的小组名单已更新到**小组风采**页面，大家记得查看。`,
  },
  {
    date: "2026-10-20",
    title: "期中考试总结",
    publish: true,
    content: `期中考试顺利结束，九科总分平均较摸底考试**提升了 45 分**，进步明显。

## 数据速览

- 班级总分平均：775 分（满分 1050，主科各 150 分）
- 数学平均分进步最大
- 多名同学总分提升超过 60 分

## 下一步

- 各科讲解卷子后将安排一对一订正
- 成绩可在**成绩查询**页面输入姓名查看，支持按科目切换趋势图

> 一次考试只是一段路的里程碑，重要的是方向和步伐。`,
  },
  {
    date: "2026-10-10",
    title: "（内部）家长沟通备忘",
    publish: false,
    content: `本周与三位家长电话沟通了作业完成情况，要点：

- 张同学家长反馈最近睡眠偏晚，已约定 22:30 前休息
- 李同学数学作业正确率回升，予以表扬
- 下周约王同学家长面谈

*此篇仅本地保存，不对外发布。*`,
  },
];

const REMARK_TEMPLATES: Array<[string, string]> = [
  ["评语", "课堂专注度高，回答问题积极，继续保持。"],
  ["表扬", "主动帮助同学讲解习题，值得点赞。"],
  ["谈话", "近期作业有迟交现象，已沟通，约定每日放学后留 20 分钟补齐。"],
  ["表扬", "值日认真负责，本周卫生流动红旗有他一份功劳。"],
  ["评语", "阅读面广，作文素材丰富，建议加强书写练习。"],
  ["谈话", "与同学的小摩擦已调解，双方握手言和，持续观察。"],
  ["表扬", "运动会接力赛拼尽全力，展现了很好的集体荣誉感。"],
  ["评语", "数学思维活跃，但粗心失分较多，建议养成检查习惯。"],
  ["表扬", "期中考试进步 12 分，兑现了上次谈话定下的目标。"],
  ["评语", "性格沉稳，小组讨论中能提出有价值的观点。"],
  ["谈话", "家长反馈在家使用手机时间偏长，与本人约定使用时长。"],
  ["表扬", "主动承担班级图书角整理工作。"],
];

// 积分规则：[分值, 原因]
const POINT_RULES: Array<[number, string]> = [
  [2, "课堂发言积极"],
  [3, "作业被评为优秀"],
  [2, "主动帮助同学讲解习题"],
  [1, "值日认真负责"],
  [5, "运动会为班级争得名次"],
  [1, "一周作业全交"],
  [-1, "上课迟到"],
  [-2, "作业未按时上交"],
  [-1, "课堂纪律被提醒"],
  [-2, "值日敷衍被扣分"],
];

export async function seedData(): Promise<{
  students: number;
  exams: number;
  journals: number;
  points: number;
}> {
  const rand = prng(20261024);

  // 示例数据会覆盖全部现有数据：先提交留档，误触也能从 git 找回
  await commitAll(dataDir, "生成示例数据前自动备份");

  // ---- 学生 40 人，学号 2026001 起 ----
  const usedNames = new Set<string>();
  const students: Student[] = [];
  while (students.length < 40) {
    const surname = SURNAMES[Math.floor(rand() * SURNAMES.length)];
    const given = GIVEN[Math.floor(rand() * GIVEN.length)];
    const name = surname + given;
    if (usedNames.has(name)) continue;
    usedNames.add(name);
    students.push({
      student_id: `2026${String(students.length + 1).padStart(3, "0")}`,
      name,
      gender: rand() > 0.5 ? "女" : "男",
      group_id: "",
      note: "",
    });
  }
  students.sort((a, b) => (a.student_id < b.student_id ? -1 : 1));

  // ---- 8 个小组，按名单顺序切分 ----
  const groups: Group[] = [];
  const per = Math.ceil(students.length / GROUP_NAMES.length);
  GROUP_NAMES.forEach((name, gi) => {
    const members = students.slice(gi * per, (gi + 1) * per);
    members.forEach((m) => (m.group_id = `G${gi + 1}`));
    groups.push({
      group_id: `G${gi + 1}`,
      name,
      leader_id: members[0]?.student_id ?? "",
    });
  });

  // ---- 成绩：每人整体基础水平 + 科目倾向 + 随考试缓慢进步 + 波动 ----
  const base = students.map(() => 55 + rand() * 30);
  // 文/理科倾向：每个人对不同科目有稳定的喜好差异
  const affinity = students.map(() =>
    Object.fromEntries(SUBJECTS.map((s) => [s, (rand() - 0.5) * 16])),
  );
  for (let ei = 0; ei < EXAMS.length; ei++) {
    const rows = students.map((s, si) => {
      // 三位同学在 E03 缺考（全科空）
      if (ei === 2 && (si === 6 || si === 17 || si === 31)) {
        return { student_id: s.student_id, scores: Object.fromEntries(SUBJECTS.map((x) => [x, null])) };
      }
      const trend = ei * (0.8 + rand() * 1.6);
      const scores: Record<string, number | null> = {};
      for (const sub of SUBJECTS) {
        const noise = (rand() - 0.5) * 12;
        const ratio = Math.max(0.15, Math.min(1,
          (base[si] + affinity[si][sub] + trend * (0.5 + rand()) + noise) / 100));
        scores[sub] = Math.round(ratio * FULLS[sub]);
      }
      return { student_id: s.student_id, scores };
    });
    await saveScores(EXAMS[ei].exam_id, rows, SUBJECTS);
  }

  // ---- 座位表：默认场景，按名单顺序入座（6 排 × 8 列，剩余空座） ----
  const S_ROWS = 6, S_COLS = 8;
  const seatCells: { row: number; col: number; student_id: string }[] = [];
  let seatIdx = 0;
  for (let r = 1; r <= S_ROWS; r++) {
    for (let c = 1; c <= S_COLS; c++) {
      seatCells.push({
        row: r,
        col: c,
        student_id: seatIdx < students.length ? students[seatIdx++].student_id : "",
      });
    }
  }
  await saveSeating("日常座次", { rows: S_ROWS, cols: S_COLS, seats: seatCells });

  // ---- 文字记录 ----
  const remarks = REMARK_TEMPLATES.map(([category, content], i) => ({
    date: `2026-10-${String(8 + (i % 14)).padStart(2, "0")}`,
    student_id: students[(i * 7 + 3) % students.length].student_id,
    category,
    content,
  }));

  // ---- 个人积分流水：横跨 9、10 月，正负都有，按日期排序 ----
  const points = [];
  for (let i = 0; i < 40; i++) {
    const [delta, reason] = POINT_RULES[Math.floor(rand() * POINT_RULES.length)];
    const month = rand() < 0.4 ? "09" : "10";
    const day = 1 + Math.floor(rand() * (month === "09" ? 28 : 24));
    points.push({
      date: `2026-${month}-${String(day).padStart(2, "0")}`,
      student_id: students[Math.floor(rand() * students.length)].student_id,
      delta,
      reason,
    });
  }
  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  await saveConfig({
    class_name: "高一(2)班",
    term: "2026 秋季学期",
    subjects: SUBJECTS,
    subject_full: FULLS,
  });
  await saveStudents(students);
  await saveGroups(groups);
  await saveExams(EXAMS);
  await saveRemarks(remarks);
  await savePoints(points);
  for (const j of JOURNALS) {
    await saveJournal(j.date, { title: j.title, publish: j.publish, content: j.content });
  }

  return {
    students: students.length,
    exams: EXAMS.length,
    journals: JOURNALS.length,
    points: points.length,
  };
}

// 直接运行时执行
if (import.meta.main) {
  const r = await seedData();
  console.log(
    `✅ 示例数据已生成：${r.students} 名学生、${r.exams} 次考试、${r.journals} 篇日志（含 1 篇私有）、${r.points} 条积分记录`,
  );
}
