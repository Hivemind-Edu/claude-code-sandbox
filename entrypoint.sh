#!/bin/bash
#
# Entrypoint script for claude-code-sandbox
# Configures MCP servers on first run (they persist in /claude-config volume)
#

set -e

MCP_CONFIGURED_FLAG="/claude-config/.mcp-configured"

configure_mcps() {
    echo "[Entrypoint] Configuring MCP servers..."

    # Sentry MCP (HTTP transport - no auth needed at config time)
    if ! claude mcp list 2>/dev/null | grep -q "sentry"; then
        echo "[Entrypoint] Adding Sentry MCP..."
        claude mcp add --transport http sentry https://mcp.sentry.dev/mcp || true
    fi

    # Expo MCP (HTTP transport)
    if ! claude mcp list 2>/dev/null | grep -q "expo-mcp"; then
        echo "[Entrypoint] Adding Expo MCP..."
        claude mcp add --transport http expo-mcp https://mcp.expo.dev/mcp || true
    fi

    # Context7 MCP (for documentation lookups)
    if ! claude mcp list 2>/dev/null | grep -q "context7"; then
        echo "[Entrypoint] Adding Context7 MCP..."
        claude mcp add context7 -- npx -y @upstash/context7-mcp || true
    fi

    # PostHog MCP (requires POSTHOG_AUTH_HEADER env var at runtime)
    if ! claude mcp list 2>/dev/null | grep -q "posthog"; then
        if [ -n "$POSTHOG_AUTH_HEADER" ]; then
            echo "[Entrypoint] Adding PostHog MCP..."
            claude mcp add posthog -- npx -y mcp-remote@latest https://mcp.posthog.com/mcp \
                --header "Authorization:\${POSTHOG_AUTH_HEADER}" || true
        else
            echo "[Entrypoint] Skipping PostHog MCP (POSTHOG_AUTH_HEADER not set)"
        fi
    fi

    # Langfuse MCP (requires LANGFUSE keys at runtime)
    if ! claude mcp list 2>/dev/null | grep -q "langfuse"; then
        if [ -n "$LANGFUSE_PUBLIC_KEY" ] && [ -n "$LANGFUSE_SECRET_KEY" ]; then
            echo "[Entrypoint] Adding Langfuse MCP..."
            claude mcp add langfuse -- uvx langfuse-mcp \
                --public-key "\${LANGFUSE_PUBLIC_KEY}" \
                --secret-key "\${LANGFUSE_SECRET_KEY}" || true
        else
            echo "[Entrypoint] Skipping Langfuse MCP (LANGFUSE keys not set)"
        fi
    fi

    # Mark as configured
    touch "$MCP_CONFIGURED_FLAG"
    echo "[Entrypoint] MCP configuration complete"
}

# Configure MCPs if not already done
if [ ! -f "$MCP_CONFIGURED_FLAG" ]; then
    configure_mcps
else
    echo "[Entrypoint] MCPs already configured"
fi

# List configured MCPs
echo "[Entrypoint] Available MCP servers:"
claude mcp list 2>/dev/null || echo "  (none configured)"

# Execute the main command
exec "$@"
