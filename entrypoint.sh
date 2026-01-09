#!/bin/bash
#
# Entrypoint script for claude-code-sandbox
# Configures MCP servers on first run (they persist in /claude-config volume)
#

set -e

MCP_CONFIGURED_FLAG="/claude-config/.mcp-configured-v4"

configure_mcps() {
    echo "[Entrypoint] Configuring MCP servers..."

    # Remove old MCP configs to ensure fresh setup
    claude mcp remove sentry 2>/dev/null || true
    claude mcp remove expo-mcp 2>/dev/null || true
    claude mcp remove expo 2>/dev/null || true
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

    # Expo MCP - HTTP transport requires OAuth (browser login)
    # Won't work in headless containers without pre-authenticated session
    # Skipping in Railway - use Context7 for Expo docs instead
    echo "[Entrypoint] Skipping Expo MCP (requires OAuth browser login)"

    # Context7 MCP (for documentation lookups)
    if ! claude mcp list 2>/dev/null | grep -q "context7"; then
        echo "[Entrypoint] Adding Context7 MCP..."
        claude mcp add context7 -- npx -y @upstash/context7-mcp || true
    fi

    # PostHog MCP - Use mcp-remote with Streamable HTTP endpoint
    # Note: POSTHOG_AUTH_HEADER must include "Bearer " prefix (e.g., "Bearer phx_...")
    # API key must have "MCP Server" preset permissions from PostHog settings
    # EU cloud users: mcp.posthog.com won't work - need self-hosted MCP
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
