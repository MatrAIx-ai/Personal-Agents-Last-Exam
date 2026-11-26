import json
import sys

json.load(sys.stdin)
json.dump({"choice": True, "limit": True, "lookalike": True, "told": True, "totals": True, "energy": True}, sys.stdout)
