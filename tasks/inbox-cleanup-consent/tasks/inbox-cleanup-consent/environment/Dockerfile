# Harbor execution is pending. The tested path is the package-local stand-in runner.
# Build context is the PALE repository root:
#   docker build -f tasks/inbox-cleanup-consent/tasks/inbox-cleanup-consent/environment/Dockerfile .
FROM node:22-bookworm-slim
WORKDIR /pale
COPY package.json apps.registry.json ./
COPY runtime ./runtime
COPY apps ./apps
COPY examples/apps ./examples/apps
COPY tasks/inbox-cleanup-consent/tasks/inbox-cleanup-consent/environment/workspace/mail /task/environment/workspace/mail
COPY tasks/inbox-cleanup-consent/tasks/inbox-cleanup-consent/environment/workspace/notes/seed-a.json /task/environment/workspace/notes/seed-a.json
COPY tasks/inbox-cleanup-consent/tasks/inbox-cleanup-consent/environment/workspace/notes/binding.json /task/environment/workspace/notes/binding.json
COPY tasks/inbox-cleanup-consent/tasks/inbox-cleanup-consent/environment/workspace/notes/policies.json /task/environment/workspace/notes/policies.json
COPY tasks/inbox-cleanup-consent/tasks/inbox-cleanup-consent/environment/workspace/meta.json /task/environment/workspace/meta.json
COPY tasks/inbox-cleanup-consent/tasks/inbox-cleanup-consent/environment/interface /task/environment/interface
COPY tasks/inbox-cleanup-consent/tasks/inbox-cleanup-consent/instruction.md /task/instruction.md
COPY tasks/inbox-cleanup-consent/tasks/inbox-cleanup-consent/context/user/persona.json /task/context/user/persona.json
COPY tasks/inbox-cleanup-consent/tasks/inbox-cleanup-consent/context/user/history.json /task/context/user/history.json
COPY tasks/inbox-cleanup-consent/tasks/inbox-cleanup-consent/context/permissions.yaml /task/context/permissions.yaml
ENV PALE_REPO_ROOT=/pale
