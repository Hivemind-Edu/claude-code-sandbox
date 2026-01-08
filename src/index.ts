import { getSandbox } from "@cloudflare/sandbox";

const FRONTEND_REPO = "https://github.com/Hivemind-Edu/hivemind-expo";
const BACKEND_REPO = "https://github.com/Hivemind-Edu/hivemind-hono";

interface CmdOutput {
  success: boolean;
  stdout: string;
  stderr: string;
}

const getOutput = (res: CmdOutput) => (res.success ? res.stdout : res.stderr);

interface ExtendedEnv extends Env {
  GITHUB_TOKEN?: string;
}

type SandboxInstance = ReturnType<typeof getSandbox>;

// Throws if command fails
async function run(sandbox: SandboxInstance, cmd: string): Promise<CmdOutput> {
  const result = await sandbox.exec(cmd);
  if (!result.success) {
    throw new Error(`Command failed: ${cmd}\n${result.stderr}`);
  }
  return result;
}

interface PRResult {
  repoName: string;
  success: boolean;
  prUrl?: string;
  error?: string;
}

interface CreatePRParams {
  sandbox: SandboxInstance;
  repoDir: string;
  repoUrl: string;
  branchName: string;
  githubToken: string;
}

async function createPullRequest(params: CreatePRParams): Promise<PRResult> {
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
      error: "No new commits on branch",
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

  // Extract owner/repo from URL (e.g., "https://github.com/Owner/Repo")
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
        "User-Agent": "Cloudflare-Sandbox-Bot",
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

export default {
  async fetch(request: Request, env: ExtendedEnv): Promise<Response> {
    if (request.method === "POST") {
      try {
        const { task } = await request.json<{ task?: string }>();
        if (!task) {
          return new Response("task is required", { status: 400 });
        }

        if (!env.GITHUB_TOKEN) {
          return new Response("GITHUB_TOKEN is required", { status: 400 });
        }

        const branchName = `sandbox/${crypto.randomUUID().slice(0, 8)}`;
        const frontendDir = "hivemind-expo";
        const backendDir = "hivemind-hono";

        // Open sandbox
        const sandbox = getSandbox(
          env.Sandbox,
          crypto.randomUUID().slice(0, 8)
        );

        // Clone both repos with auth
        const addAuth = (url: string) =>
          url.replace(
            "https://github.com/",
            `https://${env.GITHUB_TOKEN}@github.com/`
          );

        await sandbox.gitCheckout(addAuth(FRONTEND_REPO), {
          targetDir: frontendDir,
        });
        await sandbox.gitCheckout(addAuth(BACKEND_REPO), {
          targetDir: backendDir,
        });

        // Create branches in both repos (use subshell to avoid cd persisting)
        await run(
          sandbox,
          `(cd ${frontendDir} && git checkout -b ${branchName})`
        );
        await run(
          sandbox,
          `(cd ${backendDir} && git checkout -b ${branchName})`
        );

        // Configure git user in both repos
        for (const dir of [frontendDir, backendDir]) {
          await run(
            sandbox,
            `(cd ${dir} && git config user.name "Sandbox Bot")`
          );
          await run(
            sandbox,
            `(cd ${dir} && git config user.email "sandbox@cloudflare.com")`
          );
        }

        // Set env vars
        await sandbox.setEnvVars({
          ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
          IS_SANDBOX: "1",
        });

        // Build the system prompt for Claude
        const systemPrompt = `
You are an autonomous developer working on Hivemind, a learning app with a social media-style interface.

## Repositories
- Frontend: ./${frontendDir} (React Native/Expo)
- Backend: ./${backendDir} (Hono API on Bun)

Both repos have READMEs with more details. The frontend calls the backend via REST API with RPC-style endpoints.

## Git Rules
- You are on branch "${branchName}" in both repos. NEVER switch branches.
- You MUST commit your changes before finishing. Use descriptive commit messages.
- The system will automatically push and create PRs after you complete.

## Workflow
1. Read the READMEs to understand the codebase structure
2. Make the necessary changes across frontend and/or backend
3. Install dependencies if needed (bun install)
4. Run linting/formatting (fix any issues)
5. Run tests (fix any failures)
6. Commit your changes with a clear message

## Important
- Do NOT ask clarifying questions. Make your best judgment and proceed.
- Do NOT wait for approval. Complete the entire task autonomously.
- If something is ambiguous, make a reasonable decision and document it in the commit message.
`.trim();

        // Run Claude
        const escapedTask = task.replace(/"/g, '\\"');
        const escapedSystem = systemPrompt.replace(/"/g, '\\"');
        const cmd = `claude --system-prompt "${escapedSystem}" -p "${escapedTask}" --dangerously-skip-permissions`;

        const claudeLogs = getOutput(await sandbox.exec(cmd));

        // Push and create PRs for repos with changes
        const frontendPR = await createPullRequest({
          sandbox,
          repoDir: frontendDir,
          repoUrl: FRONTEND_REPO,
          branchName,
          githubToken: env.GITHUB_TOKEN,
        });
        const backendPR = await createPullRequest({
          sandbox,
          repoDir: backendDir,
          repoUrl: BACKEND_REPO,
          branchName,
          githubToken: env.GITHUB_TOKEN,
        });

        return Response.json({
          branchName,
          claudeLogs,
          frontend: frontendPR,
          backend: backendPR,
        });
      } catch (e) {
        const error = e instanceof Error ? e.message : "Unknown error";
        return new Response(`Error: ${error}`, { status: 500 });
      }
    }
    return new Response("not found");
  },
};

export { Sandbox } from "@cloudflare/sandbox";
