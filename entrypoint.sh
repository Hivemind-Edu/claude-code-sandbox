#!/bin/bash
#
# Entrypoint script for claude-code-sandbox
# Configures MCP servers on first run (they persist in /claude-config volume)
#

set -e

MCP_CONFIGURED_FLAG="/claude-config/.mcp-configured-v3"

configure_mcps() {
    echo "[Entrypoint] Configuring MCP servers..."

    # Remove old MCP configs to ensure fresh setup
    claude mcp remove sentry 2>/dev/null || true
    claude mcp remove expo-mcp 2>/dev/null || true
    claude mcp remove posthog 2>/dev/null || true

    # Sentry MCP - Use official @sentry/mcp-server package (STDIO transport)
    # The HTTP endpoint at mcp.sentry.dev is OAuth-only, won't work headless
    if ! claude mcp list 2>/dev/null | grep -q "sentry"; then
        if [ -n "$SENTRY_AUTH_TOKEN" ]; then
            echo "[Entrypoint] Adding Sentry MCP (@sentry/mcp-server)..."
            # Export as SENTRY_ACCESS_TOKEN which the package expects
            export SENTRY_ACCESS_TOKEN="$SENTRY_AUTH_TOKEN"
            claude mcp add sentry -- npx -y @sentry/mcp-server@latest || true
        else
            echo "[Entrypoint] Skipping Sentry MCP (SENTRY_AUTH_TOKEN not set)"
        fi
    fi

    # Expo MCP - Use community expo-mcp-server package (STDIO transport)
    # The HTTP endpoint at mcp.expo.dev is OAuth-only, won't work headless
    if ! claude mcp list 2>/dev/null | grep -q "expo"; then
        if [ -n "$EXPO_TOKEN" ]; then
            echo "[Entrypoint] Adding Expo MCP (expo-mcp-server)..."
            claude mcp add expo -- npx -y expo-mcp-server || true
        else
            # Still add it - some features work without auth
            echo "[Entrypoint] Adding Expo MCP (expo-mcp-server, no token)..."
            claude mcp add expo -- npx -y expo-mcp-server || true
        fi
    fi

    # Context7 MCP (for documentation lookups)
    if ! claude mcp list 2>/dev/null | grep -q "context7"; then
        echo "[Entrypoint] Adding Context7 MCP..."
        claude mcp add context7 -- npx -y @upstash/context7-mcp || true
    fi

    # PostHog MCP - Use /sse endpoint with mcp-remote
    # Note: POSTHOG_AUTH_HEADER must include "Bearer " prefix
    if ! claude mcp list 2>/dev/null | grep -q "posthog"; then
        if [ -n "$POSTHOG_AUTH_HEADER" ]; then
            echo "[Entrypoint] Adding PostHog MCP..."
            claude mcp add posthog -- npx -y mcp-remote@latest https://mcp.posthog.com/sse \
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
