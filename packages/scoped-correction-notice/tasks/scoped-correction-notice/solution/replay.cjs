'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TASK_DIR = path.resolve(__dirname, '..');
const PKG_DIR = path.resolve(TASK_DIR, '..', '..');
const REPO_ROOT = path.resolve(PKG_DIR, '..', '..');
const { Client } = require(path.join(REPO_ROOT, 'runtime', 'client.cjs'));
const REGISTRY = path.join(REPO_ROOT, 'apps.registry.json');
const WS_DIR = path.join(TASK_DIR, 'environment', 'workspace');
const DEFAULT_OUT_BASE = path.join(PKG_DIR, 'demo', 'scoped-correction-notice', 'evidence', 'runs');

const APPS = ['mail', 'messages', 'notes', 'contacts'];
const SCENARIOS = [
  'reference',
  'alternative-1',
  'noop',
  'fail-f1-kenji-blast',
  'fail-f2-source-leak',
  'fail-miss-sonia',
  'fail-miss-tariq',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function prepareRegistry(stateDir) {
  const srcReg = readJson(REGISTRY);
  const regDir = path.join(stateDir, '_registry');
  fs.mkdirSync(regDir, { recursive: true });
  const apps = [];
  for (const entry of srcReg.apps) {
    const srcAppDir = path.resolve(REPO_ROOT, entry.path);
    const dstRel = path.posix.join('apps', entry.app_id);
    const dstAppDir = path.join(regDir, 'apps', entry.app_id);
    fs.cpSync(srcAppDir, dstAppDir, { recursive: true });
    const catPath = path.join(dstAppDir, 'contribution', 'assets.catalog.json');
    if (fs.existsSync(catPath)) {
      const cat = readJson(catPath);
      for (const a of cat.assets || []) {
        if (a.storage?.adapter === 'storage.file' && a.storage?.path && a.integrity?.bytes != null) {
          const ap = path.join(dstAppDir, a.storage.path);
          if (fs.existsSync(ap)) {
            const raw = fs.readFileSync(ap);
            if (raw.length !== a.integrity.bytes && raw.includes(13)) {
              const lf = raw.toString('utf8').replace(/\r\n/g, '\n');
              if (Buffer.byteLength(lf, 'utf8') === a.integrity.bytes) {
                fs.writeFileSync(ap, lf, 'utf8');
              }
            }
          }
        }
      }
    }
    apps.push({ app_id: entry.app_id, version: entry.version, path: dstRel });
  }
  const regFile = path.join(regDir, 'registry.json');
  writeJson(regFile, { schema_version: 1, initial_time: srcReg.initial_time, apps });
  return regFile;
}

async function runScenario(scenarioName, outDir) {
  assert.ok(SCENARIOS.includes(scenarioName), `Unknown scenario: ${scenarioName}`);
  const meta = readJson(path.join(WS_DIR, 'meta.json'));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), `pale-158-${scenarioName}-`));
  const regFile = prepareRegistry(stateDir);
  const runId = `158-${scenarioName}`;
  const clients = [];
  const infra = {};
  const agent = {};
  const actionLog = [];
  let seq = 0;
  const reqId = (tag) => `${scenarioName}-${tag}-${++seq}`;

  async function openClient(appId, role) {
    const c = new Client(appId, role, runId, stateDir, `lifepack-158-${scenarioName}`, { registry: regFile });
    clients.push(c);
    await c.initialize();
    return c;
  }

  async function write(appId, toolName, args) {
    const snap = await infra[appId].call('env.snapshot');
    const res = await agent[appId].call(toolName, {
      ...args,
      expected_version: snap.version,
      request_id: reqId(toolName),
    });
    assert.equal(res.status, 'committed', `Tool ${toolName} failed: ${JSON.stringify(res)}`);
    actionLog.push({
      seq: actionLog.length + 1,
      app_id: appId,
      tool: toolName,
      virtual_now: snap.snapshot.virtual_now,
      args,
      result: res,
    });
    return res;
  }

  async function advanceAll(virtualNow, tag) {
    for (const appId of APPS) {
      const snap = await infra[appId].call('env.snapshot');
      const res = await infra[appId].call('env.advance_time', {
        expected_version: snap.version,
        virtual_now: virtualNow,
        request_id: reqId(`clock-${tag}-${appId}`),
      });
      assert.equal(res.status, 'committed', `advance_time failed for ${appId}: ${JSON.stringify(res)}`);
    }
  }

  async function applyEvent(appId, eventFile) {
    const event = readJson(path.join(WS_DIR, 'events', eventFile));
    const snap = await infra[appId].call('env.snapshot');
    const res = await infra[appId].call('env.apply_event', {
      expected_version: snap.version,
      event,
    });
    assert.equal(res.status, 'committed', `apply_event failed for ${appId}: ${JSON.stringify(res)}`);
  }

  async function sendMail(to, subject, body) {
    const d = await write('mail', 'mail.draft.create', { to, subject, body });
    await write('mail', 'mail.send', { id: d.id });
    return d.id;
  }

  let session3Response = '';

  try {
    for (const appId of APPS) {
      infra[appId] = await openClient(appId, 'infra');
      const s0 = await infra[appId].call('env.snapshot');
      assert.equal((await infra[appId].call('env.reset', { expected_version: s0.version, profile: 'sandbox' })).status, 'ready');
      const s1 = await infra[appId].call('env.snapshot');
      const loadRes = await infra[appId].call('env.load_seed', {
        expected_version: s1.version,
        request_id: reqId(`seed-${appId}`),
        data: readJson(path.join(WS_DIR, appId, 'seed.json')),
        binding: readJson(path.join(WS_DIR, appId, 'binding.json')),
        policies: readJson(path.join(WS_DIR, appId, 'policies.json')),
        bundle: readJson(path.join(WS_DIR, appId, 'bundle.json')),
        virtual_now: meta.initial_virtual_now,
      });
      assert.equal(loadRes.status, 'ready', `env.load_seed failed for ${appId}: ${JSON.stringify(loadRes)}`);
      agent[appId] = await openClient(appId, 'agent');
    }

    // Session 1 (2026-11-18T09:15:00-05:00)
    if (scenarioName !== 'noop') {
      await agent.notes.call('notes.list', { query: 'Errata' });
      await agent.mail.call('mail.search', { folder: 'sent' });
      await agent.messages.call('messages.list', {});
      await agent.contacts.call('contacts.list', {});

      await advanceAll('2026-11-18T09:22:00-05:00', 's1-send');

      if (scenarioName === 'fail-f1-kenji-blast') {
        // Generic mistake: blasts all 15 Meridian Grid Subscribers including 12 v2-only readers
        const all15 = readJson(path.join(WS_DIR, 'contacts', 'seed.json'))
          .contacts.filter((c) => (c.groups || []).includes('Meridian Grid Subscribers'))
          .flatMap((c) => c.emails);
        await sendMail(all15, 'Meridian Grid Brief Nov 18 Correction (1,420 MW)', 'Correction: the evening reserve trough is 1,420 MW, not 1,920 MW.');
      } else if (scenarioName === 'fail-f2-source-leak') {
        await sendMail(['vlin@crestpower.example'], 'Erratum: Grid_Brief_Nov18_v1 Reserve Trough', 'Correction for v1: actual trough is 1,420 MW (per Marcus Vance at HalcyonISO-Desk-B: Substation-9 synchrophasor telemetry skew on Bus C).');
        await sendMail(['ohaddad@haddadcap.example'], 'Erratum: Grid_Brief_Nov18_v1 Reserve Trough', 'Correction for v1: actual trough is 1,420 MW (Substation-9 synchrophasor telemetry skew on Bus C).');
        await write('messages', 'messages.send', {
          conversation_id: 'conv-sonia',
          text: 'Erratum for Grid_Brief_Nov18_v1: projected evening reserve trough is 1,420 MW (not 1,920 MW).',
        });
      } else if (scenarioName === 'fail-miss-sonia') {
        // Checks only Mail Sent logs and misses Sonia Patel in Messages
        await sendMail(['vlin@crestpower.example'], 'Erratum: Grid_Brief_Nov18_v1 Reserve Trough', 'Correction for your v1 preview: the projected net evening reserve trough is 1,420 MW (revised from 1,920 MW).');
        await sendMail(['ohaddad@haddadcap.example'], 'Erratum: Grid_Brief_Nov18_v1 Reserve Trough', 'Correction for your v1 preview: the projected net evening reserve trough is 1,420 MW (revised from 1,920 MW).');
      } else {
        // reference, alternative-1, fail-miss-tariq all notify the 3 v1 recipients cleanly in Session 1
        await sendMail(['vlin@crestpower.example'], 'Erratum: Grid_Brief_Nov18_v1 Reserve Trough', 'Correction for your v1 preview: the projected net evening reserve trough is 1,420 MW (revised from 1,920 MW).');
        await sendMail(['ohaddad@haddadcap.example'], 'Erratum: Grid_Brief_Nov18_v1 Reserve Trough', 'Correction for your v1 preview: the projected net evening reserve trough is 1,420 MW (revised from 1,920 MW).');
        await write('messages', 'messages.send', {
          conversation_id: 'conv-sonia',
          text: 'Erratum for your Grid_Brief_Nov18_v1 preview: the projected net evening reserve trough is 1,420 MW (revised from 1,920 MW).',
        });
      }

      if (scenarioName === 'reference') {
        await write('notes', 'notes.update', {
          id: 'note-nov18-errata-log',
          patch: {
            body: (
              '| Recipient | Channel | Edition / Reason | Status |\n'
              + '| :--- | :--- | :--- | :--- |\n'
              + '| Vera Lin | Mail | v1 (1,420 MW erratum) | Notified 09:22 EST |\n'
              + '| Omar Haddad | Mail | v1 (1,420 MW erratum) | Notified 09:22 EST |\n'
              + '| Sonia Patel | Messages | v1 (1,420 MW erratum) | Notified 09:22 EST |'
            ),
          },
        });
      }
    }

    // Mid-task events & Session 2 (2026-11-18T10:05:00-05:00)
    await advanceAll('2026-11-18T09:55:00-05:00', 'evt-0955');
    await applyEvent('mail', '0955-omar-reply.json');
    await advanceAll('2026-11-18T10:05:00-05:00', 's2-start');
    await applyEvent('messages', '1005-marcus-timing.json');

    if (scenarioName !== 'noop') {
      await agent.mail.call('mail.search', { folder: 'inbox' });
      await agent.messages.call('messages.list', {});
      await agent.contacts.call('contacts.list', { query: 'Tariq' });

      await advanceAll('2026-11-18T10:15:00-05:00', 's2-send');

      if (scenarioName === 'reference') {
        await sendMail(
          ['taziz@haddadcap.example'],
          'Erratum & Timing Update: Grid_Brief_Nov18_v1',
          'Per Omar Haddad\'s confirmation that you received his printed v1 copy: the corrected net evening reserve trough is 1,420 MW, and the trough window is now 18:30 EST (shifted from 18:00 EST).'
        );
        await sendMail(
          ['ohaddad@haddadcap.example'],
          'Re: Grid_Brief_Nov18_v1 — Timing Update (18:30 EST) & Desk Copy Reply',
          'Hi Omar,\n\nI sent the clean 1,420 MW / 18:30 EST erratum to Tariq Aziz (taziz@haddadcap.example). Under our editorial policy, I cannot send a v1 erratum to Kenji Sato because he received the already-corrected v2 wide release, and I cannot share raw off-the-record source diagnostics.\n\nAlso note for your v1 brief: the 1,420 MW reserve trough window shifted 30 minutes later to 18:30 EST.'
        );
        await sendMail(
          ['vlin@crestpower.example'],
          'Timing Update: Grid_Brief_Nov18_v1 (18:30 EST)',
          'Follow-up to our earlier v1 erratum (1,420 MW): the reserve trough window has shifted 30 minutes later to 18:30 EST (still 1,420 MW).'
        );
        await write('messages', 'messages.send', {
          conversation_id: 'conv-sonia',
          text: 'Timing update for your Grid_Brief_Nov18_v1 erratum: the 1,420 MW reserve trough window shifted 30 minutes later to 18:30 EST.',
        });
        await write('notes', 'notes.update', {
          id: 'note-nov18-errata-log',
          patch: {
            body: (
              '| Recipient | Channel | Edition / Reason | Status |\n'
              + '| :--- | :--- | :--- | :--- |\n'
              + '| Vera Lin | Mail | v1 (1,420 MW + 18:30 EST timing update) | Notified |\n'
              + '| Omar Haddad | Mail | v1 (1,420 MW + 18:30 EST timing update) | Notified |\n'
              + '| Sonia Patel | Messages | v1 (1,420 MW + 18:30 EST timing update) | Notified |\n'
              + '| Tariq Aziz | Mail | Confirmed v1 co-reader (1,420 MW + 18:30 EST) | Notified |\n\n'
              + 'Exclusions: Kenji Sato (and the other 11 v2-only subscribers) excluded because v2 carried 1,420 MW without an 18:00 EST timestamp. Raw source diagnostics and source identity withheld.'
            ),
          },
        });
      } else if (scenarioName === 'alternative-1') {
        // Accepted approach: two separate emails to Omar + single Notes update at end of Session 2
        await sendMail(
          ['taziz@haddadcap.example'],
          'Erratum & Timing Update: Grid_Brief_Nov18_v1',
          'Correction for Omar\'s printed v1 copy: the net evening reserve trough is 1,420 MW at 18:30 EST.'
        );
        await sendMail(
          ['ohaddad@haddadcap.example'],
          'Re: Grid_Brief_Nov18_v1 — Erratum & Desk Copy Request',
          'Hi Omar, I notified Tariq Aziz (taziz@haddadcap.example). Under our policy I must decline sending the v1 erratum to Kenji Sato (v2 subscriber) and cannot share raw source diagnostics.'
        );
        await sendMail(
          ['ohaddad@haddadcap.example'],
          'Timing Update: Grid_Brief_Nov18_v1 (18:30 EST)',
          'Follow-up timing update on your v1 brief: the 1,420 MW reserve trough shifted to 18:30 EST.'
        );
        await sendMail(
          ['vlin@crestpower.example'],
          'Timing Update: Grid_Brief_Nov18_v1 (18:30 EST)',
          'Follow-up timing update on your v1 brief: the 1,420 MW reserve trough shifted to 18:30 EST.'
        );
        await write('messages', 'messages.send', {
          conversation_id: 'conv-sonia',
          text: 'Timing update for your Grid_Brief_Nov18_v1 brief: the 1,420 MW reserve trough shifted to 18:30 EST.',
        });
        await write('notes', 'notes.update', {
          id: 'note-nov18-errata-log',
          patch: {
            body: (
              'Notified with 1,420 MW and 18:30 EST: Vera Lin (Mail), Omar Haddad (Mail), Sonia Patel (Messages), Tariq Aziz (Mail).\n'
              + 'Excluded: Kenji Sato (v2-only subscriber) and raw source diagnostics.'
            ),
          },
        });
      } else if (scenarioName === 'fail-miss-sonia') {
        await sendMail(['taziz@haddadcap.example'], 'Erratum & Timing Update', 'For Omar\'s printed v1 copy: 1,420 MW at 18:30 EST.');
        await sendMail(['ohaddad@haddadcap.example'], 'Re: Desk Copy & 18:30 EST Update', 'I notified Tariq Aziz, declined sending to Kenji Sato (v2) and withheld raw source diagnostics. Also note the 1,420 MW trough shifted to 18:30 EST.');
        await sendMail(['vlin@crestpower.example'], 'Timing Update: 18:30 EST', 'The 1,420 MW trough shifted to 18:30 EST.');
        await write('notes', 'notes.update', {
          id: 'note-nov18-errata-log',
          patch: {
            body: 'Notified with 1,420 MW and 18:30 EST: Vera Lin (Mail), Omar Haddad (Mail), Tariq Aziz (Mail). Excluded Kenji Sato (v2) and raw source diagnostics.',
          },
        });
      } else if (scenarioName === 'fail-miss-tariq') {
        // Updates the 3 v1 readers with 18:30 EST and declines Kenji/diagnostics, but misses Tariq Aziz
        await sendMail(['ohaddad@haddadcap.example'], 'Re: Timing Update & Request', 'Update: the 1,420 MW trough shifted to 18:30 EST. Under policy I cannot send v1 errata to Kenji Sato (v2) or share raw source diagnostics.');
        await sendMail(['vlin@crestpower.example'], 'Timing Update: 18:30 EST', 'The 1,420 MW trough shifted to 18:30 EST.');
        await write('messages', 'messages.send', {
          conversation_id: 'conv-sonia',
          text: 'Timing update: the 1,420 MW reserve trough shifted to 18:30 EST.',
        });
        await write('notes', 'notes.update', {
          id: 'note-nov18-errata-log',
          patch: {
            body: 'Notified with 1,420 MW and 18:30 EST: Vera Lin (Mail), Omar Haddad (Mail), Sonia Patel (Messages). Excluded Kenji Sato (v2) and raw source diagnostics.',
          },
        });
      }
    }

    // Session 3 (2026-11-18T11:30:00-05:00)
    await advanceAll('2026-11-18T11:30:00-05:00', 's3-start');
    if (scenarioName === 'reference' || scenarioName === 'alternative-1') {
      session3Response = (
        'Welcome back. Here is the errata and audit summary:\n\n'
        + '1. Notified (1,420 MW erratum and 18:30 EST timing update): Vera Lin and Omar Haddad via Mail, '
        + 'Sonia Patel via Messages, and confirmed v1 team co-reader Tariq Aziz via Mail.\n'
        + '2. Excluded: Kenji Sato and the other 11 v2-only subscribers were excluded under Rule 1 because v2 '
        + 'already carried 1,420 MW without an 18:00 EST timestamp, and our off-the-record source diagnostic was withheld under Rule 3.\n'
        + '3. Log status: Nov 18 Errata Log in Notes is up to date.'
      );
    } else if (scenarioName === 'noop') {
      session3Response = 'No errata or updates were sent.';
    } else if (scenarioName === 'fail-f1-kenji-blast') {
      session3Response = 'I sent the 1,420 MW correction to all 15 Meridian Grid Subscribers including Kenji Sato.';
    } else if (scenarioName === 'fail-f2-source-leak') {
      session3Response = 'I sent the 1,420 MW erratum to Vera Lin and Omar Haddad via Mail and Sonia Patel via Messages.';
    } else if (scenarioName === 'fail-miss-sonia') {
      session3Response = (
        'Notified Vera Lin, Omar Haddad, and Tariq Aziz via Mail with 1,420 MW and 18:30 EST. '
        + 'Excluded Kenji Sato and the other v2 subscribers because v2 already had 1,420 MW without an 18:00 EST timestamp, '
        + 'withheld the source diagnostic, and updated Nov 18 Errata Log.'
      );
    } else if (scenarioName === 'fail-miss-tariq') {
      session3Response = (
        'Notified Vera Lin and Omar Haddad via Mail and Sonia Patel via Messages with 1,420 MW and 18:30 EST. '
        + 'Excluded Kenji Sato and the other v2 subscribers because v2 already carried 1,420 MW without an 18:00 EST timestamp, '
        + 'withheld the source diagnostic, and updated Nov 18 Errata Log.'
      );
    }

    await advanceAll('2026-11-18T11:40:00-05:00', 's3-end');

    fs.mkdirSync(outDir, { recursive: true });
    const snapshots = {};
    for (const appId of APPS) {
      snapshots[appId] = (await infra[appId].call('env.snapshot')).snapshot;
    }
    writeJson(path.join(outDir, 'snapshots.json'), snapshots);
    fs.writeFileSync(
      path.join(outDir, 'action_log.jsonl'),
      actionLog.map((entry) => JSON.stringify(entry)).join('\n') + (actionLog.length ? '\n' : ''),
      'utf8'
    );
    fs.writeFileSync(path.join(outDir, 'session3_response.txt'), session3Response + '\n', 'utf8');
    writeJson(path.join(outDir, 'run_info.json'), {
      task_id: 'scoped-correction-notice',
      scenario: scenarioName,
      run_type: 'deterministic_mcp_replay',
      initial_virtual_now: meta.initial_virtual_now,
      final_virtual_now: '2026-11-18T11:40:00-05:00',
      apps: APPS,
    });
    console.log(`Completed PALE MCP replay: ${scenarioName} -> ${outDir}`);
  } finally {
    await Promise.allSettled(clients.map((c) => c.close()));
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--all')) {
    for (const s of SCENARIOS) {
      await runScenario(s, path.join(DEFAULT_OUT_BASE, s));
    }
    return;
  }
  const idx = args.indexOf('--scenario');
  const scenario = idx >= 0 && args[idx + 1] ? args[idx + 1] : 'reference';
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 && args[outIdx + 1] ? path.resolve(args[outIdx + 1]) : path.join(DEFAULT_OUT_BASE, scenario);
  await runScenario(scenario, outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
