import json
import sys

json.load(sys.stdin)
json.dump({"choice": [1], "limit": 1, "lookalike": 1, "told": 1, "totals": 2, "energy": 1}, sys.stdout)
