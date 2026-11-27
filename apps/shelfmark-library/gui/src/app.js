import { connect, el } from '/shared/client.js';

const root = document.getElementById('app');
const state = {
  tab: 'catalog',
  version: null,
  virtualNow: '',
  branches: [],
  titles: [],
  cards: [],
  holds: [],
  loans: [],
  fines: [],
  rooms: [],
  bookings: [],
  selectedCardId: 'card-maya',
  selectedBranchId: 'br-westside',
  query: '',
  statusMessage: '',
};

let client = null;
let reqSeq = 1;
const nextReq = (tag) => `web-${tag}-${Date.now()}-${reqSeq++}`;

async function callTool(name, args = {}) {
  const res = await client.call(name, args);
  if (res.version) state.version = res.version;
  if (res.virtual_now) state.virtualNow = res.virtual_now;
  return res;
}

async function refreshAll() {
  const [cat, cards, holds, loans, fines, rooms, bookings] = await Promise.all([
    callTool('shelfmark-library.catalog.search', state.query ? { query: state.query } : {}),
    callTool('shelfmark-library.card.list', {}),
    callTool('shelfmark-library.hold.list', {}),
    callTool('shelfmark-library.loan.list', {}),
    callTool('shelfmark-library.fine.list', {}),
    callTool('shelfmark-library.room.search', {}),
    callTool('shelfmark-library.room.list_bookings', {}),
  ]);
  state.branches = cat.branches || [];
  state.titles = cat.titles || [];
  state.cards = cards.cards || [];
  state.holds = holds.holds || [];
  state.loans = loans.loans || [];
  state.fines = fines.fines || [];
  state.rooms = rooms.rooms || [];
  state.bookings = bookings.bookings || [];
  render();
}

async function runWrite(label, tool, args) {
  try {
    const res = await callTool(tool, {
      ...args,
      expected_version: state.version,
      request_id: nextReq(label),
    });
    if (res.status === 'committed') {
      state.statusMessage = `${label}: committed (v${res.version.epoch}.${res.version.revision})`;
    } else {
      state.statusMessage = `${label}: ${res.error ? `${res.error.code} - ${res.error.message}` : res.status}`;
    }
    await refreshAll();
  } catch (err) {
    state.statusMessage = `${label}: ${err.message}`;
    render();
  }
}

function renderCatalog() {
  const input = el('input', {
    type: 'search',
    placeholder: 'Search title, author, or subject...',
    value: state.query,
  });
  const searchBtn = el('button', { type: 'button' }, 'Search');
  searchBtn.addEventListener('click', () => {
    state.query = input.value.trim();
    refreshAll();
  });
  const branchSel = el('select', {});
  for (const b of state.branches) {
    const opt = el('option', { value: b.id }, b.name);
    if (b.id === state.selectedBranchId) opt.selected = true;
    branchSel.appendChild(opt);
  }
  branchSel.addEventListener('change', () => { state.selectedBranchId = branchSel.value; });

  const cardSel = el('select', {});
  for (const c of state.cards) {
    const opt = el('option', { value: c.id }, `${c.holder_name} (${c.card_status})`);
    if (c.id === state.selectedCardId) opt.selected = true;
    cardSel.appendChild(opt);
  }
  cardSel.addEventListener('change', () => { state.selectedCardId = cardSel.value; });

  const controls = el('div', { class: 'toolbar' }, input, searchBtn, el('label', {}, ' Card: ', cardSel), el('label', {}, ' Pickup: ', branchSel));
  const list = el('div', { class: 'list' });
  for (const t of state.titles) {
    const btn = el('button', { type: 'button', 'data-action': 'place-hold', 'data-id': t.id }, 'Place Hold');
    btn.addEventListener('click', () =>
      runWrite('hold.place', 'shelfmark-library.hold.place', {
        title_id: t.id,
        card_id: state.selectedCardId,
        pickup_branch_id: state.selectedBranchId,
      })
    );
    list.appendChild(
      el(
        'article',
        { class: 'card' },
        el('h3', {}, `${t.title} (${t.format})`),
        el('p', {}, `${t.author} · ISBN ${t.isbn} · Queue: ${t.queued_patrons}`),
        btn
      )
    );
  }
  return el('section', { 'data-view': 'catalog' }, controls, list);
}

