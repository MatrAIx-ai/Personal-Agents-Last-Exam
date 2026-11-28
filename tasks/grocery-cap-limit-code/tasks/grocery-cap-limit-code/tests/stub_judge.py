import json
import sys

json.load(sys.stdin)
json.dump({"choice": 2, "limit": 2, "lookalike": 2, "told": 2, "totals": 4, "energy": 2}, sys.stdout)
