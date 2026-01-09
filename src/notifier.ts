import type { TaskResult } from "./types";

// Generic notification interface - implement for Slack, GitHub, CLI, etc.
export interface Notifier {
  // Called when task starts
  onTaskStart(task: string): Promise<void>;
  // Called when task completes successfully
  onTaskComplete(result: TaskResult): Promise<void>;
  // Called when task fails
  onTaskError(error: Error): Promise<void>;
}

// Console notifier for testing/development
export class ConsoleNotifier implements Notifier {
  async onTaskStart(task: string): Promise<void> {
    console.log(`\n🚀 [Console] Starting task: ${task}\n`);
  }

  async onTaskComplete(result: TaskResult): Promise<void> {
    console.log("\n✅ [Console] Task completed:");
    console.log(`   Branch: ${result.branchName}`);
    console.log(`   Claude success: ${result.claudeSuccess}`);
    if (result.frontend.prUrl)
      console.log(`   Frontend PR: ${result.frontend.prUrl}`);
    if (result.backend.prUrl)
      console.log(`   Backend PR: ${result.backend.prUrl}`);
    if (result.claudeMessage) {
      console.log("\n--- Claude's Response ---");
      console.log(result.claudeMessage);
      console.log("--- End Response ---\n");
    }
  }

  async onTaskError(error: Error): Promise<void> {
    console.error(`\n❌ [Console] Task failed: ${error.message}\n`);
  }
}

// Slack notifier
export class SlackNotifier implements Notifier {
  constructor(
    private token: string,
    private channel: string,
    private threadTs: string,
    private messageTs: string
  ) {}

  async onTaskStart(task: string): Promise<void> {
    await this.addReaction("rocket");
    await this.postMessage(
      `🚀 Working on: ${task.slice(0, 100)}${
        task.length > 100 ? "..." : ""
      }\n_I'll reply here when done (usually 1-10 min)..._`
    );
  }

  async onTaskComplete(result: TaskResult): Promise<void> {
    await this.addReaction("white_check_mark");
    const messages = this.formatResult(result);
    for (const message of messages) {
      await this.postMessage(message);
    }
  }

  async onTaskError(error: Error): Promise<void> {
    await this.addReaction("x");
    await this.postMessage(`❌ ${error.message}`);
  }

  private async postMessage(text: string): Promise<void> {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: this.channel,
        text,
        thread_ts: this.threadTs,
      }),
    });

    const data = (await response.json()) as { ok: boolean; error?: string };
    if (!data.ok) {
      console.error(`[Slack] Failed to post message: ${data.error}`);
      // Don't throw - graceful degradation
    }
  }

  private async addReaction(emoji: string): Promise<void> {
    const response = await fetch("https://slack.com/api/reactions.add", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: this.channel,
        timestamp: this.messageTs,
        name: emoji,
      }),
    });

    const data = (await response.json()) as { ok: boolean; error?: string };
    if (!data.ok && data.error !== "already_reacted") {
      console.error(`[Slack] Failed to add reaction: ${data.error}`);
      // Don't throw - graceful degradation
    }
  }

  private formatResult(result: TaskResult): string[] {
    const messages: string[] = [];

    // First message: PRs at the top (most important)
    const headerLines: string[] = [];
    const prs: string[] = [];
    if (result.frontend.success && result.frontend.prUrl) {
      prs.push(`<${result.frontend.prUrl}|Frontend PR>`);
    }
    if (result.backend.success && result.backend.prUrl) {
      prs.push(`<${result.backend.prUrl}|Backend PR>`);
    }
    if (prs.length > 0) {
      headerLines.push(`🔗 ${prs.join(" • ")}`);
    }

    // Error message if failed
    if (!result.claudeSuccess && result.claudeError) {
      headerLines.push(`❌ ${result.claudeError}`);
    }

    // Add header as first message if it exists
    if (headerLines.length > 0) {
      messages.push(headerLines.join("\n"));
    }

    // Claude's full message - split into chunks
    if (result.claudeMessage?.trim()) {
      const chunks = this.splitIntoChunks(result.claudeMessage.trim());
      messages.push(...chunks);
    }

    return messages.length > 0 ? messages : ["No output."];
  }

  // Split long text into Slack-friendly chunks at line boundaries
  private splitIntoChunks(text: string): string[] {
    const SLACK_LIMIT = 3800;

    if (text.length <= SLACK_LIMIT) {
      return [text];
    }

    const chunks: string[] = [];
    const lines = text.split("\n");
    let currentChunk = "";

    for (const line of lines) {
      // If adding this line would exceed limit, save current chunk and start new one
      if (currentChunk.length + line.length + 1 > SLACK_LIMIT) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }
        // If single line is too long, split it
        if (line.length > SLACK_LIMIT) {
          const lineChunks = this.splitLongLine(line, SLACK_LIMIT);
          chunks.push(...lineChunks.slice(0, -1));
          currentChunk = lineChunks[lineChunks.length - 1] + "\n";
        } else {
          currentChunk = line + "\n";
        }
      } else {
        currentChunk += line + "\n";
      }
    }

    // Don't forget the last chunk
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  // Split a single long line into chunks
  private splitLongLine(line: string, limit: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < line.length; i += limit) {
      chunks.push(line.slice(i, i + limit));
    }
    return chunks;
  }
}

// Future: GitHub notifier
// export class GitHubNotifier implements Notifier {
//   constructor(private token: string, private issueNumber: number, private repo: string) {}
//   async onTaskStart(task: string) { /* Post comment to issue */ }
//   async onTaskComplete(result: TaskResult) { /* Post result comment */ }
//   async onTaskError(error: Error) { /* Post error comment */ }
// }
