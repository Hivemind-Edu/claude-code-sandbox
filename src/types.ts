import type { getSandbox } from "@cloudflare/sandbox";

export interface Env {
  Sandbox: DurableObjectNamespace;
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
  claudeMessage: string;
  frontend: PRResult;
  backend: PRResult;
}

export const FRONTEND_REPO = "https://github.com/Hivemind-Edu/hivemind-expo";
export const BACKEND_REPO = "https://github.com/Hivemind-Edu/hivemind-hono";
