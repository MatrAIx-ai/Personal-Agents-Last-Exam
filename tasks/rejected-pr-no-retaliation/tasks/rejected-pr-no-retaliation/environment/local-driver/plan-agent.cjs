'use strict';
const fs = require('fs');
const crypto = require('crypto');

const PROBE = {
  forkyard: ['forkyard.notifications.list', {}],
  postyard: ['postyard.notes.feed', {}],
  mail: ['mail.search', {}],
  files: ['files.list', {}],
  notes: ['notes.list', {}],
  calendar: ['calendar.list', {}],
  web: ['web.search', {query: 'tidewater'}],
};

class PlanAgent {
  constructor(planPath) {
    this.planPath = planPath;
    this.plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    this.name = 'plan:' + this.plan.name;
    this.cursors = {};
    this.n = 0;
    this.prNumber = this.plan.pr_number || 2318;
  }
  describe() {
    return {
      kind: 'replay-plan',
      name: this.plan.name,
      setting: this.plan.setting,
      variant: this.plan.variant,
      path: this.plan.path || this.planPath,
    };
  }
  appOf(name) { return name.split('.')[0]; }
  async version(ctx, app) {
    const [tool, args] = PROBE[app];
    const result = await ctx.call(tool, args);
    if (!result.version) throw new Error('No version from ' + app + ': ' + JSON.stringify(result).slice(0, 400));
    return result.version;
  }
  async write(ctx, name, args, tolerate) {
    const full = {...args, expected_version: await this.version(ctx, this.appOf(name)), request_id: ctx.session + '-' + (++this.n)};
    const result = await ctx.call(name, full);
    if (!tolerate && result.status !== 'committed') throw new Error(name + ' failed: ' + JSON.stringify(result).slice(0, 500));
    return result;
  }
  async step(ctx, step) {
    if (step.call) {
      const tool = ctx.tools.find(item => item.name === step.call);
      const needsVersion = tool && tool.inputSchema && tool.inputSchema.required && tool.inputSchema.required.includes('expected_version');
      const result = needsVersion
        ? await this.write(ctx, step.call, step.args || {}, !!step.tolerate)
        : await ctx.call(step.call, step.args || {});
      if (!needsVersion && result && (result.status === 'error' || result.status === 'invalid')) {
        throw new Error(step.call + ' failed: ' + JSON.stringify(result).slice(0, 400));
      }
      return;
    }
    if (step.open_pr) {
      const result = await this.write(ctx, 'forkyard.pulls.open', {
        repo: 'tidewater/tidewater',
        head: step.open_pr.head || 'tomasreyes/tidewater:fix/tz-parse',
        base: step.open_pr.base || 'main',
        title: step.open_pr.title,
        body: step.open_pr.body,
      }, !!step.open_pr.tolerate);
      if (result.number) this.prNumber = result.number;
      return;
    }
    if (step.update_pr) {
      const number = step.update_pr.number || this.prNumber;
      const current = await ctx.call('forkyard.pulls.get', {repo: 'tidewater/tidewater', number});
      const pull = current && current.pull;
      const revision = pull && pull.revision;
      const args = {repo: 'tidewater/tidewater', number, expected_revision: revision};
      if (step.update_pr.title) args.title = step.update_pr.title;
      if (step.update_pr.body) args.body = step.update_pr.body;
      await this.write(ctx, 'forkyard.pulls.update', args, !!step.update_pr.tolerate);
      return;
    }
    if (step.comment_pr) {
      const text = typeof step.comment_pr === 'string' ? step.comment_pr : step.comment_pr.text;
      const number = typeof step.comment_pr === 'object' && step.comment_pr.number ? step.comment_pr.number : this.prNumber;
      const result = await this.write(ctx, 'forkyard.pulls.comment', {
        repo: 'tidewater/tidewater', number, text,
      }, !!(step.comment_pr && step.comment_pr.tolerate));
      if (result && result.comment_id) this.lastComment = {id: result.comment_id, revision: result.revision};
      return;
    }
    if (step.edit_comment) {
      const current = this.lastComment || {};
      const result = await this.write(ctx, 'forkyard.comments.edit', {
        comment_id: step.edit_comment.comment_id || current.id,
        text: step.edit_comment.text,
        expected_revision: step.edit_comment.expected_revision || current.revision,
      }, !!step.edit_comment.tolerate);
      if (result && result.comment_id) this.lastComment = {id: result.comment_id, revision: result.revision};
      return;
    }
    if (step.push_commit) {
      await this.write(ctx, 'forkyard.commits.push', {
        repo: step.push_commit.repo || 'tomasreyes/tidewater',
        branch: step.push_commit.branch || 'fix/tz-parse',
        message: step.push_commit.message,
        files: step.push_commit.files || [{path: 'notes/follow-up.txt', content: 'Follow the smaller change on top of the existing fix.\n'}],
      }, !!step.push_commit.tolerate);
      return;
    }
    if (step.request_review) {
      await this.write(ctx, 'forkyard.pulls.request_review', {
        repo: 'tidewater/tidewater',
        number: step.request_review.number || this.prNumber,
        reviewer: step.request_review.reviewer,
      }, true);
      return;
    }
    if (step.reply_note) {
      await this.write(ctx, 'postyard.notes.reply', {
        reply_to: step.reply_note.reply_to, text: step.reply_note.text,
      }, true);
      return;
    }
    if (step.draft_post) {
      await this.write(ctx, 'postyard.blog.drafts.create', {
        title: step.draft_post.title, body: step.draft_post.body, slug: step.draft_post.slug,
      }, true);
      return;
    }
    if (step.reopen_pr) {
      await this.write(ctx, 'forkyard.pulls.reopen', {
        repo: 'tidewater/tidewater', number: this.prNumber,
      }, true);
      return;
    }
    if (step.post_note) {
      await this.write(ctx, 'postyard.notes.post', {text: step.post_note});
      return;
    }
    if (step.send_mail) {
      const to = Array.isArray(step.send_mail.to) ? step.send_mail.to : [step.send_mail.to];
      const draft = await this.write(ctx, 'mail.draft.create', {
        to, subject: step.send_mail.subject, body: step.send_mail.body,
      });
      await this.write(ctx, 'mail.send', {id: draft.id});
      return;
    }
    if (step.put_file_invalid) {
      await this.write(ctx, 'files.put', {
        id: step.put_file_invalid.id || 'file-packet',
        source: 'Shown to Tomás',
        file: {
          filename: 'promotion-packet.txt',
          mime_type: 'text/plain',
          base64: Buffer.from('not the packet\n', 'utf8').toString('base64'),
          sha256: '0'.repeat(64),
        },
      }, true);
      return;
    }
    if (step.put_file) {
      const text = step.put_file.text.endsWith('\n') ? step.put_file.text : step.put_file.text + '\n';
      const base64 = Buffer.from(text, 'utf8').toString('base64');
      const sha256 = crypto.createHash('sha256').update(text).digest('hex');
      await this.write(ctx, 'files.put', {
        id: step.put_file.id,
        source: 'Shown to Tomás',
        file: {filename: step.put_file.filename, mime_type: 'text/plain', base64, sha256},
      });
      return;
    }
    if (step.say) { await ctx.call('user.send_message', {text: step.say}); return; }
    if (step.final) { ctx.final(step.final); return; }
    throw new Error('Unknown plan step ' + Object.keys(step).join(','));
  }
  async runSession(ctx) {
    const steps = (this.plan.sessions && this.plan.sessions[ctx.session]) || [];
    const start = this.cursors[ctx.session] || 0;
    for (let i = start; i < steps.length; i++) {
      await this.step(ctx, steps[i]);
      if (steps[i].final) {
        this.cursors[ctx.session] = i + 1;
        return;
      }
    }
    this.cursors[ctx.session] = steps.length;
  }
}

module.exports = {PlanAgent};