function renderCardsAndFines() {
  const cardList = el('div', { class: 'list' });
  for (const c of state.cards) {
    const payBtn = el('button', { type: 'button', 'data-action': 'pay-fines', 'data-id': c.id }, 'Pay Open Fines');
    payBtn.addEventListener('click', () =>
      runWrite('fine.pay', 'shelfmark-library.fine.pay', { card_id: c.id, payment_method: 'card_on_file' })
    );
    cardList.appendChild(
      el(
        'article',
        { class: 'card' },
        el('h3', {}, `${c.holder_name} (${c.role}) · ${c.card_status}`),
        el('p', {}, `Open: $${(c.open_fines_cents / 100).toFixed(2)} · Disputed: $${(c.disputed_fines_cents / 100).toFixed(2)} · Threshold: $${(c.block_threshold_cents / 100).toFixed(2)}`),
        c.open_fines_cents > 0 ? payBtn : el('span', {}, 'No open fines')
      )
    );
  }
  const fineList = el('div', { class: 'list' });
  for (const f of state.fines) {
    const actions = [];
    if (f.status === 'open') {
      const disputeBtn = el('button', { type: 'button', 'data-action': 'dispute-fine', 'data-id': f.id }, 'Dispute Fine');
      disputeBtn.addEventListener('click', () =>
        runWrite('fine.dispute', 'shelfmark-library.fine.dispute', {
          fine_id: f.id,
          reason: 'Item returned at branch drop box',
        })
      );
      const payOneBtn = el('button', { type: 'button', 'data-action': 'pay-fine', 'data-id': f.id }, 'Pay This Fine');
      payOneBtn.addEventListener('click', () =>
        runWrite('fine.pay', 'shelfmark-library.fine.pay', { card_id: f.card_id, fine_ids: [f.id] })
      );
      actions.push(payOneBtn, disputeBtn);
    }
    fineList.appendChild(
      el(
        'article',
        { class: 'card' },
        el('h4', {}, `${f.id} · $${(f.amount_cents / 100).toFixed(2)} · ${f.status}`),
        el('p', {}, `Card: ${f.card_id} · Reason: ${f.reason}`),
        ...actions
      )
    );
  }
  return el('section', { 'data-view': 'cards-fines' }, el('h2', {}, 'Managed Household Cards'), cardList, el('h2', {}, 'Fine Ledger'), fineList);
}

function renderHoldsAndLoans() {
  const holdList = el('div', { class: 'list' });
  for (const h of state.holds) {
    const actions = [];
    if (h.effective_status === 'queued') {
      const suspBtn = el('button', { type: 'button', 'data-action': 'suspend-hold', 'data-id': h.id }, 'Suspend 7d');
      suspBtn.addEventListener('click', () => {
        const resumeIso = new Date(Date.parse(state.virtualNow || '2026-11-18T09:00:00+00:00') + 7 * 86400000).toISOString().replace('Z', '+00:00');
        runWrite('hold.suspend', 'shelfmark-library.hold.suspend', { hold_id: h.id, resume_at: resumeIso });
      });
      actions.push(suspBtn);
    }
    if (h.effective_status === 'suspended') {
      const resBtn = el('button', { type: 'button', 'data-action': 'resume-hold', 'data-id': h.id }, 'Resume');
      resBtn.addEventListener('click', () => runWrite('hold.resume', 'shelfmark-library.hold.resume', { hold_id: h.id }));
      actions.push(resBtn);
    }
    if (['queued', 'suspended', 'ready_for_pickup'].includes(h.effective_status)) {
      const cancelBtn = el('button', { type: 'button', 'data-action': 'cancel-hold', 'data-id': h.id }, 'Cancel Hold');
      cancelBtn.addEventListener('click', () => runWrite('hold.cancel', 'shelfmark-library.hold.cancel', { hold_id: h.id }));
      actions.push(cancelBtn);
    }
    holdList.appendChild(
      el(
        'article',
        { class: 'card' },
        el('h4', {}, `${h.id} · ${h.title_name || h.title_id} · ${h.effective_status}`),
        el('p', {}, `Card: ${h.card_id} · Branch: ${h.pickup_branch_name || h.pickup_branch_id} · Queue #${h.queue_position}`),
        ...actions
      )
    );
  }

  const loanList = el('div', { class: 'list' });
  for (const l of state.loans) {
    const actions = [];
    if (l.status !== 'returned') {
      const renewBtn = el('button', { type: 'button', 'data-action': 'renew-loan', 'data-id': l.id }, 'Renew Loan');
      renewBtn.addEventListener('click', () => runWrite('loan.renew', 'shelfmark-library.loan.renew', { loan_id: l.id }));
      actions.push(renewBtn);
    }
    loanList.appendChild(
      el(
        'article',
        { class: 'card' },
        el('h4', {}, `${l.id} · ${l.title_name || l.title_id} · ${l.effective_status}`),
        el('p', {}, `Card: ${l.card_id} · Due: ${l.due_at} · Renewals: ${l.renewals_used}/${l.max_renewals}`),
        ...actions
      )
    );
  }
  return el('section', { 'data-view': 'holds-loans' }, el('h2', {}, 'Holds'), holdList, el('h2', {}, 'Loans'), loanList);
}

