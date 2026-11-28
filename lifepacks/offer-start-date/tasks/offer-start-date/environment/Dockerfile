# The image holds the public runtime, the seven Apps and this task's starting records.
# scripts/lifepack/to-harbor.cjs places two folders next to this file before the build:
#   pale/       runtime/, apps/, examples/apps/ and apps.registry.json from the repository checkout
#   pale-task/  the load payload for each App, the management scripts and install.sh
# node:22-bookworm-slim, pinned by digest so every build starts from the same image.
FROM node@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb

# Agent command-line tools are installed into the container by Harbor and need ca-certificates, curl and git.
# install.sh needs sudo: the agent's account reaches the Apps through one sudo rule.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git sudo \
 && rm -rf /var/lib/apt/lists/*

COPY pale/ /opt/pale/
COPY pale-task/ /opt/pale-task/

ENV PALE_ROOT=/opt/pale \
    PALE_TASK_DIR=/opt/pale-task \
    PALE_STATE_DIR=/var/pale/state

# Create the accounts "pale" (owns the App state) and "agent" (the evaluated agent), close the state off
# from the agent, and load the starting records. Every rollout starts a new container from this state.
RUN bash /opt/pale-task/install.sh

WORKDIR /workspace
