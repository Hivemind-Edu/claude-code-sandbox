# Hivemind Auto-PR Bot

A Cloudflare Worker that runs Claude Code in a sandbox to automatically implement tasks across the Hivemind frontend and backend repositories, then creates PRs.

## How it works

1. Send a POST request with a task description
2. The worker spins up a sandbox and clones both repos:
   - `hivemind-expo` (React Native/Expo frontend)
   - `hivemind-hono` (Hono/Bun backend)
3. Claude Code runs autonomously to complete the task
4. Changes are committed, pushed, and PRs are created

## Usage

```bash
curl -X POST https://your-worker.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"task": "Add dark mode support"}'
```

## Response

```json
{
  "branchName": "sandbox/abc123",
  "claudeLogs": "...",
  "frontend": { "success": true, "prUrl": "https://github.com/..." },
  "backend": { "success": true, "prUrl": "https://github.com/..." }
}
```

## Setup

1. Set environment variables in `.dev.vars`:

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   GITHUB_TOKEN=ghp_...
   ```

2. Run locally:

   ```bash
   npm run dev
   ```

3. Deploy:
   ```bash
   npm run deploy
   ```
