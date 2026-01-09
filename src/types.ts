// Environment variables
export interface Env {
  GITHUB_TOKEN: string;
  SLACK_BOT_TOKEN: string; // Optional - falls back to console notifier if empty
  FRONTEND_REPO: string;
  BACKEND_REPO: string;
  PORT: string;
}

// Result of creating a PR
export interface PRResult {
  repoName: string;
  success: boolean;
  prUrl?: string;
  error?: string;
}

// Result of running a task
export interface TaskResult {
  branchName: string;
  claudeSuccess: boolean;
  claudeError?: string;
  claudeMessage: string;
  claudeSessionId?: string;
  frontend: PRResult;
  backend: PRResult;
}

// Command execution result
export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}
