# Environment for fellowship-letter-reminders.
# STATUS: written but NOT built or tested (no Docker on the authoring host; see the package
# README "Pending"). The tested execution mode is the local stand-in runner on the host:
# Node.js 22.22.1 + Python 3.12, PALE checkout at the revision named in manifest.json.
# Build context: the PALE repository root, e.g.
#   docker build -f lifepacks/fellowship-letter-reminders/tasks/fellowship-letter-reminders/environment/Dockerfile .
# TODO(pin): replace the tag with an image digest once built by the infrastructure release.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /pale
# Shipped runtime + Apps only (no tests/, solution/ or demo/ of this task inside the agent image).
COPY package.json apps.registry.json ./
COPY runtime ./runtime
COPY apps ./apps
COPY examples/apps ./examples/apps
COPY lifepacks/fellowship-letter-reminders/tasks/fellowship-letter-reminders/environment /task/environment
COPY lifepacks/fellowship-letter-reminders/tasks/fellowship-letter-reminders/context/timeline.yaml /task/context/timeline.yaml
ENV PALE_REPO_ROOT=/pale
