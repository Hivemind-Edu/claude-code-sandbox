import { $ } from "bun";
import { mkdir, rm, exists } from "node:fs/promises";
import type { Env, TaskResult, PRResult } from "./types";
import { createPullRequest } from "./github";

// Workspaces directory
const WORKSPACES_DIR = "/tmp/workspaces";

// System prompt for Claude
const SYSTEM_PROMPT = `You are an autonomous developer working on Hivemind, a learning app with a social media-style interface.

## Repositories
- Frontend: ./hivemind-expo (React Native/Expo)
- Backend: ./hivemind-hono (Hono API on Bun)

Both repos have READMEs with more details. The frontend calls the backend via REST API with RPC-style endpoints.

## Git Rules
- You are on branch "{BRANCH_NAME}" in both repos. NEVER switch branches.
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
- At the end, provide a brief summary of what you did.`;

// Generate branch name from task
function generateBranchName(task: string): string {
  const slug = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 30)
    .replace(/-$/, "");
  return `sandbox/${slug}`;
}

// Get workspace path for a Slack thread
function getWorkspacePath(threadTs: string): string {
  const safeName = threadTs.replace(".", "-");
  return `${WORKSPACES_DIR}/${safeName}`;
}

// Check if workspace already exists (for follow-up messages)
export async function workspaceExists(threadTs: string): Promise<boolean> {
  const workspace = getWorkspacePath(threadTs);
  return exists(workspace);
}

// Get stored branch name from workspace
async function getStoredBranchName(workspace: string): Promise<string | null> {
  const branchFile = `${workspace}/.branch-name`;
  if (await exists(branchFile)) {
    return (await Bun.file(branchFile).text()).trim();
  }
  return null;
}

// Store branch name in workspace
async function storeBranchName(
  workspace: string,
  branchName: string
): Promise<void> {
  await Bun.write(`${workspace}/.branch-name`, branchName);
}

// Extract Claude's message from output - return full content, cleaned up
function extractClaudeMessage(output: string): string {
  // Remove ANSI escape codes (ESC[ ... m sequences)
  const ansiRegex = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  const cleaned = output.replace(ansiRegex, "");

  // Filter out tool invocation noise and keep meaningful content
  const lines = cleaned.split("\n");
  const meaningfulLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines at start
    if (meaningfulLines.length === 0 && !trimmed) continue;
    // Skip JSON objects (tool calls/results)
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) continue;
    // Skip tool markers
    if (trimmed.startsWith("Tool:") || trimmed.startsWith("Result:")) continue;
    meaningfulLines.push(line);
  }

  return meaningfulLines.join("\n").trim();
}

// Run shell command and return result
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

// Clone repositories to workspace
async function setupWorkspace(
  workspace: string,
  branchName: string,
  env: Env
): Promise<void> {
  console.log(`[Task] Setting up workspace: ${workspace}`);

  // Clean and create workspace
  if (await exists(workspace)) {
    await rm(workspace, { recursive: true });
  }
  await mkdir(workspace, { recursive: true });

  // Clone frontend
  console.log("[Task] Cloning frontend...");
  const frontendUrl = env.FRONTEND_REPO.replace(
    "https://",
    `https://oauth2:${env.GITHUB_TOKEN}@`
  );
  await exec(`git clone --depth 1 ${frontendUrl} hivemind-expo`, workspace);

  // Clone backend
  console.log("[Task] Cloning backend...");
  const backendUrl = env.BACKEND_REPO.replace(
    "https://",
    `https://oauth2:${env.GITHUB_TOKEN}@`
  );
  await exec(`git clone --depth 1 ${backendUrl} hivemind-hono`, workspace);

  // Setup branches
  console.log(`[Task] Setting up branch: ${branchName}`);
  await exec(
    `cd hivemind-expo && git checkout -b ${branchName} && git config user.email "claude@example.com" && git config user.name "Claude"`,
    workspace
  );
  await exec(
    `cd hivemind-hono && git checkout -b ${branchName} && git config user.email "claude@example.com" && git config user.name "Claude"`,
    workspace
  );
}

