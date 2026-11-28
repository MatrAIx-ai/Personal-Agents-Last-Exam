# Harbor image for rejected-pr-no-retaliation.
# The Node line matches the host used for the local runs. Official Harbor runs wait on the shared image.
# Build context is the PALE repository root:
#   docker build -f tasks/rejected-pr-no-retaliation/tasks/rejected-pr-no-retaliation/environment/Dockerfile .
FROM node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /pale
COPY package.json apps.registry.json ./
COPY runtime ./runtime
COPY apps ./apps
COPY examples/apps ./examples/apps
COPY tasks/rejected-pr-no-retaliation/.deps /pale/tasks/rejected-pr-no-retaliation/.deps
COPY tasks/rejected-pr-no-retaliation/tasks/rejected-pr-no-retaliation/environment/apps/web /pale/tasks/rejected-pr-no-retaliation/tasks/rejected-pr-no-retaliation/environment/apps/web
COPY tasks/rejected-pr-no-retaliation/tasks/rejected-pr-no-retaliation/environment /task/environment
COPY tasks/rejected-pr-no-retaliation/tasks/rejected-pr-no-retaliation/instruction.md /task/instruction.md
COPY tasks/rejected-pr-no-retaliation/tasks/rejected-pr-no-retaliation/context /task/context
COPY tasks/rejected-pr-no-retaliation/tasks/rejected-pr-no-retaliation/tests/judge /task/tests/judge
ENV PALE_REPO_ROOT=/pale
