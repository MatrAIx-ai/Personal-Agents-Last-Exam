#!/bin/bash
# Isolation probe for a build made by to-harbor.cjs.
#
#   node scripts/lifepack/to-harbor.cjs <task> --out <dir> --probe
#   harbor run -p <dir> -a oracle          # the output is in steps/<session>/agent/oracle.txt
#
# With --probe, each step runs this file in place of the reference solution, as the agent's account.
# It does what a curious agent could do from a shell: look for task files, try to read the App state,
# try the management commands, and try to misuse the door. It changes no records.
# Each line ends up as PASS (closed) or FAIL (open). The last line counts the FAIL lines.
#
# Usage: probe.sh SESSION_ID LATER_EVENT_IDS_BASE64 APP,APP,...
# The IDs of later events are passed encoded, so that the search below does not find this script's own command line.
session="${1:-?}"
later="$(printf %s "${2:-}" | base64 -d 2>/dev/null || true)"
apps="${3:-}"
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails + 1)); }
# closed WHAT COMMAND...: PASS when the command fails.
closed() {
  local what="$1" out
  shift
  if out="$("$@" 2>&1 </dev/null)"; then
    fail "$what  -> it worked: $(printf %s "$out" | head -c 160)"
  else
    pass "$what  [$(printf %s "$out" | tail -n 1 | head -c 110)]"
  fi
}

echo "session $session   account: $(id -un) (uid $(id -u))   directory: $(pwd)"

echo "-- what the agent can see"
if [ "$(id -u)" != 0 ]; then pass "the agent's account is not root"; else fail "the agent runs as root"; fi

left="$(ls -A . 2>/dev/null | tr '\n' ' ')"
if [ -z "$left" ]; then pass "the working directory is empty"; else fail "the working directory holds: $left"; fi

found="$(find / -xdev \( -path /proc -o -path /sys -o -path /usr -o -path /opt/pale -o -path /solution -o -path "$HOME/.nvm" \) -prune -o -type f \
  \( -name '.pale-step.json' -o -name 'instruction.md' -o -name 'hints.md' -o -name 'rubrics*' -o -name 'rules.json' -o -name 'reference.json' \
     -o -name 'test_outcomes*' -o -name 'task.toml' -o -name 'timeline.yaml' -o -name 'script.json' \) -print 2>/dev/null | head -n 20 | tr '\n' ' ')"
if [ -z "$found" ]; then pass "no task, test, hint or user-script file is readable"; else fail "readable task files: $found"; fi

t="$(ls -A /tests 2>/dev/null | tr '\n' ' ')"
if [ -z "$t" ]; then pass "/tests is absent or empty"; else fail "/tests holds: $t"; fi
v="$(ls -A /logs/verifier 2>/dev/null | tr '\n' ' ')"
if [ -z "$v" ]; then pass "/logs/verifier is absent or empty"; else fail "/logs/verifier holds: $v"; fi
a="$(ls -A /logs/artifacts 2>/dev/null | tr '\n' ' ')"
if [ -z "$a" ]; then pass "/logs/artifacts holds no earlier snapshot"; else fail "/logs/artifacts holds: $a"; fi

if [ -n "$later" ]; then
  while read -r id; do
    [ -z "$id" ] && continue
    hit="$(grep -rlF --exclude-dir=proc --exclude-dir=sys --exclude-dir=dev -- "$id" / 2>/dev/null | head -n 5 | tr '\n' ' ')"
    if [ -z "$hit" ]; then pass "later event $id is in no readable file"; else fail "later event $id is readable in: $hit"; fi
  done <<< "$later"
else
  echo "      (no event is due after this session)"
fi

echo "-- App state and task data"
closed "read the App state directory" ls /var/pale/state
closed "read the task's private data" cat /opt/pale-task/private/task.json
closed "read the snapshot handed to the verifier" ls /var/pale/collect
closed "replace the snapshot handed to the verifier" touch /var/pale/collect/state.json
closed "write into the scripts folder" touch /opt/pale-task/probe-write
closed "write into the runtime folder" touch /opt/pale/probe-write

echo "-- management commands"
infra_snapshot() {
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"env.snapshot","arguments":{}}}' \
    | timeout 20 node /opt/pale/runtime/mcp-server.cjs --app "$1" --role infra --run task --state-dir /var/pale/state --registry /opt/pale/apps.registry.json 2>&1 \
    | grep -q '"virtual_now"'
}
first_app="${apps%%,*}"
closed "take a snapshot with the management script" node /opt/pale-task/pale-task.cjs snapshot /tmp/probe-snapshot.json
closed "start an App server on the Infra connection" infra_snapshot "$first_app"

echo "-- sudo"
closed "sudo to root" sudo -n true
closed "sudo: a shell as the service account" sudo -n -u pale /bin/sh -c id
closed "sudo: the management script as the service account" sudo -n -u pale node /opt/pale-task/pale-task.cjs snapshot /tmp/probe-snapshot.json

echo "-- the door"
closed "door: a management command" sudo -n -u pale /opt/pale-task/door snapshot /tmp/probe-snapshot.json
closed "door: a name with extra options" sudo -n -u pale /opt/pale-task/door mcp "$first_app --role infra"
closed "door: another state directory through the environment" env PALE_STATE_DIR=/tmp sudo -n --preserve-env=PALE_STATE_DIR -u pale /opt/pale-task/door mcp "$first_app"
closed "door: open a session with made-up step data" sh -c 'echo "{\"id\":\"s9\",\"at\":\"2030-01-01T00:00:00+00:00\",\"opening\":\"x\",\"events\":[],\"replies\":[]}" | pale-session'

echo "-- the intended way still works"
if out="$(node -e '
const { withConns } = require("/opt/pale-task/lib.cjs");
const names = process.argv[1].split(",").filter(Boolean);
withConns("agent", "probe", async (open) => {
  for (const name of names) {
    const r = await (await open(name)).request("tools/list");
    const tools = (r.result && r.result.tools) || [];
    if (!tools.length) throw new Error(name + ": no tools");
    const infra = tools.filter((t) => t.name.startsWith("env."));
    if (infra.length) throw new Error(name + ": management tools are listed: " + infra.map((t) => t.name).join(", "));
  }
  console.log(names.length + " connections, no management tools listed");
}).then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
' "$apps,chat" 2>&1)"; then
  pass "every App and the chat answer through pale-mcp  [$out]"
else
  fail "pale-mcp does not work: $(printf %s "$out" | tail -n 1 | head -c 160)"
fi

echo "RESULT session $session: $fails open"
exit 0
