import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await run("git", args, { cwd: dir, maxBuffer: 16 * 1024 * 1024 });
  return (stdout + stderr).trim();
}

export async function gitClone(url: string, dir: string): Promise<string> {
  const { stdout, stderr } = await run("git", ["clone", url, dir], { maxBuffer: 16 * 1024 * 1024 });
  return (stdout + stderr).trim();
}

export async function gitBranch(dir: string, name: string, create: boolean): Promise<string> {
  return git(dir, create ? ["checkout", "-b", name] : ["checkout", name]);
}

export async function gitCommitAll(dir: string, message: string): Promise<string> {
  await git(dir, ["add", "-A"]);
  try {
    return await git(dir, ["commit", "-m", message]);
  } catch (e) {
    const msg = String(e);
    if (msg.includes("nothing to commit")) return "nothing to commit — working tree clean";
    throw e;
  }
}

export async function gitPush(dir: string, remote = "origin", branch?: string): Promise<string> {
  const br = branch ?? (await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]));
  return git(dir, ["push", "-u", remote, br]);
}

export async function gitHeadSha(dir: string): Promise<string> {
  return git(dir, ["rev-parse", "HEAD"]);
}

export async function gitCurrentBranch(dir: string): Promise<string> {
  return git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
}
