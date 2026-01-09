import { Hono } from "hono";
import type { Env } from "./types";
import { runTask, continueTask, workspaceExists } from "./task";
import { SlackNotifier, ConsoleNotifier, type Notifier } from "./notifier";

// Slack message in thread history
interface SlackMessage {
  user: string;
  text: string;
  ts: string;
}

// Fetch thread history from Slack
async function fetchThreadHistory(
  channel: string,
  threadTs: string,
  botToken: string
): Promise<SlackMessage[]> {
  if (!botToken) return [];

  try {
    const response = await fetch(
      `https://slack.com/api/conversations.replies?channel=${channel}&ts=${threadTs}`,
      {
        headers: {
          Authorization: `Bearer ${botToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = (await response.json()) as {
      ok: boolean;
      messages?: Array<{ user: string; text: string; ts: string }>;
    };

    if (!data.ok || !data.messages) {
      console.error("[Slack] Failed to fetch thread history");
      return [];
    }

    return data.messages.map(
      (m: { user: string; text: string; ts: string }) => ({
        user: m.user,
        text: m.text,
        ts: m.ts,
      })
    );
  } catch (error) {
    console.error("[Slack] Error fetching thread history:", error);
    return [];
  }
}

// Format thread history for Claude prompt
function formatThreadContext(messages: SlackMessage[]): string {
  if (messages.length === 0) return "";

  const formatted = messages
    .slice(0, -1) // All except the last message (which is the current instruction)
    .map(
      (m) =>
        `[User ${m.user}]: ${m.text.replace(/<@[A-Z0-9]+>/g, "@claude").trim()}`
    )
    .join("\n\n");

  if (!formatted) return "";

  return `## Thread Context (conversation history):\n${formatted}\n\n## Current instruction (from the last message above):`;
}

// Validate required environment variables (returns undefined if missing)
function getEnv(name: string): string | undefined {
  return process.env[name];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// Load environment
const env: Env = {
  GITHUB_TOKEN: requireEnv("GITHUB_TOKEN"),
  SLACK_BOT_TOKEN: getEnv("SLACK_BOT_TOKEN") || "",
  FRONTEND_REPO:
    process.env.FRONTEND_REPO ||
    "https://github.com/Hivemind-Edu/hivemind-expo.git",
  BACKEND_REPO:
    process.env.BACKEND_REPO ||
    "https://github.com/Hivemind-Edu/hivemind-hono.git",
  PORT: process.env.PORT || "6000",
};

const app = new Hono();

// Health check
app.get("/", (c) => c.json({ status: "ok", service: "claude-code-railway" }));
app.get("/health", (c) => c.json({ status: "healthy" }));

// Direct task endpoint (for testing, CLI, other integrations)
app.post("/task", async (c) => {
  const body = await c.req.json<{ task: string; threadId?: string }>();
  const task = body.task;
  const threadId = body.threadId || `test-${Date.now()}`;

  if (!task) {
    return c.json({ ok: false, error: "No task provided" }, 400);
  }

  console.log(
    `[API] Task received: "${task.slice(0, 50)}..." thread=${threadId}`
  );

  // Use console notifier for direct API calls
  const notifier = new ConsoleNotifier();

  try {
    await notifier.onTaskStart(task);
    const result = await runTask(task, threadId, env);
    await notifier.onTaskComplete(result);
    return c.json({ ok: true, result });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    await notifier.onTaskError(err);
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// Slack webhook handler
app.post("/slack", async (c) => {
  const body = await c.req.json<SlackEvent>();

  // URL verification challenge
  if (body.type === "url_verification") {
    return c.json({ challenge: body.challenge });
  }

  // Handle app_mention events
  if (body.type === "event_callback" && body.event?.type === "app_mention") {
    const event = body.event;
    const task = extractTask(event.text);

    if (!task) {
      return c.json({ ok: true, message: "No task provided" });
    }

    const threadTs = event.thread_ts || event.ts;
    const channel = event.channel;

    console.log(
      `[Slack] Task received: "${task.slice(0, 50)}..." thread=${threadTs}`
    );

    // Process task in background (Slack needs response within 3 seconds)
    processTask(task, threadTs, channel, event.ts);

    return c.json({ ok: true });
  }

  return c.json({ ok: true });
});

// Legacy: Also handle POST to / for backwards compatibility with existing Slack config
app.post("/", async (c) => {
  const contentType = c.req.header("content-type") || "";
  if (!contentType.includes("application/json")) {
    return c.json({ ok: true });
  }

  const body = await c.req.json<SlackEvent>();

  // URL verification challenge
  if (body.type === "url_verification") {
    return c.json({ challenge: body.challenge });
  }

  // Handle app_mention events
  if (body.type === "event_callback" && body.event?.type === "app_mention") {
    const event = body.event;
    const task = extractTask(event.text);

    if (!task) {
      return c.json({ ok: true, message: "No task provided" });
    }

    const threadTs = event.thread_ts || event.ts;
    const channel = event.channel;

    console.log(
      `[Slack] Task received: "${task.slice(0, 50)}..." thread=${threadTs}`
    );

    processTask(task, threadTs, channel, event.ts);

    return c.json({ ok: true });
  }

  return c.json({ ok: true });
});

// Background task processor
async function processTask(
  task: string,
  threadTs: string,
  channel: string,
  messageTs: string
): Promise<void> {
  // Choose notifier based on whether Slack token is configured
  const notifier: Notifier = env.SLACK_BOT_TOKEN
    ? new SlackNotifier(env.SLACK_BOT_TOKEN, channel, threadTs, messageTs)
    : new ConsoleNotifier();

  try {
    // Check if this is a follow-up in an existing workspace
    const isFollowUp = await workspaceExists(threadTs);

    if (isFollowUp) {
      console.log(
        "[Slack] Follow-up message detected, continuing existing task..."
      );

      // Fetch thread history for context
      const threadHistory = await fetchThreadHistory(
        channel,
        threadTs,
        env.SLACK_BOT_TOKEN
      );
      const threadContext = formatThreadContext(threadHistory);

      // Combine thread context with current message
      const fullPrompt = threadContext ? `${threadContext}\n${task}` : task;

      await notifier.onTaskStart(`[Follow-up] ${task}`);
      const result = await continueTask(fullPrompt, threadTs, env);
      await notifier.onTaskComplete(result);
    } else {
      await notifier.onTaskStart(task);
      const result = await runTask(task, threadTs, env);
      await notifier.onTaskComplete(result);
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[Task] Error:", err);
    await notifier.onTaskError(err);
  }
}

// Extract task from message text (remove any bot mentions)
function extractTask(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

// Slack event types
interface SlackEvent {
  type: string;
  challenge?: string;
  event?: {
    type: string;
    text: string;
    user: string;
    channel: string;
    ts: string;
    thread_ts?: string;
  };
}

// Start server
const port = Number.parseInt(env.PORT, 10);
console.log(`🚀 Claude Code Railway server starting on port ${port}...`);

export default {
  port,
  fetch: app.fetch,
};
