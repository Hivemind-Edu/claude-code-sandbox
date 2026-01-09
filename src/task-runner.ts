import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types";
import { runTask } from "./sandbox";
import { postMessage, addReaction, formatResult, formatError } from "./slack";

interface TaskRequest {
  task: string;
  channel: string;
  ts: string;
  slackToken: string;
}

const WATCHDOG_TIMEOUT_MS = 35 * 60 * 1000; // 35 minutes

export class TaskRunner extends DurableObject<Env> {
  // Returns immediately, does work in background via DO's own context
  async run(request: TaskRequest): Promise<{ started: boolean }> {
    // Store task info so watchdog alarm can post to Slack if we die
    await this.ctx.storage.put("task", request);
    await this.ctx.storage.put("status", "running");
    await this.ctx.storage.put("startedAt", Date.now());

    // Set watchdog alarm - if task doesn't complete, this fires
    await this.ctx.storage.setAlarm(Date.now() + WATCHDOG_TIMEOUT_MS);

    // Run task in background
    this.ctx.waitUntil(this.executeTask(request));
    return { started: true };
  }

  // Watchdog alarm - fires if task doesn't complete in time
  async alarm(): Promise<void> {
    try {
      const status = await this.ctx.storage.get<string>("status");

      // Ignore if task already completed, failed, or timed out
      if (status !== "running") {
        console.log(
          "[TaskRunner] Alarm fired but status is:",
          status || "empty"
        );
        return;
      }

      console.error(
        "[TaskRunner] Watchdog alarm fired - task timed out or died silently"
      );

      const task = await this.ctx.storage.get<TaskRequest>("task");
      if (task) {
        await this.postError(
          task,
          "Task timed out or failed silently after 35 minutes"
        );
      } else {
        console.error("[TaskRunner] No task in storage for timed out alarm");
      }

      await this.ctx.storage.put("status", "timeout");
    } catch (error) {
      // Defensive - don't let alarm handler crash
      console.error("[TaskRunner] Alarm handler error:", error);
    }
  }

  private async executeTask(request: TaskRequest): Promise<void> {
    const { task } = request;

    try {
      console.log("[TaskRunner] Starting task:", task);
      const result = await runTask(task, this.env);
      console.log("[TaskRunner] Task completed");

      // Mark as completed before posting (in case Slack fails)
      await this.ctx.storage.put("status", "completed");
      await this.ctx.storage.deleteAlarm();

      // Add checkmark reaction
      await addReaction(
        request.slackToken,
        request.channel,
        request.ts,
        "white_check_mark"
      );

      // Post result in thread
      await postMessage(
        request.slackToken,
        request.channel,
        formatResult(result),
        request.ts
      );
    } catch (error) {
      console.error("[TaskRunner] Task failed:", error);
      await this.ctx.storage.put("status", "failed");
      await this.ctx.storage.deleteAlarm();

      await this.postError(
        request,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async postError(
    request: TaskRequest,
    message: string
  ): Promise<void> {
    try {
      await addReaction(request.slackToken, request.channel, request.ts, "x");
      await postMessage(
        request.slackToken,
        request.channel,
        formatError(new Error(message)),
        request.ts
      );
    } catch (slackError) {
      // Last resort - at least log it
      console.error("[TaskRunner] Failed to post error to Slack:", slackError);
      console.error("[TaskRunner] Original error:", message);
    }
  }
}
