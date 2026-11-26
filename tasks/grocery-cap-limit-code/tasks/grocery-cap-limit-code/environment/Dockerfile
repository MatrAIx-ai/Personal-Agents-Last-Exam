# Build this file with the environment directory as the context.
# The image contains the task Apps and workspace. Tests, rubrics, plans and grader stay outside it.
# The image has not been built in this package.
FROM node:22-bookworm@sha256:7c400d78797d8cbe3f6bb21d2227b86af4cd24b0014cc9f62ff989cc16de988e
WORKDIR /app
COPY apps /app/apps
COPY workspace /app/workspace
CMD ["node", "--version"]
