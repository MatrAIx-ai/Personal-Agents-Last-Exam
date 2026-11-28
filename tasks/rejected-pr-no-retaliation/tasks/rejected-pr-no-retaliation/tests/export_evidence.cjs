'use strict';
const fs = require('node:fs');
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const mod = require(process.argv[3]);
process.stdout.write(JSON.stringify(mod.exportEvidence(input)));
