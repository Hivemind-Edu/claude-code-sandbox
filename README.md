# Claude Code Railway

A Slack bot that uses Claude Code to autonomously make code changes across repositories.

## Features

- 🤖 Mention the bot in Slack to trigger tasks
- 🧵 Thread-based conversation continuity (Claude remembers context)
- 🔀 Automatic PR creation for both frontend and backend repos
- 📝 Real-time streaming output
- 🔧 **Specialized AI agents** for Sentry debugging, accessibility, security, testing
- 🔌 **MCP integrations** with Sentry, PostHog, Expo, Context7, Langfuse
- 📚 **Auto-injected CLAUDE.md** templates with full project context

## Integrated Tools

This sandbox integrates [hivemind-claude-code-setup](https://github.com/Hivemind-Edu/hivemind-claude-code-setup) which provides:

### Agents
| Agent | Purpose |
|-------|---------|
| `@sentry-investigator` | Fetch and analyze production errors from Sentry |
| `@grand-architect` | Plan complex features, orchestrate multi-step tasks |
| `@a11y-enforcer` | Check accessibility compliance |
| `@design-token-guardian` | Enforce design system (no hardcoded colors) |
| `@security-specialist` | Security audits |
| `@test-generator` | Generate tests with ROI prioritization |

### MCP Servers
| Server | Purpose |
|--------|---------|
| Sentry | Production error tracking and stack traces |
| PostHog | Analytics, feature flags, experiments |
| Context7 | Up-to-date library documentation |
| Expo | Expo/React Native documentation |
| Langfuse | LLM tracing and debugging |

### Slash Commands
- `/debug-sentry` - Investigate Sentry issues
- `/review` - Code review for security, a11y, performance
- `/why` - Pre-flight checklist before building
- `/test` - Generate tests

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

**Required:**
```
GITHUB_TOKEN=ghp_...              # GitHub PAT for cloning and PRs (also used at build time)
```

> **Note:** `GITHUB_TOKEN` must be set as both a **build variable** and **runtime variable** in Railway. It's used at build time to clone the private `hivemind-claude-code-setup` repo, and at runtime for creating PRs.

**Optional (Slack integration):**
```
SLACK_BOT_TOKEN=xoxb-...          # Falls back to console output if not set
```

**Optional (MCP servers for enhanced capabilities):**
```
SENTRY_AUTH_TOKEN=sntrys_...      # For production error investigation
POSTHOG_AUTH_HEADER=Bearer phx_...  # For analytics and feature flags
LANGFUSE_PUBLIC_KEY=pk-lf-...     # For LLM tracing
LANGFUSE_SECRET_KEY=sk-lf-...     # For LLM tracing
```

MCP servers are configured automatically on first container boot. See `.env.example` for details on obtaining these tokens.

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

1. Clone the repos (with CLAUDE.md templates injected)
2. Run Claude Code with full project context
3. Use specialized agents and MCP servers as needed
4. Create PRs with the changes
5. Reply with links to the PRs

### Example Commands

**Feature development:**
```
@ClaudeBot add dark mode to the settings page
```

**Production error investigation:**
```
@ClaudeBot /debug-sentry HIVEMIND-EXPO-1234
```
Claude will use the Sentry MCP to fetch the error, trace it to source code, and fix it.

**Code review:**
```
@ClaudeBot /review the authentication changes
```

**Complex features:**
```
@ClaudeBot implement offline mode for the feed
```
Claude will use `@grand-architect` to plan and orchestrate the implementation.

### Conversation Continuity

Reply in a thread to continue the same Claude session:

```
@ClaudeBot fix the linting errors you introduced
```

## Architecture

```
Slack → Railway (Hono server)
            ↓
        setupWorkspace()
            ├── Clone repos
            └── Inject CLAUDE.md templates
            ↓
        Bun.spawn(claude)
            ├── Agents: ~/.claude/agents/
            ├── Commands: ~/.claude/commands/
            └── MCPs: Sentry, PostHog, etc.
            ↓
        Git push → GitHub PRs
            ↓
        Reply to Slack
```

### Build-time Integration

The Dockerfile clones [hivemind-claude-code-setup](https://github.com/Hivemind-Edu/hivemind-claude-code-setup) and installs:
- **Agents** → `/root/.claude/agents/` (17+ specialized agents)
- **Commands** → `/root/.claude/commands/` (slash commands)
- **Templates** → `/opt/claude-setup/templates/` (CLAUDE.md for each repo)

### Runtime Configuration

MCP servers are configured on first boot via `entrypoint.sh` and persisted in the `/claude-config` Railway volume.

## Files

- `src/index.ts` - Hono server, Slack webhook handler
- `src/task.ts` - Claude Code runner with Bun.spawn, template injection
- `src/github.ts` - PR creation
- `src/notifier.ts` - Slack/console notification helpers
- `entrypoint.sh` - MCP server configuration on boot
- `Dockerfile` - Builds image with Claude CLI, setup repo, agents
