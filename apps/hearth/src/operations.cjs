'use strict';
/**
 * Business logic implementation for Hearth MCP tools and Infra events.
 */
const { clone, deriveStateForRead, commitDerivedState } = require('./state.cjs');

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  throw err;
}

function handleToolCall(ctx, state, toolName, params = {}) {
  const virtualNow = ctx && ctx.virtual_now;

  // Read operations derive projection from ctx.virtual_now and NEVER mutate state
  if (toolName.startsWith('hearth.get_') || toolName.startsWith('hearth.list_')) {
    const projected = deriveStateForRead(state, virtualNow);

    switch (toolName) {
      case 'hearth.get_property':
        return {
          data: state,
          result: {
            property: projected.property,
            rooms: projected.rooms,
            budget: projected.budget,
            purchases: projected.purchases,
          },
        };

      case 'hearth.get_room': {
        const room = projected.rooms.find((r) => r.id === params.room_id);
        if (!room) {
          fail('room_not_found', `Room ${params.room_id} does not exist.`);
        }
        const activeItems = projected.inventory.filter(
          (i) => i.room_id === params.room_id && i.status === 'active'
        );
        return {
          data: state,
          result: { room, active_items: activeItems },
        };
      }

      case 'hearth.list_inventory': {
        let items = projected.inventory;
        if (params.room_id) items = items.filter((i) => i.room_id === params.room_id);
        if (params.category) items = items.filter((i) => i.category === params.category);
        if (params.status) items = items.filter((i) => i.status === params.status);
        return {
          data: state,
          result: { items },
        };
      }

      case 'hearth.list_maintenance_issues': {
        let issues = projected.maintenance_issues;
        if (params.status) issues = issues.filter((i) => i.status === params.status);
        return {
          data: state,
          result: { issues },
        };
      }

      case 'hearth.get_resident_profile': {
        const resident = projected.residents.find((r) => r.person_id === params.person_id);
        if (!resident) {
          fail('resident_not_found', `Resident ${params.person_id} not found.`);
        }
        return {
          data: state,
          result: { resident },
        };
      }

      default:
        fail('unknown_tool', `Tool ${toolName} not recognized.`);
    }
  }

  // Write operations mutate a cloned state and commit derived expiries
  const newState = clone(state);
  commitDerivedState(newState, virtualNow);

  switch (toolName) {
    case 'hearth.update_item_placement': {
      const item = newState.inventory.find((i) => i.id === params.item_id);
      if (!item) fail('item_not_found', `Item ${params.item_id} not found.`);
      if (item.status === 'disposed') fail('item_already_disposed', `Item ${params.item_id} is already disposed.`);

      const room = newState.rooms.find((r) => r.id === params.room_id);
      if (!room) fail('room_not_found', `Room ${params.room_id} does not exist.`);

      const [x, y] = params.coordinates || [];
      if (
        !Array.isArray(params.coordinates) ||
        params.coordinates.length !== 2 ||
        x < 0 ||
        y < 0 ||
        x >= room.dimensions_cm[0] ||
        y >= room.dimensions_cm[1]
      ) {
        fail(
          'coordinates_out_of_bounds',
          `Coordinates [${x}, ${y}] are outside ${room.name} (${room.dimensions_cm[0]}x${room.dimensions_cm[1]} cm).`
        );
      }

      item.room_id = params.room_id;
      item.coordinates = params.coordinates;
      item.status = 'active';

      return {
        data: newState,
        result: { item },
      };
    }

    case 'hearth.store_item': {
      const item = newState.inventory.find((i) => i.id === params.item_id);
      if (!item) fail('item_not_found', `Item ${params.item_id} not found.`);
      if (item.status === 'disposed') fail('item_already_disposed', `Item ${params.item_id} is already disposed.`);

      const room = newState.rooms.find((r) => r.id === params.storage_room_id);
      if (!room || !room.is_storage) {
        fail('invalid_storage_location', `Room ${params.storage_room_id} is not a valid storage location.`);
      }

      item.room_id = params.storage_room_id;
      item.status = 'stored';
      item.coordinates = null;

      return {
        data: newState,
        result: { item },
      };
    }

    case 'hearth.dispose_item': {
      const item = newState.inventory.find((i) => i.id === params.item_id);
      if (!item) fail('item_not_found', `Item ${params.item_id} not found.`);
      if (item.status === 'disposed') fail('item_already_disposed', `Item ${params.item_id} is already disposed.`);

      item.status = 'disposed';
      item.disposal_reason = params.reason;
      item.disposed_at = virtualNow || new Date().toISOString();

      return {
        data: newState,
        result: { item },
      };
    }

    case 'hearth.request_purchase': {
      const room = newState.rooms.find((r) => r.id === params.target_room_id);
      if (!room) fail('room_not_found', `Target room ${params.target_room_id} does not exist.`);

      const available = newState.budget.total_cap - (newState.budget.spent + newState.budget.reserved);
      if (params.cost_usd > available) {
        fail('budget_exceeded', `Cost exceeds available budget cap ($${available} remaining).`);
      }

      const nowTime = virtualNow ? new Date(virtualNow).getTime() : Date.now();
      const expiresAt = new Date(nowTime + 48 * 3600 * 1000).toISOString();

      const newPurchase = {
        id: `purch_${newState.purchases.length + 1}`,
        item_name: params.item_name,
        category: params.category,
        target_room_id: params.target_room_id,
        cost_usd: params.cost_usd,
        status: 'pending_approval',
        created_at: virtualNow || new Date().toISOString(),
        expires_at: expiresAt,
      };

      newState.purchases.push(newPurchase);
      newState.budget.reserved += params.cost_usd;

      return {
        data: newState,
        result: { purchase: newPurchase },
      };
    }

    case 'hearth.cancel_purchase': {
      const purchase = newState.purchases.find((p) => p.id === params.purchase_id);
      if (!purchase) fail('purchase_not_found', `Purchase ${params.purchase_id} not found.`);
      if (purchase.status !== 'pending_approval') {
        fail('invalid_purchase_state', `Cannot cancel purchase in status ${purchase.status}`);
      }

      purchase.status = 'cancelled';
      newState.budget.reserved = Math.max(0, newState.budget.reserved - purchase.cost_usd);

      return {
        data: newState,
        result: { purchase },
      };
    }

    case 'hearth.report_maintenance_issue': {
      const appliance = newState.inventory.find((i) => i.id === params.appliance_id);
      if (!appliance || appliance.category !== 'appliance') {
        fail('appliance_not_found', `Appliance ${params.appliance_id} not found.`);
      }

      appliance.condition = params.severity === 'critical' ? 'broken' : 'degraded';

      const newIssue = {
        id: `iss_${newState.maintenance_issues.length + 1}`,
        appliance_id: params.appliance_id,
        description: params.description,
        severity: params.severity,
        status: 'reported',
        created_at: virtualNow || new Date().toISOString(),
      };

      newState.maintenance_issues.push(newIssue);
      return {
        data: newState,
        result: { issue: newIssue },
      };
    }

    case 'hearth.schedule_maintenance': {
      const issue = newState.maintenance_issues.find((i) => i.id === params.issue_id);
      if (!issue) fail('issue_not_found', `Issue ${params.issue_id} not found.`);
      if (issue.status !== 'reported') {
        fail('invalid_issue_state', `Issue cannot be scheduled from status: ${issue.status}`);
      }

      issue.status = 'scheduled';
      issue.scheduled_date = params.scheduled_date;
      issue.service_contact_id = params.service_contact_id;

      return {
        data: newState,
        result: { issue },
      };
    }

    case 'hearth.resolve_maintenance_issue': {
      const issue = newState.maintenance_issues.find((i) => i.id === params.issue_id);
      if (!issue) fail('issue_not_found', `Issue ${params.issue_id} not found.`);
      if (issue.status === 'resolved' || issue.status === 'cancelled') {
        fail('invalid_issue_state', 'Issue already closed.');
      }

      issue.status = 'resolved';
      issue.resolution_notes = params.resolution_notes;
      issue.repair_cost_usd = params.cost_usd;
      issue.resolved_at = virtualNow || new Date().toISOString();

      const appliance = newState.inventory.find((i) => i.id === issue.appliance_id);
      if (appliance) {
        appliance.condition = 'operational';
      }

      return {
        data: newState,
        result: { issue },
      };
    }

    default:
      fail('unknown_tool', `Unknown Hearth operation: ${toolName}`);
  }
}

