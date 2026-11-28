#!/bin/bash
# Run once in the image build, as root, after pale/ and pale-task/ are copied in:
#
#   RUN bash /opt/pale-task/install.sh
#
# It separates the agent from the Apps with ordinary Unix accounts:
#   pale    owns the App state. No other account can read it.
#   agent   the account the evaluated agent runs as (task.toml: [agent] user = "agent").
#           It reaches the Apps only through /opt/pale-task/door, which sudo runs as pale.
# The image needs node, sudo and the standard account tools (useradd, runuser).
set -euo pipefail

TASK_DIR=/opt/pale-task
STATE_DIR=/var/pale/state
AGENT_USER="${1:-agent}"

for tool in node sudo visudo useradd runuser; do
  command -v "$tool" >/dev/null || { echo "install.sh: \"$tool\" is missing from the image" >&2; exit 1; }
done

useradd --system --user-group --home-dir /var/pale --no-create-home --shell /usr/sbin/nologin pale
id "$AGENT_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$AGENT_USER"

# The runtime and the scripts are public code: readable by all, writable by root only.
# The task's records and the checks for each session's step data are for the service account only.
chown -R root:root /opt/pale "$TASK_DIR"
chmod -R u=rwX,go=rX /opt/pale "$TASK_DIR"
chown -R root:pale "$TASK_DIR/private"
chmod -R u=rwX,g=rX,o= "$TASK_DIR/private"
chmod 755 "$TASK_DIR/door"

install -d -o root -g root -m 755 /var/pale
install -d -o pale -g pale -m 700 "$STATE_DIR"
# After each session Harbor runs the snapshot command as root and collects the file from here for the verifier.
install -d -o root -g root -m 700 /var/pale/collect

cat > /usr/local/bin/pale-mcp <<'SH'
#!/bin/sh
# pale-mcp NAME: the agent connection of one App, or of the user chat (NAME = chat), as an MCP server over stdio.
exec sudo -n -u pale /opt/pale-task/door mcp "$@"
SH
cat > /usr/local/bin/pale-session <<'SH'
#!/bin/sh
# pale-session: opens the next session. Reads the step data from standard input. Each step's setup.sh calls it.
exec sudo -n -u pale /opt/pale-task/door session
SH
chmod 755 /usr/local/bin/pale-mcp /usr/local/bin/pale-session

cat > /etc/sudoers.d/pale-door <<'SUDOERS'
# Any account may run the door as the service account "pale". Nothing else is granted.
Defaults!/opt/pale-task/door !use_pty
ALL ALL=(pale) NOPASSWD: /opt/pale-task/door
SUDOERS
chmod 440 /etc/sudoers.d/pale-door
visudo -cf /etc/sudoers.d/pale-door >/dev/null

# Load the starting records once. Every rollout starts a new container from this state.
runuser -u pale -- env PALE_ROOT=/opt/pale PALE_TASK_DIR="$TASK_DIR" PALE_STATE_DIR="$STATE_DIR" \
  node "$TASK_DIR/pale-task.cjs" init

# The agent's working directory. Harbor copies each step's files here and runs setup.sh as the agent's account.
install -d -m 755 /workspace
chown "$AGENT_USER": /workspace
