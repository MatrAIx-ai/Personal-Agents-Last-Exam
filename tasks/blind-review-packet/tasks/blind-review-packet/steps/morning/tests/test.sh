#!/bin/sh
set -eu
node - <<'JS'
const fs = require('node:fs');
const {request} = require('/usr/local/lib/packet.cjs');
request({op:'close',session:'morning'}, '/run/packet-private/control.sock').then(() => {
  fs.writeFileSync('/logs/verifier/reward.json', JSON.stringify({checkpoint_recorded:1}));
}).catch(e=>{console.error(e.message);process.exitCode=1;});
JS
