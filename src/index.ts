import type { Env } from "./types";
import { runTask } from "./sandbox";
import { postMessage, addReaction, formatResult } from "./slack";
import type { SlackEvent } from "./slack";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    // Only accept POST
    if (request.method !== "POST") {
      return new Response("Send a POST request", { status: 405 });
    }

    const contentType = request.headers.get("content-type") || "";

    // Slack Events API (JSON)
    if (contentType.includes("application/json")) {
      try {
        const body = (await request.json()) as SlackEvent;

        // Handle Slack URL verification challenge
        if (body.type === "url_verification" && body.challenge) {
          return new Response(body.challenge, {
            headers: { "Content-Type": "text/plain" },
          });
        }

        // Handle app_mention events
        if (
          body.type === "event_callback" &&
          body.event?.type === "app_mention"
        ) {
          const { text, channel, ts, thread_ts, user } = body.event;

          // Extract task from message (remove bot mention)
          // Bot user ID will be in format <@U12345>
          const task = text.replace(/<@[A-Z0-9]+>/g, "").trim();

          if (!task) {
            await postMessage(
              env.SLACK_BOT_TOKEN,
              channel,
              "Please include a task description. Example: `@Claude add dark mode support`",
              ts
            );
            return new Response("ok");
          }

          console.log(`[index] Received task from <@${user}>: ${task}`);

          // React with eyes to show we're working on it
          await addReaction(env.SLACK_BOT_TOKEN, channel, ts, "eyes");

          // Send initial message in thread
          await postMessage(
            env.SLACK_BOT_TOKEN,
            channel,
            `🚀 *Working on:* ${task}\n\nI'll reply here when done (usually 1-2 min)...`,
            ts
          );

          // Run task in background
          ctx.waitUntil(
            (async () => {
              try {
                const result = await runTask(task, env);

                // Add checkmark reaction
                await addReaction(
                  env.SLACK_BOT_TOKEN,
                  channel,
                  ts,
                  "white_check_mark"
                );

                // Post result in thread
                await postMessage(
                  env.SLACK_BOT_TOKEN,
                  channel,
                  formatResult(result),
                  ts
                );
              } catch (error) {
                console.error("[index] Task failed:", error);

                // Add X reaction
                await addReaction(env.SLACK_BOT_TOKEN, channel, ts, "x");

                // Post error in thread
                const errorMessage =
                  error instanceof Error ? error.message : "Unknown error";
                await postMessage(
                  env.SLACK_BOT_TOKEN,
                  channel,
                  `❌ *Error:* ${errorMessage}`,
                  ts
                );
              }
            })()
          );

          return new Response("ok");
        }

        // JSON API for direct calls (non-Slack)
        const { task } = body as { task?: string };
        if (task) {
          const result = await runTask(task, env);
          return Response.json(result);
        }

        return new Response("ok");
      } catch (error) {
        console.error("[index] Error:", error);
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return new Response(`Error: ${message}`, { status: 500 });
      }
    }

    return new Response("Unsupported content type", { status: 400 });
  },
};

export { Sandbox } from "@cloudflare/sandbox";
