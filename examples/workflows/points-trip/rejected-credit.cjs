'use strict';
// A separate run: Skyline's account carries another member number, so the receiver refuses the
// credit. Messaging halts that run; the sender then refunds in its own commit, exactly once.
async function run({open, load, sandbox, write, event, router, deliver, version, equal, ok, T}) {
  const waypoint = await open('waypoint', 'agent', 'rejected'), waypointInfra = await open('waypoint', 'infra', 'rejected');
  const skylineInfra = await open('skyline', 'infra', 'rejected');
  await load(skylineInfra, data => ({...data, member_number:'SK-00000000'}));
  await sandbox(waypointInfra); await sandbox(skylineInfra);
  const skylineBefore = (await skylineInfra.call('env.snapshot')).snapshot.data;
  const before = (await waypoint.call('waypoint.balance', {})).balance;
  const t = await write(waypoint, waypointInfra, 'waypoint.transfer', {partner_id:'skyline', points:T.rejected_points});
  equal('Points leave the balance when the transfer is made', (await waypoint.call('waypoint.balance', {})).balance, before - T.rejected_points);
  const bridge = await router('daniel-config.json', 'waypoint', 'rejected');
  const [result] = await deliver(waypoint, waypointInfra, bridge);
  ok('Skyline refuses a credit for another member number and Messaging halts the run',
    result.receipt.code === 'receiver_rejected' && result.receipt.reason === 'permission_denied' && result.receipt.stop_run === true);
  equal('The refused credit leaves Skyline unchanged', (await skylineInfra.call('env.snapshot')).snapshot.data, skylineBefore);
  const item = (await waypoint.call('waypoint.transfers.get', {id:t.id})).item;
  equal('The sender records the rejection and refunds in a separate entry', [item.status, item.rejection.code,
    (await waypoint.call('waypoint.balance', {})).balance], ['rejected', 'receiver_rejected', before]);
  const replay = await waypointInfra.call('env.apply_event', {expected_version:await version(waypointInfra),
    event:{event_id:'settle-' + t.id, at:item.settled_at, operation:'waypoint.transfer.settle',
      payload:{transfer_id:t.id, outcome:'rejected', rejection:item.rejection}}});
  ok('Replaying the settlement returns the original receipt and refunds nothing more', replay.duplicate === true);
  equal('Balance after the replay', (await waypoint.call('waypoint.balance', {})).balance, before);
  equal('The halted run accepts no further delivery', (await bridge.call('router.publish', {request_id:'after-halt', message:result.message})).code, 'run_halted');
  return {transfer:t.id, receipt:result.receipt, refund_ledger_id:item.refund_ledger_id};
}
module.exports = {run};
