FROM node:24

ARG TZ
ENV TZ="$TZ"
ENV IS_SANDBOX=1

ARG CLAUDE_CODE_VERSION=latest
ARG GITHUB_TOKEN

# Install basic development tools and iptables/ipset
RUN apt-get update && apt-get install -y --no-install-recommends \
  less \
  git \
  procps \
  sudo \
  fzf \
  zsh \
  man-db \
  unzip \
  gnupg2 \
  gh \
  iptables \
  ipset \
  iproute2 \
  dnsutils \
  aggregate \
  jq \
  nano \
  vim \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Claude CLI
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/root/.local/bin:$PATH"

# Claude config directory (mount Railway volume here for credentials)
RUN mkdir -p /claude-config
ENV CLAUDE_CONFIG_DIR="/claude-config"

# Install uv/uvx for langfuse MCP
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

# Install bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Clone hivemind-claude-code-setup for agents, commands, and templates
# Uses GITHUB_TOKEN build arg for private repo access
RUN git clone --depth 1 https://oauth2:${GITHUB_TOKEN}@github.com/Hivemind-Edu/hivemind-claude-code-setup.git \
    /opt/claude-setup

# Install agents and commands
# Using --update to skip MCP installation (MCPs configured at runtime)
# install.sh writes to $HOME/.claude, but Claude uses CLAUDE_CONFIG_DIR
RUN cd /opt/claude-setup && ./install.sh --update --full \
    && cp -r /root/.claude/* /claude-config/ 2>/dev/null || true

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install

COPY . .

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bun", "run", "src/index.ts"]
