/**
 * Business logic implementation for Hearth MCP tools and Infra events.
 */
const { clone, deriveStateForRead, commitDerivedState } = require('./state.cjs');

function handleToolCall(toolName, params, state, ctx) {
  // Read operations derive projection from ctx.virtual_now and NEVER mutate state
  if (toolName.startsWith('hearth.get_') || toolName.startsWith('hearth.list_')) {
    const projected = deriveStateForRead(state, ctx.virtual_now);

    switch (toolName) {
      case 'hearth.get_property':
        return {
          result: {
            property: projected.property,
            budget: projected.budget,
          },
          state,
        };

      case 'hearth.get_room': {
        const room = projected.rooms.find((r) => r.id === params.room_id);
        if (!room) {
          return {
            result: { error_code: 'room_not_found', message: `Room ${params.room_id} does not exist.` },
            state,
          };
        }
        const activeItems = projected.inventory.filter((i) => i.room_id === params.room_id && i.status === 'active');
        return {
          result: { room, active_items: activeItems },
          state,
        };
      }

      case 'hearth.list_inventory': {
        let items = projected.inventory;
        if (params.room_id) items = items.filter((i) => i.room_id === params.room_id);
        if (params.category) items = items.filter((i) => i.category === params.category);
        if (params.status) items = items.filter((i) => i.status === params.status);
        return {
          result: { items },
          state,
        };
      }

      case 'hearth.list_maintenance_issues': {
        let issues = projected.maintenance_issues;
        if (params.status) issues = issues.filter((i) => i.status === params.status);
        return {
          result: { issues },
          state,
        };
      }

      case 'hearth.get_resident_profile': {
        const resident = projected.residents.find((r) => r.person_id === params.person_id);
        if (!resident) {
          return {
            result: { error_code: 'resident_not_found', message: `Resident ${params.person_id} not found.` },
            state,
          };
        }
        return {
          result: { resident },
          state,
        };
      }

      default:
        return {
          result: { error_code: 'unknown_tool', message: `Tool ${toolName} not recognized.` },
          state,
        };
    }
  }

  // Write operations mutate state and bump revision
  const newState = clone(state);
  commitDerivedState(newState, ctx.virtual_now);

  switch (toolName) {
    case 'hearth.update_item_placement': {
      const item = newState.inventory.find((i) => i.id === params.item_id);
      if (!item) return { result: { error_code: 'item_not_found' }, state };
      if (item.status === 'disposed') return { result: { error_code: 'item_already_disposed' }, state };

      const room = newState.rooms.find((r) => r.id === params.room_id);
      if (!room) return { result: { error_code: 'room_not_found' }, state };

      item.room_id = params.room_id;
      item.coordinates = params.coordinates;
      item.status = 'active';

      newState.version.revision += 1;
      return {
        result: { success: true, item, committed_version: newState.version },
        state: newState,
      };
    }

    case 'hearth.store_item': {
      const item = newState.inventory.find((i) => i.id === params.item_id);
      if (!item) return { result: { error_code: 'item_not_found' }, state };
      if (item.status === 'disposed') return { result: { error_code: 'item_already_disposed' }, state };

      const room = newState.rooms.find((r) => r.id === params.storage_room_id);
      if (!room || !room.is_storage) return { result: { error_code: 'invalid_storage_location' }, state };

      item.room_id = params.storage_room_id;
      item.status = 'stored';
      item.coordinates = null;

      newState.version.revision += 1;
      return {
        result: { success: true, item, committed_version: newState.version },
        state: newState,
      };
    }

    case 'hearth.dispose_item': {
      const item = newState.inventory.find((i) => i.id === params.item_id);
      if (!item) return { result: { error_code: 'item_not_found' }, state };
      if (item.status === 'disposed') return { result: { error_code: 'item_already_disposed' }, state };

      item.status = 'disposed';
      item.disposal_reason = params.reason;
      item.disposed_at = ctx.virtual_now || new Date().toISOString();

      newState.version.revision += 1;
      return {
        result: { success: true, item, committed_version: newState.version },
        state: newState,
      };
    }

    case 'hearth.request_purchase': {
      const available = newState.budget.total_cap - (newState.budget.spent + newState.budget.reserved);
      if (params.cost_usd > available) {
        return {
          result: { error_code: 'budget_exceeded', message: `Cost exceeds available budget cap ($${available} remaining).` },
          state,
        };
      }

      const nowTime = ctx.virtual_now ? new Date(ctx.virtual_now).getTime() : Date.now();
      const expiresAt = new Date(nowTime + 48 * 3600 * 1000).toISOString();

      const newPurchase = {
        id: `purch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        item_name: params.item_name,
        category: params.category,
        target_room_id: params.target_room_id,
        cost_usd: params.cost_usd,
        status: 'pending_approval',
        created_at: ctx.virtual_now || new Date().toISOString(),
        expires_at: expiresAt,
        request_id: params.request_id,
      };

      newState.purchases.push(newPurchase);
      newState.budget.reserved += params.cost_usd;

      newState.version.revision += 1;
      return {
        result: { success: true, purchase: newPurchase, committed_version: newState.version },
        state: newState,
      };
    }

    case 'hearth.cancel_purchase': {
      const purchase = newState.purchases.find((p) => p.id === params.purchase_id);
      if (!purchase) return { result: { error_code: 'purchase_not_found' }, state };
      if (purchase.status !== 'pending_approval') {
        return {
          result: { error_code: 'invalid_purchase_state', message: `Cannot cancel purchase in status ${purchase.status}` },
          state,
        };
      }

      purchase.status = 'cancelled';
      newState.budget.reserved = Math.max(0, newState.budget.reserved - purchase.cost_usd);

      newState.version.revision += 1;
      return {
        result: { success: true, purchase, committed_version: newState.version },
        state: newState,
      };
    }

    case 'hearth.report_maintenance_issue': {
      const appliance = newState.inventory.find((i) => i.id === params.appliance_id);
      if (!appliance || appliance.category !== 'appliance') {
        return { result: { error_code: 'appliance_not_found' }, state };
      }

      appliance.condition = params.severity === 'critical' ? 'broken' : 'degraded';

      const newIssue = {
        id: `iss_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        appliance_id: params.appliance_id,
        description: params.description,
        severity: params.severity,
        status: 'reported',
        created_at: ctx.virtual_now || new Date().toISOString(),
      };

      newState.maintenance_issues.push(newIssue);
      newState.version.revision += 1;
      return {
        result: { success: true, issue: newIssue, committed_version: newState.version },
        state: newState,
      };
    }

    case 'hearth.schedule_maintenance': {
      const issue = newState.maintenance_issues.find((i) => i.id === params.issue_id);
      if (!issue) return { result: { error_code: 'issue_not_found' }, state };
      if (issue.status !== 'reported') {
        return {
          result: { error_code: 'invalid_issue_state', message: `Issue cannot be scheduled from status: ${issue.status}` },
          state,
        };
      }

      issue.status = 'scheduled';
      issue.scheduled_date = params.scheduled_date;
      issue.service_contact_id = params.service_contact_id;

      newState.version.revision += 1;
      return {
        result: { success: true, issue, committed_version: newState.version },
        state: newState,
      };
    }

    case 'hearth.resolve_maintenance_issue': {
      const issue = newState.maintenance_issues.find((i) => i.id === params.issue_id);
      if (!issue) return { result: { error_code: 'issue_not_found' }, state };
      if (issue.status === 'resolved' || issue.status === 'cancelled') {
        return {
          result: { error_code: 'invalid_issue_state', message: `Issue already closed.` },
          state,
        };
      }

      issue.status = 'resolved';
      issue.resolution_notes = params.resolution_notes;
      issue.repair_cost_usd = params.cost_usd;
      issue.resolved_at = ctx.virtual_now || new Date().toISOString();

      const appliance = newState.inventory.find((i) => i.id === issue.appliance_id);
      if (appliance) {
        appliance.condition = 'operational';
      }

      newState.version.revision += 1;
      return {
        result: { success: true, issue, committed_version: newState.version },
        state: newState,
      };
    }

    default:
      return { result: { error_code: 'unknown_tool' }, state };
  }
}

