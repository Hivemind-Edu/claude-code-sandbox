import { getSandbox } from "@cloudflare/sandbox";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import {
  type Env,
  type TaskResult,
  type CmdOutput,
  type SandboxInstance,
  FRONTEND_REPO,
  BACKEND_REPO,
} from "./types";
import { createPullRequest } from "./github";

// Throws if command fails
async function run(sandbox: SandboxInstance, cmd: string): Promise<CmdOutput> {
  const result = await sandbox.exec(cmd);
  if (!result.success) {
    throw new Error(`Command failed: ${cmd}\n${result.stderr}`);
  }
  return result;
}

// Generate a short slug from task description using Gemini
async function generateBranchSlug(task: string): Promise<string> {
  const { text } = await generateText({
    model: google("gemini-flash-lite-latest"),
    prompt: `Generate a short branch name slug (2-4 words, lowercase, hyphens only) for this task: "${task}". Reply with ONLY the slug, nothing else.`,
  });

  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 40);
  return `sandbox/${slug}`;
}

// Extract Claude's last message (summary) from the full output
function extractClaudeMessage(logs: string): string {
  // Claude's output typically ends with a summary message
  // Split by common delimiters and get the last substantial block
  const lines = logs.trim().split("\n");

  // Find the last block of text (after last empty line or separator)
  let lastBlock: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.trim() === "" && lastBlock.length > 0) {
      break;
    }
    if (line.trim()) {
      lastBlock.unshift(line);
    }
  }

  return lastBlock.join("\n") || logs.slice(-1000);
}

export async function runTask(task: string, env: Env): Promise<TaskResult> {
  console.log(`[runTask] Starting task: ${task}`);

  const branchName = await generateBranchSlug(task);
  console.log(`[runTask] Generated branch: ${branchName}`);

  const frontendDir = "hivemind-expo";
  const backendDir = "hivemind-hono";

  const sandbox = getSandbox(env.Sandbox, crypto.randomUUID().slice(0, 8));

  // Clone both repos with auth
  const addAuth = (url: string) =>
    url.replace(
      "https://github.com/",
      `https://${env.GITHUB_TOKEN}@github.com/`
    );

  console.log("[runTask] Cloning repos...");
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
- At the end, provide a brief summary of what you did.
`.trim();

  console.log("[runTask] Running Claude...");
  const escapedTask = task.replace(/"/g, '\\"');
  const escapedSystem = systemPrompt.replace(/"/g, '\\"');
  const cmd = `claude --system-prompt "${escapedSystem}" -p "${escapedTask}" --dangerously-skip-permissions`;

  const result = await sandbox.exec(cmd);
  const claudeLogs = result.success ? result.stdout : result.stderr;
  const claudeMessage = extractClaudeMessage(claudeLogs);

  console.log("[runTask] Claude finished, creating PRs...");

  const frontend = await createPullRequest({
    sandbox,
    repoDir: frontendDir,
    repoUrl: FRONTEND_REPO,
    branchName,
    githubToken: env.GITHUB_TOKEN,
  });

  const backend = await createPullRequest({
    sandbox,
    repoDir: backendDir,
    repoUrl: BACKEND_REPO,
    branchName,
    githubToken: env.GITHUB_TOKEN,
  });

  console.log(
    `[runTask] Done. Frontend: ${frontend.success}, Backend: ${backend.success}`
  );

  return { branchName, claudeMessage, frontend, backend };
}
