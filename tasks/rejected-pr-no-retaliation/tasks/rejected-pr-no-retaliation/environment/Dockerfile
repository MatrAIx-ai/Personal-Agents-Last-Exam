# Harbor image for rejected-pr-no-retaliation.
# Written, not run. This delivery was verified with the local stand-in runner on the host.
# Build context is the PALE repository root:
#   docker build -f tasks/rejected-pr-no-retaliation/tasks/rejected-pr-no-retaliation/environment/Dockerfile .
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /pale
COPY package.json apps.registry.json ./
COPY runtime ./runtime
COPY apps ./apps
COPY examples/apps ./examples/apps
COPY tasks/rejected-pr-no-retaliation/tasks/rejected-pr-no-retaliation/environment /task/environment
COPY tasks/rejected-pr-no-retaliation/tasks/rejected-pr-no-retaliation/context/timeline.yaml /task/context/timeline.yaml
ENV PALE_REPO_ROOT=/pale
