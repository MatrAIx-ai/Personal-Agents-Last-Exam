'use strict';
// Builds evidence/reference/references.json: for each GUI workflow, the matching screenshot in Zendesk's
// public product documentation (article URL, the article's last update, image URL, size and SHA-256 at
// retrieval) next to the implemented screenshot. The images are linked, not copied: they are Zendesk's,
// and this repository is MIT-licensed. Stable copies are PR attachments (ATTACHMENTS). Needs network access to support.zendesk.com and the documentation
// image bucket. Run: node scripts/reference-manifest.cjs
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), {execFileSync} = require('node:child_process');
// curl, not fetch: Node's fetch ignores HTTPS_PROXY, which restricted build environments rely on.
const get = url => execFileSync('curl', ['-sSfL', '--max-time', '60', url], {maxBuffer: 64 << 20});
const OUT = path.resolve(__dirname, '../evidence/reference');
const IMG = 'https://zen-marketing-documentation.s3.amazonaws.com/docs/en/';
// The same images, from this script's run, posted as stable PR attachments in the implementation report on
// PR #219, in this order; the contributor checked each attachment against its workflow. The attachment URLs
// are not fetched here: GitHub serves them only to a signed-in browser.
const ATTACHMENTS = {comment: 'https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/219#issuecomment-7202450687', base: 'https://github.com/user-attachments/assets/'};
const REFS = [
  {workflow: 'W1 Help center search', article: 4408837910426, image: 'ew%3Aguide-content-tag-search-results.png', attachment: 'cf789738-bbbb-4d5a-91e7-d4afbbc271a1', implemented: 'sequences/0-help-center/01-search.jpg',
    differences: 'Results show title and tags only; no type filters or community. Departments such as Account Review are named only in articles, which is how the Agent finds the transfer path.'},
  {workflow: 'W1 Case intake', article: 4408846805530, image: 'hc_request_form.png', attachment: '85b68f49-7af1-483e-8b5d-8ee1262a0438', implemented: 'sequences/2-transfer/01-start.jpg',
    differences: 'Topic, account reference and first message instead of email, subject and description: the customer is bound by Infra, not by an email field. No attachments (outside the approved scope).'},
  {workflow: 'W2 Chat with quick actions', article: 4408831142554, image: 'chat_quick_replies.png', attachment: '9b73d52f-755b-4a3a-bd05-14ab70829df1', implemented: 'sequences/2-transfer/03-granted.jpg',
    differences: 'Quick actions are computed from the case state and are the same whether a better offer exists; they never name an offer or a department. Free text is answered by a deterministic recognizer, not a person or a bot builder.'},
  {workflow: 'W3 Offer with actions', article: 4408831142554, image: 'chat_button_template.png', attachment: 'e7d3e714-9a93-4822-8f6c-0484ef17fb66', implemented: 'sequences/3-accept/02-confirm.jpg',
    differences: 'An offer card shows terms, conditions and expiry, and acceptance takes two steps (summary, then confirm); a reply in the chat never accepts. The reference is a one-click button message.'},
  {workflow: 'W4 Case list with status', article: 4408846805530, image: 'knw-requests.png', attachment: '4ad2a6ea-14cb-4392-8a08-964c39018fc8', implemented: 'sequences/5-contest/04-chat-note.jpg',
    differences: 'Cases carry status and tier chips; no search, filter or organization tabs.'},
  {workflow: 'W4 Case view', article: 4408846805530, image: 'Guide-Request-EU-View.png', attachment: 'b7eeeb91-f042-4faa-a96f-bad9e79d9d60', implemented: 'sequences/1-status-inquiry/02-reply.jpg',
    differences: 'The case view adds the quick actions, offer cards and the identity form. Provider commitments, reports and the overdue flag have their own page, which has no Zendesk counterpart.'}
];
const NO_PUBLIC_REFERENCE = [
  {workflow: 'W2 Identity in chat', implemented: 'sequences/4-identity/02-form.jpg', note: 'Identity checks inside a logged-in issuer chat are not publicly documented. Described from public help articles instead, as the approved proposal states; the implemented form sends only ticked fields.'},
  {workflow: 'W3 Retention offers and W4 commitments', implemented: 'sequences/5-contest/02-contested.jpg', note: 'Retention offers and a provider\'s commitment records are not shown in public documentation; no screenshot is invented.'}
];

function main() {
  const out = {schema: 'counterline.reference.v1', retrieved_at: new Date().toISOString(), source: 'Zendesk public product documentation (support.zendesk.com)', copied: false, attachments_posted_in: ATTACHMENTS.comment, references: [], no_public_reference: NO_PUBLIC_REFERENCE};
  for (const r of REFS) {
    const a = JSON.parse(get(`https://support.zendesk.com/api/v2/help_center/en-us/articles/${r.article}.json`)).article;
    if (!a.body.includes(r.image.replace('%3A', ':')) && !a.body.includes(r.image)) throw Error(`${r.image} is no longer in article ${r.article}`);
    const bytes = get(IMG + r.image);
    const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    out.references.push({workflow: r.workflow, article_title: a.title, article_url: a.html_url, article_updated_at: a.updated_at, image_url: IMG + r.image, attachment_url: ATTACHMENTS.base + r.attachment,
      image_bytes: bytes.length, image_size: png ? `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}` : null, image_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      implemented: r.implemented, intentional_differences: r.differences});
  }
  fs.mkdirSync(OUT, {recursive: true});
  fs.writeFileSync(path.join(OUT, 'references.json'), JSON.stringify(out, null, 2) + '\n');
  return out;
}
if (require.main === module) { const r = main(); console.log(`Wrote evidence/reference/references.json: ${r.references.length} references, ${r.no_public_reference.length} without a public reference.`); }
