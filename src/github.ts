import { $ } from "bun";
import type { PRResult } from "./types";

interface CreatePRParams {
  workspace: string;
  repoDir: string;
  repoUrl: string;
  branchName: string;
  githubToken: string;
}

// Run shell command in workspace
async function exec(
  cmd: string,
  cwd: string
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  try {
    const result = await $`${{ raw: cmd }}`.cwd(cwd).quiet();
    return {
      success: result.exitCode === 0,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  } catch (error: unknown) {
    const e = error as { stdout?: Buffer; stderr?: Buffer };
    return {
      success: false,
      stdout: e.stdout?.toString() || "",
      stderr: e.stderr?.toString() || String(error),
    };
  }
}

export async function createPullRequest(
  params: CreatePRParams
): Promise<PRResult> {
  const { workspace, repoDir, repoUrl, branchName, githubToken } = params;
  const repoPath = `${workspace}/${repoDir}`;

  // Check if there are commits ahead of origin/main
  const logResult = await exec("git log origin/main..HEAD --oneline", repoPath);

  const hasNewCommits = logResult.success && logResult.stdout.trim().length > 0;

  if (!hasNewCommits) {
    return {
      repoName: repoDir,
      success: false,
      error: "No changes",
    };
  }

  // Push the branch
  const pushResult = await exec(`git push -u origin ${branchName}`, repoPath);

  if (!pushResult.success) {
    return {
      repoName: repoDir,
      success: false,
      error: `Failed to push: ${pushResult.stderr}`,
    };
  }

  // Extract owner/repo from URL
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!match) {
    return {
      repoName: repoDir,
      success: false,
      error: "Could not parse repo URL",
    };
  }
  const [, owner, repo] = match;

  // Create PR via GitHub API
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "Claude-Code-Railway",
      },
      body: JSON.stringify({
        title: branchName,
        head: branchName,
        base: "main",
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    return {
      repoName: repoDir,
      success: false,
      error: `GitHub API error: ${response.status} ${errorText}`,
    };
  }

  const data = (await response.json()) as { html_url: string };

  return {
    repoName: repoDir,
    success: true,
    prUrl: data.html_url,
  };
}
