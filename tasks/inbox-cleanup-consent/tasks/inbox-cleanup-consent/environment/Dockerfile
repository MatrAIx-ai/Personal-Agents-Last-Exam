# Status: written, not run. The tested path is the package-local stand-in runner.
# Build context is the PALE repository root:
#   docker build -f tasks/inbox-cleanup-consent/tasks/inbox-cleanup-consent/environment/Dockerfile .
FROM node:22-bookworm-slim
WORKDIR /pale
COPY package.json apps.registry.json ./
COPY runtime ./runtime
COPY apps ./apps
COPY examples/apps ./examples/apps
COPY tasks/inbox-cleanup-consent/tasks/inbox-cleanup-consent/environment /task/environment
COPY tasks/inbox-cleanup-consent/tasks/inbox-cleanup-consent/instruction.md /task/instruction.md
COPY tasks/inbox-cleanup-consent/tasks/inbox-cleanup-consent/context /task/context
ENV PALE_REPO_ROOT=/pale
