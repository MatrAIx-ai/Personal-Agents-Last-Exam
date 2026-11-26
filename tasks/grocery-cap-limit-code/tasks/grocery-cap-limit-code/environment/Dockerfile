# Build this file with the environment directory as the context.
# The image contains the task Apps and the workspace the agent may see.
# Future Friday messages stay in the task context and are delivered when they are due.
# Tests, rubrics, plans and the grader stay outside the image.
# The image has not been built in this package. Harbor image builds wait on infrastructure 135.
FROM node:22-bookworm@sha256:7c400d78797d8cbe3f6bb21d2227b86af4cd24b0014cc9f62ff989cc16de988e
WORKDIR /app
COPY apps /app/apps
COPY workspace /app/workspace
CMD ["node", "--version"]
