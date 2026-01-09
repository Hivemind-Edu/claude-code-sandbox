FROM node:24

ARG TZ
ENV TZ="$TZ"
ENV IS_SANDBOX=1

ARG CLAUDE_CODE_VERSION=latest

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

# Claude config directory (mount Railway volume here)
RUN mkdir -p /claude-config
ENV CLAUDE_CONFIG_DIR="/claude-config"

# Install bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install

COPY . .

CMD ["bun", "run", "src/index.ts"]
