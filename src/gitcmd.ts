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
}

export async function repoInfo(dir: URL): Promise<RepoInfo> {
  const info: RepoInfo = {
    isRepo: await isRepoRoot(dir),
    dirty: false,
    lastCommit: null,
    remotes: [],
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
  return info;
}
