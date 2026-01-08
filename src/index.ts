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
  SLACK_SIGNING_SECRET?: string;
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

// Post result back to Slack
async function postToSlack(responseUrl: string, text: string) {
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: "in_channel", text }),
  });
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

// Main task runner
async function runTask(task: string, env: ExtendedEnv) {
  if (!env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is required");
  }

  const branchName = `sandbox/${crypto.randomUUID().slice(0, 8)}`;
  const frontendDir = "hivemind-expo";
  const backendDir = "hivemind-hono";

  const sandbox = getSandbox(env.Sandbox, crypto.randomUUID().slice(0, 8));

  // Clone both repos with auth
  const addAuth = (url: string) =>
    url.replace(
      "https://github.com/",
      `https://${env.GITHUB_TOKEN}@github.com/`
    );

  await sandbox.gitCheckout(addAuth(FRONTEND_REPO), { targetDir: frontendDir });
  await sandbox.gitCheckout(addAuth(BACKEND_REPO), { targetDir: backendDir });

  // Create branches
  await run(sandbox, `(cd ${frontendDir} && git checkout -b ${branchName})`);
  await run(sandbox, `(cd ${backendDir} && git checkout -b ${branchName})`);

  // Configure git user
  for (const dir of [frontendDir, backendDir]) {
    await run(sandbox, `(cd ${dir} && git config user.name "Sandbox Bot")`);
    await run(
      sandbox,
      `(cd ${dir} && git config user.email "sandbox@cloudflare.com")`
    );
  }

  await sandbox.setEnvVars({
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    IS_SANDBOX: "1",
  });

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

  const escapedTask = task.replace(/"/g, '\\"');
  const escapedSystem = systemPrompt.replace(/"/g, '\\"');
  const cmd = `claude --system-prompt "${escapedSystem}" -p "${escapedTask}" --dangerously-skip-permissions`;

  const claudeLogs = getOutput(await sandbox.exec(cmd));

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

  return { branchName, claudeLogs, frontend: frontendPR, backend: backendPR };
}

// Format result for Slack
function formatSlackMessage(result: Awaited<ReturnType<typeof runTask>>) {
  const lines = [`*Branch:* \`${result.branchName}\``];

  if (result.frontend.success) {
    lines.push(`*Frontend PR:* ${result.frontend.prUrl}`);
  } else {
    lines.push(`*Frontend:* ${result.frontend.error}`);
  }

  if (result.backend.success) {
    lines.push(`*Backend PR:* ${result.backend.prUrl}`);
  } else {
    lines.push(`*Backend:* ${result.backend.error}`);
  }

  return lines.join("\n");
}

export default {
  async fetch(
    request: Request,
    env: ExtendedEnv,
    ctx: ExecutionContext
  ): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Send a POST request", { status: 405 });
    }

    const contentType = request.headers.get("content-type") || "";

    // Slack slash command (form-urlencoded)
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await request.formData();
      const task = formData.get("text") as string;
      const responseUrl = formData.get("response_url") as string;

      if (!task) {
        return new Response("Usage: /claude <task description>", {
          status: 200,
        });
      }

      // Run task in background, respond immediately
      ctx.waitUntil(
        runTask(task, env)
          .then((result) =>
            postToSlack(responseUrl, formatSlackMessage(result))
          )
          .catch((e) => postToSlack(responseUrl, `❌ Error: ${e.message}`))
      );

      return new Response(
        `🚀 Working on: ${task}\n\nI'll post the results here when done.`
      );
    }

    // JSON API
    try {
      const { task } = await request.json<{ task?: string }>();
      if (!task) {
        return new Response("task is required", { status: 400 });
      }

      const result = await runTask(task, env);
      return Response.json(result);
    } catch (e) {
      const error = e instanceof Error ? e.message : "Unknown error";
      return new Response(`Error: ${error}`, { status: 500 });
    }
  },
};

export { Sandbox } from "@cloudflare/sandbox";
