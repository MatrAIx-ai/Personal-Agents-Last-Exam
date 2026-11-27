import { mount, el, time, metadata, tag, transfer } from '/shared/client.js';

function renderHighlightedText(rawText, claims) {
  if (!rawText) return el('p', { class: 'muted' }, 'No extracted text available.');
  if (!claims || claims.length === 0) return el('pre', { class: 'body-text' }, rawText);

  const sorted = [...claims].sort((a, b) => a.start_offset - b.start_offset);
  const parts = [];
  let cursor = 0;
  for (const c of sorted) {
    if (c.start_offset > cursor) {
      parts.push(rawText.slice(cursor, c.start_offset));
    }
    const cited = rawText.slice(c.start_offset, c.end_offset);
    parts.push(el('mark', { title: `${c.claim_text} [${c.verification_state}]` }, cited));
    cursor = c.end_offset;
  }
  if (cursor < rawText.length) parts.push(rawText.slice(cursor));
  return el('pre', { class: 'body-text' }, ...parts);
}

function attachFileDropzone() {
  const dialog = document.querySelector('dialog');
  if (!dialog || dialog.dataset.dropzoneBound) return;
  dialog.dataset.dropzoneBound = '1';

  const enhance = () => {
    const op = dialog.dataset.operation;
    if (!dialog.open || !['personal-records.upload_document', 'personal-records.create_version'].includes(op)) return;
    const fields = dialog.querySelector('.fields');
    if (!fields || fields.querySelector('.pr-dropzone')) return;

    const contentInput = fields.querySelector('[data-field="content_bytes"]');
    const mimeSelect = fields.querySelector('[data-field="mime_type"]');
    const titleInput = fields.querySelector('[data-field="title"]');
    if (!contentInput) return;

    const statusLine = el('small', {}, 'Supports PDF, PNG, JPEG, TXT (max 1 MiB). Or paste base64 below.');
    const fileInput = el('input', { type: 'file', accept: '.pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain' });
    const dropzone = el(
      'div',
      { class: 'attachment-card pr-dropzone', tabindex: '0' },
      el('span', { class: 'file-symbol', 'aria-hidden': 'true' }, '↥'),
      el('div', {}, el('strong', {}, 'Drop a file here or choose from disk'), statusLine),
      fileInput
    );

    const handleFile = async file => {
      if (!file) return;
      try {
        statusLine.textContent = `Reading ${file.name}…`;
        const out = await transfer(file);
        contentInput.value = out.base64;
        if (mimeSelect && [...mimeSelect.options].some(o => o.value === out.mime_type)) {
          mimeSelect.value = out.mime_type;
        }
        if (titleInput && !titleInput.value.trim()) {
          titleInput.value = file.name.replace(/\.[^.]+$/, '');
        }
        statusLine.textContent = `Loaded ${out.filename} (${out.mime_type}, SHA-256 ${out.sha256.slice(0, 12)}…)`;
      } catch (err) {
        statusLine.textContent = err.message;
      }
    };

    fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));
    dropzone.addEventListener('dragover', e => {
      e.preventDefault();
      dropzone.classList.add('active');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('active'));
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.classList.remove('active');
      handleFile(e.dataTransfer?.files?.[0]);
    });

    const contentField = contentInput.closest('.field');
    if (contentField) fields.insertBefore(dropzone, contentField);
  };

  new MutationObserver(enhance).observe(dialog, { attributes: true, attributeFilter: ['open', 'data-operation'] });
}

