FROM docker.io/cloudflare/sandbox:0.6.10

# Install system packages (postgresql-client, redis-cli)
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
    redis-tools \
    unzip \
    openjdk-17-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

# Install Bun (https://bun.sh/docs/installation)
RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL="/root/.bun"
ENV PATH="$BUN_INSTALL/bin:$PATH"

# Install Maestro (https://maestro.mobile.dev/getting-started/installing-maestro)
# Requires Java 11+ (installed above)
RUN curl -Ls "https://get.maestro.mobile.dev" | bash
ENV PATH="/root/.maestro/bin:$PATH"

# Install Railway CLI (https://docs.railway.app/guides/cli)
RUN curl -fsSL https://railway.app/install.sh | sh
ENV PATH="/root/.railway/bin:$PATH"

# Install Claude Code
RUN npm install -g @anthropic-ai/claude-code

# 20 minutes timeout for Claude tasks
ENV COMMAND_TIMEOUT_MS=1200000
EXPOSE 3000
