'use strict';
// Replay "agent": executes a fixed JSON plan of tool calls through the same Agent MCP tools and
// user-chat channel that an evaluated model receives. Used by solution/solve.sh and the grader
// validation fixtures. Macro steps (send_mail, send_message, edit_note) expand into ordinary App
// tool calls (files.read -> mail.attachment.add, etc.); nothing bypasses the App tools.
const fs = require('node:fs');

class PlanAgent {
  constructor(planPath) {
    this.planPath = planPath;
    this.plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    this.name = 'plan:' + this.plan.name;
    this.vars = {};
  }
  describe() { return {kind: 'replay-plan', name: this.plan.name, path: this.planPath, description: this.plan.description || ''}; }

  async version(ctx, app) {
    const r = await ctx.call(app === 'mail' ? 'mail.search' : app + '.list', {query: '__flr_version_probe__'});
    if (!r.version) throw new Error('No version from ' + app + ': ' + JSON.stringify(r));
    return r.version;
  }
  async write(ctx, name, args) {
    const app = name.split('.')[0];
    const full = {...args, expected_version: await this.version(ctx, app), request_id: `${ctx.session}-${++this.n}`};
    const r = await ctx.call(name, full);
    if (r.status !== 'committed') throw new Error(`${name} failed: ${JSON.stringify(r)}`);
    return r;
  }
  async fileBytes(ctx, fileId) {
    const r = await ctx.call('files.read', {id: fileId});
    if (r.status !== 'ok') throw new Error('files.read failed: ' + JSON.stringify(r));
    return r.file;
  }
  async conversationWith(ctx, person) {
    const list = await ctx.call('messages.conversations', {});
    const hit = (list.conversations || list.items || []).find(c => c.participant_ids.length === 2 && c.participant_ids.includes(person));
    if (hit) return hit.id;
    return (await this.write(ctx, 'messages.conversation.create', {title: person, participant_ids: ['person-ana', person]})).id;
  }
  async step(ctx, s) {
    if (s.call) {
      const tool = ctx.tools.find(x => x.name === s.call);
      const needsVersion = tool?.inputSchema?.properties?.expected_version;
      const r = needsVersion ? await this.write(ctx, s.call, s.args || {}) : await ctx.call(s.call, s.args || {});
      if (s.save) this.vars[s.save] = r;
      return;
    }
    if (s.send_mail) {
      const m = s.send_mail;
      const d = await this.write(ctx, 'mail.draft.create', {to: m.to, subject: m.subject, body: m.body});
      const files = [];
      for (const f of m.attach_files || []) files.push(await this.fileBytes(ctx, f));
      if (files.length) await this.write(ctx, 'mail.attachment.add', {id: d.id, files});
      await this.write(ctx, 'mail.send', {id: d.id});
      if (s.save) this.vars[s.save] = d;
      return;
    }
    if (s.send_message) {
      const m = s.send_message;
      const conversation_id = m.conversation_id || await this.conversationWith(ctx, m.to_person);
      const files = [];
      for (const f of m.attach_files || []) files.push(await this.fileBytes(ctx, f));
      await this.write(ctx, 'messages.send', {conversation_id, text: m.text, ...(files.length ? {files} : {})});
      return;
    }
    if (s.edit_note) {
      const n = (await ctx.call('notes.get', {id: s.edit_note.id})).item;
      let body = n.body;
      for (const [from, to] of s.edit_note.replace || []) {
        if (!body.includes(from)) throw new Error('edit_note: text not found: ' + from);
        body = body.replace(from, to);
      }
      if (s.edit_note.append) body += s.edit_note.append;
      await this.write(ctx, 'notes.update', {id: s.edit_note.id, patch: {body}});
      return;
    }
    if (s.say) { await ctx.call('user.send_message', {text: s.say}); return; }
    if (s.final) { ctx.final(s.final); return; }
    throw new Error('Unknown plan step: ' + JSON.stringify(s));
  }
  async runSession(ctx) {
    this.n = this.n || 0;
    for (const s of this.plan.sessions[ctx.session] || []) await this.step(ctx, s);
  }
}
module.exports = {PlanAgent};
