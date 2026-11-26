FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-yaml && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --home-dir /home/agent --shell /bin/bash agent

WORKDIR /workspace
# Copy ONLY the agent-visible App workspace seeds/events (never tests/, solution/, hints.md, or private scripts).
COPY workspace/ /workspace/task/workspace/
RUN chown -R agent:agent /workspace

USER agent
ENV HOME=/home/agent
ENV PALE_TASK_ID=scoped-correction-notice
ENV TZ=America/New_York