// Run Claude Code in workspace
async function runClaude(
  workspace: string,
  task: string,
  branchName: string,
  threadTs: string,
  env: Env
): Promise<{ success: boolean; output: string; sessionId?: string }> {
  console.log("[Task] Running Claude Code...");

  const systemPrompt = SYSTEM_PROMPT.replace("{BRANCH_NAME}", branchName);

  // Check for existing session (conversation continuity)
  const sessionFile = `${workspace}/.claude-session`;
  let resumeArg = "";
  if (await exists(sessionFile)) {
    const existingSessionId = await Bun.file(sessionFile).text();
    if (existingSessionId.trim()) {
      resumeArg = existingSessionId.trim();
      console.log(`[Task] Resuming session: ${resumeArg}`);
    }
  }

  // Build Claude command as array (proper Bun.spawn usage)
  const claudeArgs = [
    "claude",
    "-p",
    task,
    "--append-system-prompt",
    systemPrompt,
    "--max-turns",
    "50",
    "--verbose",
    "--dangerously-skip-permissions",
    ...(resumeArg ? ["--resume", resumeArg] : []),
  ];

  console.log(
    "[Task] Claude command:",
    claudeArgs[0],
    claudeArgs.slice(1, 5).join(" "),
    "..."
  );

  // Run Claude using Bun.spawn with array of args (no shell escaping needed)
  // Claude uses CLAUDE_CONFIG_DIR for auth (set in Dockerfile, persisted via Railway volume)
  const proc = Bun.spawn(claudeArgs, {
    cwd: workspace,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Collect output
  let stdout = "";
  let stderr = "";

  // Stream stdout
  const stdoutReader = proc.stdout.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await stdoutReader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    stdout += chunk;
    // Log each line
    for (const line of chunk.split("\n")) {
      if (line.trim()) {
        console.log("[Claude]", line.slice(0, 500));
      }
    }
  }

  // Read stderr
  stderr = await new Response(proc.stderr).text();
  if (stderr) {
    console.error("[Claude stderr]", stderr.slice(0, 500));
  }

  const exitCode = await proc.exited;
  const success = exitCode === 0;

  console.log(`[Task] Claude exit code: ${exitCode}`);

  // Try to extract session ID from output for future --resume
  let sessionId: string | undefined;
  const sessionMatch = stdout.match(
    /session_id["']?\s*[:=]\s*["']?([a-f0-9-]+)/i
  );
  if (sessionMatch?.[1]) {
    sessionId = sessionMatch[1];
    await Bun.write(sessionFile, sessionId);
    console.log(`[Task] Saved session ID: ${sessionId}`);
  }

  return {
    success,
    output: stdout || stderr,
    sessionId,
  };
}

// Main task runner
export async function runTask(
  task: string,
  threadTs: string,
  env: Env
): Promise<TaskResult> {
  const branchName = generateBranchName(task);
  const workspace = getWorkspacePath(threadTs);

  console.log(`[Task] Starting task: "${task.slice(0, 50)}..."`);
  console.log(`[Task] Branch: ${branchName}`);
  console.log(`[Task] Workspace: ${workspace}`);

  // Setup workspace
  await setupWorkspace(workspace, branchName, env);

  // Run Claude
  const claudeResult = await runClaude(
    workspace,
    task,
    branchName,
    threadTs,
    env
  );

  // Extract message from Claude output
  const claudeMessage = extractClaudeMessage(claudeResult.output);

  // Create PRs
  console.log("[Task] Creating PRs...");

  const frontend = await createPullRequest({
    workspace,
    repoDir: "hivemind-expo",
    repoUrl: env.FRONTEND_REPO,
    branchName,
    githubToken: env.GITHUB_TOKEN,
  });

  const backend = await createPullRequest({
    workspace,
    repoDir: "hivemind-hono",
    repoUrl: env.BACKEND_REPO,
    branchName,
    githubToken: env.GITHUB_TOKEN,
  });

  // Store branch name for future follow-ups
  await storeBranchName(workspace, branchName);

  console.log("[Task] Complete!");
  console.log(`[Task] Frontend PR: ${frontend.prUrl || frontend.error}`);
  console.log(`[Task] Backend PR: ${backend.prUrl || backend.error}`);

  return {
    branchName,
    claudeSuccess: claudeResult.success,
    claudeError: !claudeResult.success
      ? claudeResult.output.slice(0, 500)
      : undefined,
    claudeMessage,
    claudeSessionId: claudeResult.sessionId,
    frontend,
    backend,
  };
}

// Continue an existing task with a follow-up message
export async function continueTask(
  message: string,
  threadTs: string,
  env: Env
): Promise<TaskResult> {
  const workspace = getWorkspacePath(threadTs);

  // Get stored branch name
  const branchName = await getStoredBranchName(workspace);
  if (!branchName) {
    throw new Error("No branch name found in workspace - cannot continue task");
  }

  console.log(`[Task] Continuing task: "${message.slice(0, 50)}..."`);
  console.log(`[Task] Branch: ${branchName}`);
  console.log(`[Task] Workspace: ${workspace}`);

  // Run Claude with the follow-up message (workspace already exists)
  const claudeResult = await runClaude(
    workspace,
    message,
    branchName,
    threadTs,
    env
  );

  // Extract message from Claude output
  const claudeMessage = extractClaudeMessage(claudeResult.output);

  // Create/update PRs
  console.log("[Task] Creating/updating PRs...");

  const frontend = await createPullRequest({
    workspace,
    repoDir: "hivemind-expo",
    repoUrl: env.FRONTEND_REPO,
    branchName,
    githubToken: env.GITHUB_TOKEN,
  });

  const backend = await createPullRequest({
    workspace,
    repoDir: "hivemind-hono",
    repoUrl: env.BACKEND_REPO,
    branchName,
    githubToken: env.GITHUB_TOKEN,
  });

  console.log("[Task] Continue complete!");
  console.log(`[Task] Frontend PR: ${frontend.prUrl || frontend.error}`);
  console.log(`[Task] Backend PR: ${backend.prUrl || backend.error}`);

  return {
    branchName,
    claudeSuccess: claudeResult.success,
    claudeError: !claudeResult.success
      ? claudeResult.output.slice(0, 500)
      : undefined,
    claudeMessage,
    claudeSessionId: claudeResult.sessionId,
    frontend,
    backend,
  };
}
