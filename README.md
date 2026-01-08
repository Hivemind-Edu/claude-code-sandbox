# Hivemind Claude Bot

A Slack bot that runs Claude Code in a Cloudflare Sandbox to implement tasks across the Hivemind repositories, then creates PRs.

## How it works

1. Mention `@Claude` in Slack with a task description
2. The bot spins up a sandbox and clones both repos
3. Claude Code runs autonomously to complete the task
4. Changes are committed, pushed, and PRs are created
5. Results are posted back in the Slack thread

## Usage

In any Slack channel where the bot is added:

```
@Claude add dark mode support to the settings page
```

The bot will:

- React with 👀 to show it's working
- Post a "working on it" message in thread
- React with ✅ when done (or ❌ if failed)
- Post PR links and Claude's summary in thread

## Setup

### 1. Environment Variables

Create `.dev.vars` for local development:

```
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_TOKEN=ghp_...
GOOGLE_GENERATIVE_AI_API_KEY=...
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
```

### 2. Slack App Setup

1. Go to https://api.slack.com/apps
2. Create a new app "From scratch"
3. Name it `Claude` and select your workspace

**OAuth & Permissions:**

- Add Bot Token Scopes:
  - `app_mentions:read`
  - `chat:write`
  - `reactions:write`
- Install to workspace and copy the Bot Token (`xoxb-...`)

**Event Subscriptions:**

- Enable Events
- Set Request URL to your worker URL: `https://your-worker.workers.dev`
- Subscribe to bot events:
  - `app_mention`

### 3. Deploy

Add secrets to Cloudflare:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY
npx wrangler secret put SLACK_BOT_TOKEN
```

Deploy:

```bash
npm run deploy
```

### 4. Invite Bot

Invite `@Claude` to any channel where you want to use it.

## Local Development

```bash
npm run dev
```

Use ngrok or similar to expose local server to Slack.
