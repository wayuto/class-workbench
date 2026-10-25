/**
 * git 封装：调用系统 git 命令，复用老师电脑上已配置的凭据。
 * - 提交时通过 -c 注入身份，机器上没有 git 全局配置也能提交
 * - 未配置远程仓库时 push 自动跳过（仅本地提交），给出人话提示
 */

export interface GitResult {
  ok: boolean;
  out: string;
  err: string;
}

export async function git(
  dir: URL,
  ...args: string[]
): Promise<GitResult> {
  try {
    const cmd = new Deno.Command("git", {
      args,
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    });
    const p = await cmd.output();
    const dec = new TextDecoder();
    return {
      ok: p.code === 0,
      out: dec.decode(p.stdout).trim(),
      err: dec.decode(p.stderr).trim(),
    };
  } catch {
    return {
      ok: false,
      out: "",
      err: "未检测到系统 git，请先安装 git 并确保它在 PATH 中",
    };
  }
}

/**
 * 目录自身是否为 git 仓库根（存在 .git，兼容 worktree 的 .git 文件）。
 * 不能用 rev-parse --is-inside-work-tree：父级是仓库时它也返回 true，
 * 会导致数据/站点被提交进上层仓库，甚至随上层仓库的远程推送出去。
 */
export async function isRepoRoot(dir: URL): Promise<boolean> {
  try {
    await Deno.stat(new URL(".git", dir));
    return true;
  } catch {
    return false;
  }
}

/** 确保目录自身是一个 git 仓库（不是则 init，即使父级已是仓库） */
export async function ensureRepo(dir: URL): Promise<boolean> {
  if (await isRepoRoot(dir)) return true;
  return (await git(dir, "init")).ok;
}

export interface CommitResult {
  committed: boolean;
  hash: string;
  detail: string;
}

/** add -A + commit；无变更时返回 committed:false */
export async function commitAll(
  dir: URL,
  message: string,
): Promise<CommitResult> {
  await ensureRepo(dir);
  await git(dir, "add", "-A");
  const noChange = await git(dir, "diff", "--cached", "--quiet");
  if (noChange.ok) {
    return { committed: false, hash: "", detail: "没有需要提交的变更" };
  }
  const r = await git(
    dir,
    "-c",
    "user.name=班级工作台",
    "-c",
    "user.email=workbench@localhost",
    "commit",
    "-m",
    message,
  );
  if (!r.ok) {
    return { committed: false, hash: "", detail: r.err || r.out || "提交失败" };
  }
  const hashR = await git(dir, "rev-parse", "--short", "HEAD");
  return {
    committed: true,
    hash: hashR.out,
    detail: `已提交 ${hashR.out}`,
  };
}

export interface PushResult {
  pushed: boolean;
  detail: string;
}

/** 有远程才 push；push 失败给出可读原因 */
export async function pushIfRemote(dir: URL): Promise<PushResult> {
  const remotesR = await git(dir, "remote");
  if (!remotesR.ok) {
    return { pushed: false, detail: remotesR.err };
  }
  const remotes = remotesR.out.split("\n").map((s) => s.trim()).filter(Boolean);
  if (remotes.length === 0) {
    return {
      pushed: false,
      detail: "未配置远程仓库，本次仅本地提交（在仓库目录执行 git remote add origin <仓库地址> 后即可自动推送）",
    };
  }
  const r = await git(dir, "push");
  if (r.ok) return { pushed: true, detail: `已推送到 ${remotes.join(", ")}` };
  return {
    pushed: false,
    detail: `推送失败：${r.err || "未知错误"}（本地提交已保留，网络恢复后重试即可）`,
  };
}

export interface RepoInfo {
  isRepo: boolean;
  dirty: boolean;
  lastCommit: { subject: string; time: string } | null;
  remotes: string[];
  /** origin 远程地址（未设置则为 null），供发布中心回填输入框 */
  originUrl: string | null;
}

export async function repoInfo(dir: URL): Promise<RepoInfo> {
  const info: RepoInfo = {
    isRepo: await isRepoRoot(dir),
    dirty: false,
    lastCommit: null,
    remotes: [],
    originUrl: null,
  };
  if (!info.isRepo) return info;

  const status = await git(dir, "status", "--porcelain");
  info.dirty = status.ok && status.out.length > 0;

  const log = await git(dir, "log", "-1", "--format=%s%x00%ci");
  if (log.ok && log.out) {
    const [subject, time] = log.out.split("\x00");
    info.lastCommit = { subject: subject ?? "", time: time ?? "" };
  }

  const remotesR = await git(dir, "remote");
  if (remotesR.ok) {
    info.remotes = remotesR.out.split("\n").map((s) => s.trim()).filter(Boolean);
  }
  const urlR = await git(dir, "remote", "get-url", "origin");
  info.originUrl = urlR.ok ? urlR.out.trim() : null;
  return info;
}

/** 从远程拉取同步（换电脑 / 恢复数据用）：
 *  fetch → 远程默认分支 → 本地无提交则直接检出，有提交则快进合并（不自动覆盖本地修改） */
export async function pullRepo(
  dir: URL,
): Promise<{ ok: boolean; detail: string; changed: boolean }> {
  const remotesR = await git(dir, "remote");
  const remotes = remotesR.ok
    ? remotesR.out.split("\n").map((s) => s.trim()).filter(Boolean)
    : [];
  if (!remotes.length) {
    return { ok: false, changed: false, detail: "尚未设置远程仓库地址，请先在发布中心保存" };
  }
  const remote = remotes[0];
  const fetch = await git(dir, "fetch", "--prune", remote);
  if (!fetch.ok) {
    return {
      ok: false,
      changed: false,
      detail: `拉取失败：无法连接远程（${fetch.err || fetch.out || "网络或地址问题"}）`,
    };
  }
  // 远程默认分支：优先 HEAD 符号引用，退化到 main / master，再退化到第一个分支
  const symref = await git(dir, "ls-remote", "--symref", remote, "HEAD");
  let branch = symref.out.match(/ref: refs\/heads\/(\S+)/)?.[1] ?? "";
  if (!branch) {
    const heads = await git(dir, "branch", "-r", "--format=%(refname:short)");
    const names = heads.out.split("\n").map((s) => s.trim())
      .filter((s) => s.startsWith(remote + "/"));
    branch = (names.find((n) => /\/(main|master)$/.test(n)) ?? names[0])
      ?.slice(remote.length + 1) ?? "";
  }
  if (!branch) return { ok: false, changed: false, detail: "远程仓库还没有任何提交" };

  const head = await git(dir, "rev-parse", "--verify", "--quiet", "HEAD");
  if (!head.ok) {
    // 本地还没有任何提交（全新仓库）：直接检出远程分支
    const co = await git(dir, "checkout", "-B", branch, `${remote}/${branch}`);
    if (!co.ok) return { ok: false, changed: false, detail: `拉取失败：${co.err || co.out}` };
    return { ok: true, changed: true, detail: `已从云端拉取数据（${branch} 分支）` };
  }
  const merge = await git(dir, "merge", "--ff-only", `${remote}/${branch}`);
  if (merge.ok) {
    const upToDate = /already up to date/i.test(merge.out);
    return {
      ok: true,
      changed: !upToDate,
      detail: upToDate ? "云端没有新数据，本地已是最新" : "已拉取云端新数据",
    };
  }
  return {
    ok: false,
    changed: false,
    detail: `拉取失败：本地与云端历史无法快进合并（${(merge.err || merge.out).split("\n")[0]}）。建议先点「备份」推送本地修改；若确要放弃本机状态，需手动处理。`,
  };
}
