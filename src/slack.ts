import type { TaskResult } from "./types";

// Post a message to Slack
export async function postMessage(
  token: string,
  channel: string,
  text: string,
  threadTs?: string
) {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      text,
      thread_ts: threadTs,
    }),
  });

  const data = (await response.json()) as { ok: boolean; error?: string };
  if (!data.ok) {
    console.error(`[Slack] Failed to post message: ${data.error}`);
    throw new Error(`Slack API error: ${data.error}`);
  }

  return data;
}

// Add a reaction to a message
export async function addReaction(
  token: string,
  channel: string,
  timestamp: string,
  emoji: string
) {
  const response = await fetch("https://slack.com/api/reactions.add", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      timestamp,
      name: emoji,
    }),
  });

  const data = (await response.json()) as { ok: boolean; error?: string };
  if (!data.ok && data.error !== "already_reacted") {
    console.error(`[Slack] Failed to add reaction: ${data.error}`);
  }
}

// Format the task result for Slack
export function formatResult(result: TaskResult): string {
  const lines: string[] = [];

  // Show error if Claude failed
  if (!result.claudeSuccess && result.claudeError) {
    lines.push(`❌ ${result.claudeError}`);
    lines.push("");
  }

  // PRs
  const prs: string[] = [];
  if (result.frontend.success && result.frontend.prUrl) {
    prs.push(`<${result.frontend.prUrl}|Frontend PR>`);
  }
  if (result.backend.success && result.backend.prUrl) {
    prs.push(`<${result.backend.prUrl}|Backend PR>`);
  }
  if (prs.length > 0) {
    lines.push(`🔗 ${prs.join(" • ")}`);
    lines.push("");
  }

  // Claude's message
  if (result.claudeMessage?.trim()) {
    lines.push(result.claudeMessage.trim());
  }

  return lines.join("\n").trim() || "No output.";
}

// Format error for Slack
export function formatError(error: Error, claudeOutput?: string): string {
  const lines = [`❌ ${error.message}`];

  if (claudeOutput) {
    lines.push("");
    lines.push("```");
    lines.push(claudeOutput.slice(-500));
    lines.push("```");
  }

  return lines.join("\n");
}

// Extract task from message text (remove bot mention)
export function extractTask(text: string, botUserId: string): string {
  // Remove the bot mention from the message
  return text.replace(new RegExp(`<@${botUserId}>`, "g"), "").trim();
}

// Parse Slack event from request body
export interface SlackEvent {
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