function renderRooms() {
  const roomList = el('div', { class: 'list' });
  for (const r of state.rooms) {
    const bookBtn = el('button', { type: 'button', 'data-action': 'book-room', 'data-id': r.id }, 'Book Tomorrow 10:00-12:00');
    bookBtn.addEventListener('click', () =>
      runWrite('room.book', 'shelfmark-library.room.book', {
        room_id: r.id,
        card_id: state.selectedCardId,
        start_at: '2026-11-23T10:00:00+00:00',
        end_at: '2026-11-23T12:00:00+00:00',
        purpose: 'Study session',
      })
    );
    roomList.appendChild(
      el(
        'article',
        { class: 'card' },
        el('h4', {}, `${r.name} (${r.kind})`),
        el('p', {}, `${r.branch_name || r.branch_id} · Cap ${r.capacity} · ${(r.amenities || []).join(', ')}`),
        bookBtn
      )
    );
  }
  const bookingList = el('div', { class: 'list' });
  for (const b of state.bookings) {
    const actions = [];
    if (b.status === 'confirmed') {
      const cancelBtn = el('button', { type: 'button', 'data-action': 'cancel-booking', 'data-id': b.id }, 'Cancel Booking');
      cancelBtn.addEventListener('click', () => runWrite('room.cancel', 'shelfmark-library.room.cancel', { booking_id: b.id }));
      actions.push(cancelBtn);
    }
    bookingList.appendChild(
      el(
        'article',
        { class: 'card' },
        el('h4', {}, `${b.id} (${b.confirmation_code}) · ${b.status}`),
        el('p', {}, `Room: ${b.room_id} · Card: ${b.card_id} · ${b.start_at} -> ${b.end_at}`),
        ...actions
      )
    );
  }
  return el('section', { 'data-view': 'rooms' }, el('h2', {}, 'Study Rooms & Museum Passes'), roomList, el('h2', {}, 'Reservations'), bookingList);
}

function render() {
  root.textContent = '';
  const tabs = [
    ['catalog', 'Catalog'],
    ['cards-fines', 'Cards & Fines'],
    ['holds-loans', 'Holds & Loans'],
    ['rooms', 'Study Rooms & Passes'],
  ];
  const nav = el('nav', { class: 'tabs' });
  for (const [id, label] of tabs) {
    const btn = el('button', { type: 'button', class: state.tab === id ? 'active' : '' }, label);
    btn.addEventListener('click', () => {
      state.tab = id;
      render();
    });
    nav.appendChild(btn);
  }
  const header = el(
    'header',
    {},
    el('h1', {}, 'ShelfMark Public Library'),
    el('p', {}, `Virtual clock: ${state.virtualNow} · State version: v${state.version ? `${state.version.epoch}.${state.version.revision}` : '0.0'}`),
    state.statusMessage ? el('p', { class: 'status' }, state.statusMessage) : el('span', {}),
    nav
  );
  let body;
  if (state.tab === 'catalog') body = renderCatalog();
  else if (state.tab === 'cards-fines') body = renderCardsAndFines();
  else if (state.tab === 'holds-loans') body = renderHoldsAndLoans();
  else body = renderRooms();
  root.appendChild(el('main', {}, header, body));
}

connect().then((c) => {
  client = c;
  return refreshAll();
});
