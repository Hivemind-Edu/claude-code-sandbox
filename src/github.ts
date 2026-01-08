import type { SandboxInstance, PRResult } from "./types";

interface CreatePRParams {
  sandbox: SandboxInstance;
  repoDir: string;
  repoUrl: string;
  branchName: string;
  githubToken: string;
}

export async function createPullRequest(
  params: CreatePRParams
): Promise<PRResult> {
  const { sandbox, repoDir, repoUrl, branchName, githubToken } = params;

  // Check if there are commits ahead of origin/main
  const logResult = await sandbox.exec(
    `(cd ${repoDir} && git log origin/main..HEAD --oneline)`
  );

  const hasNewCommits = logResult.success && logResult.stdout.trim().length > 0;

  if (!hasNewCommits) {
    return {
      repoName: repoDir,
      success: false,
      error: "No changes",
    };
  }

  // Push the branch
  const pushResult = await sandbox.exec(
    `(cd ${repoDir} && git push -u origin ${branchName})`
  );

  if (!pushResult.success) {
    return {
      repoName: repoDir,
      success: false,
      error: `Failed to push: ${pushResult.stderr}`,
    };
  }

  // Extract owner/repo from URL
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
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
        "User-Agent": "Hivemind-Claude-Bot",
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