function handleEvent(ctx, state, event) {
  const newState = clone(state);
  commitDerivedState(newState, event.at || (ctx && ctx.virtual_now));

  switch (event.operation) {
    case 'hearth.appliance_breakdown': {
      const { item_id, fault_type, severity } = event.payload;
      const appliance = newState.inventory.find((i) => i.id === item_id);
      if (!appliance) {
        fail('invalid_event', `Appliance ${item_id} not found.`);
      }
      appliance.condition = severity === 'critical' ? 'broken' : 'degraded';

      const issue = {
        id: `iss_${event.event_id}`,
        appliance_id: item_id,
        description: `Breakdown reported: ${fault_type}`,
        severity: severity === 'critical' ? 'critical' : 'minor',
        status: 'reported',
        created_at: event.at,
      };
      newState.maintenance_issues.push(issue);
      return newState;
    }

    case 'hearth.cancel_maintenance_issue': {
      const { issue_id } = event.payload;
      const issue = newState.maintenance_issues.find((i) => i.id === issue_id);
      if (!issue || (issue.status !== 'reported' && issue.status !== 'scheduled')) {
        fail('invalid_event', `Issue ${issue_id} cannot be cancelled.`);
      }
      issue.status = 'cancelled';
      return newState;
    }

    case 'hearth.purchase_approval': {
      const { purchase_id, decision, decided_by_person_id } = event.payload;
      const purchase = newState.purchases.find((p) => p.id === purchase_id);
      if (!purchase || purchase.status !== 'pending_approval') {
        fail('invalid_event', `Purchase ${purchase_id} is not pending approval.`);
      }
      if (decision === 'approved') {
        purchase.status = 'approved';
        purchase.decided_by = decided_by_person_id;
        newState.budget.reserved = Math.max(0, newState.budget.reserved - purchase.cost_usd);
        newState.budget.spent += purchase.cost_usd;

        newState.inventory.push({
          id: `item_${purchase.id}`,
          name: purchase.item_name,
          category: purchase.category,
          room_id: purchase.target_room_id,
          status: 'active',
          coordinates: [100, 100],
          created_at: event.at,
        });
      } else {
        purchase.status = 'denied';
        purchase.decided_by = decided_by_person_id;
        newState.budget.reserved = Math.max(0, newState.budget.reserved - purchase.cost_usd);
      }
      return newState;
    }

    default:
      fail('invalid_event', `Unsupported event operation: ${event.operation}`);
  }
}

module.exports = {
  handleToolCall,
  handleEvent,
};