function handleEvent(event, state, ctx) {
  const newState = clone(state);
  commitDerivedState(newState, event.at || ctx.virtual_now);

  switch (event.operation) {
    case 'hearth.appliance_breakdown': {
      const { item_id, fault_type, severity, reported_by_person_id } = event.payload;
      const appliance = newState.inventory.find((i) => i.id === item_id);
      if (appliance) {
        appliance.condition = severity === 'critical' ? 'broken' : 'degraded';
      }

      const issue = {
        id: `iss_evt_${Date.now()}`,
        appliance_id: item_id,
        description: `Breakdown reported: ${fault_type}`,
        severity: severity === 'critical' ? 'critical' : 'minor',
        status: 'reported',
        reported_by: reported_by_person_id,
        created_at: event.at,
      };
      newState.maintenance_issues.push(issue);
      newState.version.revision += 1;
      return { state: newState, effect: { issue_created: issue.id } };
    }

    case 'hearth.cancel_maintenance_issue': {
      const { issue_id, reason, cancelled_by_person_id } = event.payload;
      const issue = newState.maintenance_issues.find((i) => i.id === issue_id);
      if (issue && (issue.status === 'reported' || issue.status === 'scheduled')) {
        issue.status = 'cancelled';
        issue.cancellation_reason = reason;
        issue.cancelled_by = cancelled_by_person_id;
        newState.version.revision += 1;
      }
      return { state: newState, effect: { issue_cancelled: issue_id } };
    }

    case 'hearth.purchase_approval': {
      const { purchase_id, decision, decided_by_person_id } = event.payload;
      const purchase = newState.purchases.find((p) => p.id === purchase_id);
      if (purchase && purchase.status === 'pending_approval') {
        if (decision === 'approved') {
          purchase.status = 'approved';
          purchase.decided_by = decided_by_person_id;
          newState.budget.reserved = Math.max(0, newState.budget.reserved - purchase.cost_usd);
          newState.budget.spent += purchase.cost_usd;

          // Add newly approved item into inventory
          newState.inventory.push({
            id: `item_${Date.now()}`,
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
        newState.version.revision += 1;
      }
      return { state: newState, effect: { purchase_decision: decision } };
    }

    default:
      return { state: newState, effect: null };
  }
}

module.exports = {
  handleToolCall,
  handleEvent,
};
