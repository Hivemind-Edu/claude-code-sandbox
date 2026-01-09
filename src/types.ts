import type { getSandbox, Sandbox } from "@cloudflare/sandbox";
import type { TaskRunner } from "./task-runner";

export interface Env {
  Sandbox: DurableObjectNamespace<Sandbox>;
  TaskRunner: DurableObjectNamespace<TaskRunner>;
  ANTHROPIC_API_KEY: string;
  GITHUB_TOKEN: string;
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  SLACK_BOT_TOKEN: string;
  SLACK_SIGNING_SECRET?: string;
}

export type SandboxInstance = ReturnType<typeof getSandbox>;

export interface CmdOutput {
  success: boolean;
  stdout: string;
  stderr: string;
}

export interface PRResult {
  repoName: string;
  success: boolean;
  prUrl?: string;
  error?: string;
}

export interface TaskResult {
  branchName: string;
  claudeSuccess: boolean;
  claudeError?: string;
  claudeMessage: string;
  claudeSessionId?: string; // For conversation continuity with --resume
  frontend: PRResult;
  backend: PRResult;
}

export const FRONTEND_REPO = "https://github.com/Hivemind-Edu/hivemind-expo";
export const BACKEND_REPO = "https://github.com/Hivemind-Edu/hivemind-hono";