export const config = {
  id: 'personal-records',
  title: 'Personal Records',
  symbol: '§',
  searchLabel: 'Search documents, tags, or extracted text',
  initialSection: 'all',
  list: 'personal-records.search',
  collection: 'items',
  queryField: 'query',
  listArgs: {},
  get: 'personal-records.get_document',
  item: 'item',
  heading: d => d.title,
  subtitle: d => `${d.category} · v${d.current_version_number} · ${d.verification_state}`,
  labels: {
    title: 'Title',
    content_bytes: 'Content (base64, auto-filled by file picker)',
    mime_type: 'MIME type',
    category: 'Category',
    valid_until: 'Valid until (ISO 8601)',
    document_id: 'Document ID',
    source_id: 'Source document ID',
    target_id: 'Target document ID',
    relationship_type: 'Relationship type',
    version_number: 'Version number',
    extraction_revision: 'Extraction revision',
    start_offset: 'Start offset',
    end_offset: 'End offset',
    cited_text: 'Cited text',
    claim_text: 'Claim text',
    target_type: 'Target type',
    rationale: 'Rationale',
    proposal_id: 'Proposal ID',
    decision: 'Decision',
    newer_document_id: 'Newer document ID',
    older_document_id: 'Older document ID'
  },
  load: async ui => {
    attachFileDropzone();
    const [propRes, linkRes] = await Promise.all([
      ui.has('personal-records.list_proposals') ? ui.call('personal-records.list_proposals', {}) : Promise.resolve({ proposals: [] }),
      ui.has('personal-records.list_links') ? ui.call('personal-records.list_links', {}) : Promise.resolve({ links: [] })
    ]);
    return {
      proposals: propRes.proposals || [],
      links: linkRes.links || []
    };
  },
  sections: ui => {
    const pendingCount = (ui.aux.proposals || []).filter(p => p.status === 'PENDING').length;
    const activeCategories = [...new Set(ui.records.map(d => d.category).filter(Boolean))].sort();
    return [
      { id: 'all', label: 'All records', symbol: '§', filter: () => true },
      { id: 'confirmed', label: 'User confirmed', symbol: '✓', filter: d => d.verification_state === 'USER_CONFIRMED' },
      { id: 'inferred', label: 'Inferred', symbol: '◌', filter: d => d.verification_state === 'INFERRED' },
      { id: 'expiring', label: 'Has expiry', symbol: '⏱', filter: d => Boolean(d.valid_until) },
      { id: 'proposals', label: `Proposals (${pendingCount})`, symbol: '⚑', count: false, filter: () => true },
      ...activeCategories.map(cat => ({
        id: `cat:${cat}`,
        label: cat.charAt(0).toUpperCase() + cat.slice(1),
        symbol: '•',
        filter: d => d.category === cat
      }))
    ];
  },
  actions: [
    { label: 'Upload document', tool: 'personal-records.upload_document', primary: true },
    { label: 'Import from source', tool: 'personal-records.import_from_source' },
    { label: 'Check expiries', tool: 'personal-records.check_expiries' },
    { label: 'New version', tool: 'personal-records.create_version', selected: true, prefill: d => ({ document_id: d.id, expected_parent_version: d.current_version_number }) },
    { label: 'Link document', tool: 'personal-records.link_documents', selected: true, prefill: d => ({ source_id: d.id }) },
    { label: 'Add claim', tool: 'personal-records.create_evidence_claim', selected: true, prefill: d => ({ document_id: d.id, version_number: d.current_version_number, extraction_revision: d.selected_version?.extraction_revision || 'ext_rev_01' }) },
    { label: 'Propose update', tool: 'personal-records.propose_update', selected: true, prefill: d => ({ target_type: 'document_metadata', target_id: d.id, expected_target_version: d.current_version_number }) },
    { label: 'Confirm proposal', tool: 'personal-records.confirm_update', hidden: true },
    { label: 'Compare discrepancies', tool: 'personal-records.check_discrepancies', selected: true, advanced: true, prefill: d => ({ newer_document_id: d.id }) }
  ],
  view: (d, ui) => {
    const ver = d.selected_version || {};
    const claims = d.claims || [];
    const links = d.links || [];
    const allPending = (ui.aux.proposals || []).filter(p => p.status === 'PENDING');
    const visibleProposals = ui.section === 'proposals'
      ? allPending
      : allPending.filter(p => p.target_id === d.id);

    return el(
      'article',
      { class: 'record-detail' },
      el('h2', {}, d.title),
      el('div', { class: 'tags' }, tag(d.category), tag(d.verification_state), ...(d.tags || []).map(t => tag(t))),
      metadata('Document ID', d.id),
      metadata('Version', `v${d.current_version_number} (${ver.extraction_revision || 'ext_rev_01'})`),
      metadata('SHA-256', ver.sha256 ? ver.sha256.slice(0, 16) + '…' : '—'),
      metadata('Valid until', d.valid_until ? time(d.valid_until) : 'None'),
      metadata('Updated', time(d.updated_at)),

      el('section', { class: 'query-result' },
        el('h3', {}, 'Extracted Text & Passage Anchors'),
        renderHighlightedText(ver.raw_text, claims)
      ),

      el('section', { class: 'attachments' },
        el('h3', {}, `Verified Claims (${claims.length})`),
        claims.length
          ? el('div', { class: 'attachment-grid' },
              ...claims.map(c => el('div', { class: 'attachment-card' },
                el('span', { class: 'file-symbol', 'aria-hidden': 'true' }, '¶'),
                el('div', {},
                  el('strong', {}, c.claim_text),
                  el('small', {}, `"${c.cited_text}" · [${c.start_offset}:${c.end_offset}] · ${c.verification_state}`)
                )
              ))
            )
          : el('p', { class: 'muted' }, 'No evidence claims recorded for this version.')
      ),

      el('section', { class: 'attachments' },
        el('h3', {}, `Relationship Graph (${links.length})`),
        links.length
          ? el('div', { class: 'attachment-grid' },
              ...links.map(l => el('div', { class: 'attachment-card' },
                el('span', { class: 'file-symbol', 'aria-hidden': 'true' }, '⇄'),
                el('div', {},
                  el('strong', {}, `${l.relationship_type}: ${l.source_id} → ${l.target_id}`),
                  el('small', {}, l.id)
                )
              ))
            )
          : el('p', { class: 'muted' }, 'No directed document links.')
      ),

      el('section', { class: 'attachments' },
        el('h3', {}, ui.section === 'proposals'
          ? `All Pending Proposals (${visibleProposals.length})`
          : `Pending Proposals for This Record (${visibleProposals.length})`),
        visibleProposals.length
          ? el('div', { class: 'attachment-grid' },
              ...visibleProposals.map(p => el('div', { class: 'attachment-card' },
                el('span', { class: 'file-symbol', 'aria-hidden': 'true' }, '⚑'),
                el('div', {},
                  el('strong', {}, `${p.target_type}: ${p.target_id}`),
                  el('small', {}, p.rationale)
                ),
                ui.has('personal-records.confirm_update')
                  ? el('div', { class: 'actions' },
                      el('button', { type: 'button', class: 'primary', onclick: () => ui.action('personal-records.confirm_update', { proposal_id: p.id, decision: 'APPROVE' }) }, 'Approve'),
                      el('button', { type: 'button', onclick: () => ui.action('personal-records.confirm_update', { proposal_id: p.id, decision: 'REJECT' }) }, 'Reject')
                    )
                  : el('small', { class: 'muted' }, 'User confirmation required (blocked in agent policy)')
              ))
            )
          : el('p', { class: 'muted' }, 'No pending proposals for this record.')
      )
    );
  }
};

mount(config);
