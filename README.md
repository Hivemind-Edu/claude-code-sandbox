# Claude Code Railway

A Slack bot that uses Claude Code to autonomously make code changes across repositories.

## Features

- 🤖 Mention the bot in Slack to trigger tasks
- 🧵 Thread-based conversation continuity (Claude remembers context)
- 🔀 Automatic PR creation for both frontend and backend repos
- 📝 Real-time streaming output

## Setup

### 1. Deploy to Railway

1. Fork/push this repo to GitHub
2. Create a new Railway project
3. Add your GitHub repo as a service
4. Railway will auto-detect `railpack.json` and install dependencies

### 2. Create a Railway Volume

1. In your Railway project, create a volume
2. Mount it at `/claude-config`
3. This persists Claude CLI login credentials between deploys

### 3. Environment Variables

Set these in Railway:

```
GITHUB_TOKEN=ghp_...
SLACK_BOT_TOKEN=xoxb-...
```

### 4. Login to Claude CLI

On first run, you'll need to login to Claude:

```bash
# SSH into your Railway container or use railway run
claude login
```

Your credentials are stored in the `/claude-config` volume and persist across deploys.

### 5. Slack App Setup

1. Create a Slack app at https://api.slack.com/apps
2. Enable **Event Subscriptions** and set Request URL to your Railway URL
3. Subscribe to `app_mention` events
4. Add **Bot Token Scopes**: `app_mentions:read`, `chat:write`, `reactions:write`
5. Install to workspace

## Local Development

```bash
# Install dependencies
bun install

# Create .env from example
cp .env.example .env
# Edit .env with your secrets

# Run dev server
bun run dev
```

## Usage

Mention the bot in Slack:

```
@ClaudeBot add dark mode to the settings page
```

The bot will:

1. Clone the repos
2. Run Claude Code with your task
3. Create PRs with the changes
4. Reply with links to the PRs

### Conversation Continuity

Reply in a thread to continue the same Claude session:

```
@ClaudeBot fix the linting errors you introduced
```

## Architecture

```
Slack → Railway (Hono server)
            ↓
        Bun.spawn(claude)
            ↓
        Git push → GitHub PRs
            ↓
        Reply to Slack
```

Simple. No Workers, no Durable Objects, no containers.

## Files

- `src/index.ts` - Hono server, Slack webhook handler
- `src/task.ts` - Claude Code runner with Bun.spawn
- `src/github.ts` - PR creation
- `src/slack.ts` - Slack API helpers
- `railpack.json` - Railway build config (installs claude-code, maestro)
