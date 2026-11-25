import {mount, el, tag} from '/shared/client.js';

// The three v1 views of the enrollment portal: Catalog, My schedule, and
// Waitlists & offers. This file owns only presentation. Every number on the
// page was read through the same Agent MCP tools an Agent uses, every button
// calls one of them, and nothing is stored in the browser: the App's ledger is
// the single source of truth. The shared client supplies the connection, the
// version each write is checked against, and safe retries.
const APP = 'university-course-registration';
const T = name => APP + '.' + name;

// ---- text ---------------------------------------------------------------------
const days = list => list.map(d => d[0] + d.slice(1).toLowerCase()).join('/');
const times = meetings => meetings.length ? meetings.map(m => days(m.days) + ' ' + m.start + '–' + m.end).join(', ') : 'No meetings';
const seats = s => (s.available > 0 ? s.available + ' of ' + s.capacity + ' seats free' : 'Full (' + s.capacity + ' seats)')
  + (s.held ? ', ' + s.held + ' held for offers' : '');
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

// ---- what the page knows, all of it read from the App ----------------------------
const catalog = ui => ui.aux.catalog || ui.records;
const sectionOf = (ui, id) => {
  for (const course of catalog(ui)) for (const section of course.sections) if (section.id === id) return {course, section};
  return null;
};
const sectionName = (ui, id) => { const found = sectionOf(ui, id); return found ? found.course.code + ' ' + found.section.label : id; };
const bundleName = (ui, ids) => ids.map(id => { const found = sectionOf(ui, id); return found ? found.section.label : id; }).join(' + ');
const enrollmentFor = (ui, course) => (ui.aux.schedule ? ui.aux.schedule.enrollments : []).find(e => e.course_id === course.id) || null;
const entriesFor = (ui, course) => (ui.aux.waitlist ? ui.aux.waitlist.entries : []).filter(e => e.course_id === course.id);
const offerFor = (ui, entry) => (ui.aux.waitlist ? ui.aux.waitlist.offers : []).find(o => o.entry_id === entry.id) || null;
const sameBundle = (a, b) => a.length === b.length && a.every(id => b.includes(id));

// A button that runs one business operation and then re-reads the App.
function operation(ui, label, tool, args, course, primary) {
  if (!ui.has(T(tool))) return null;
  const button = el('button', {type: 'button', class: primary ? 'primary' : '', 'data-operation': tool}, label);
  button.addEventListener('click', async () => {
    try {
      await ui.perform(T(tool), args, {refreshAfter: false});
      await ui.refresh(course.id);
    } catch (error) { ui.error(error); }
  });
  return button;
}
const line = (label, ...content) => el('div', {class: 'metadata-line'}, el('span', {}, label), el('strong', {}, ...content));
const heading = text => el('h3', {}, text);
const note = text => el('p', {class: 'muted'}, text);

// ---- lists ------------------------------------------------------------------------
function row(course, ui) {
  const enrollment = enrollmentFor(ui, course), entries = entriesFor(ui, course);
  let subtitle = course.credits + ' credits · ' + course.sections.map(s => s.label + (s.available > 0 ? ': ' + s.available + ' free' : ': full')).join(' · ');
  if (ui.section === 'schedule' && enrollment) subtitle = enrollment.sections.map(s => s.label + ' ' + times(s.meetings)).join(' · ');
  if (ui.section === 'waitlists') {
    subtitle = entries.map(entry => {
      const offer = offerFor(ui, entry);
      if (offer) return (offer.expired ? 'Offer passed its deadline ' : 'Seat offered until ') + offer.expires_at;
      return bundleName(ui, entry.section_ids) + ': rank ' + entry.rank + (entry.blocked_by.length ? ', blocked' : '');
    }).join(' · ');
  }
  return ui.record(course,
    el('span', {class: 'record-title'}, course.code + ' · ' + course.title),
    el('span', {class: 'record-subtitle'}, subtitle),
    el('span', {class: 'tags'}, enrollment ? tag('Enrolled') : null,
      entries.some(entry => offerFor(ui, entry)) ? tag('Seat offered') : entries.length ? tag('Waiting') : null));
}

function conflictText(ui, conflict) {
  const [a, b] = conflict.section_ids, cause = conflict.caused_by;
  return sectionName(ui, a) + ' overlaps ' + sectionName(ui, b) + (cause
    ? '. Cause: ' + sectionName(ui, cause.section_id) + ' was moved at ' + cause.replaced_at + ' by ' + cause.event_id
      + ' (section version ' + cause.from_version + ' to ' + cause.to_version + '). No enrollment was dropped.'
    : '.');
}

function scheduleSummary(ui) {
  const schedule = ui.aux.schedule;
  if (!schedule) return note('The schedule is not available to this account.');
  const box = el('section', {class: 'query-result', 'aria-label': 'Schedule summary', 'data-summary': 'schedule'},
    line('Credits', schedule.credits.enrolled + ' of ' + schedule.credits.limit),
    line('Time conflicts', schedule.conflicts.length ? String(schedule.conflicts.length) : 'None'));
  for (const conflict of schedule.conflicts) box.append(el('p', {role: 'note', 'data-conflict': conflict.section_ids.join(' ')}, conflictText(ui, conflict)));
  if (schedule.pending_swaps.length) box.append(note(plural(schedule.pending_swaps.length, 'pending swap') + ': see Waitlists & offers.'));
  return box;
}

function waitlistSummary(ui) {
  const waitlist = ui.aux.waitlist;
  if (!waitlist) return note('Waitlists are not available to this account.');
  return el('section', {class: 'query-result', 'aria-label': 'Waitlist summary', 'data-summary': 'waitlists'},
    line('Waiting', waitlist.entries.length + (waitlist.entries.length === 1 ? ' entry' : ' entries')),
    line('Seat offers open', String(waitlist.offers.length)),
    note('A place in a queue or a seat offer is not an enrollment and adds no credits.'));
}

const EMPTY = {
  catalog: ['No courses found', 'Try a different search.'],
  schedule: ['No enrollments', 'Courses you enroll in appear here.'],
  waitlists: ['Not waiting for anything', 'Join a waitlist from a full bundle in the Catalog.']
};
function renderList(shown, ui) {
  const fragment = document.createDocumentFragment();
  if (ui.section === 'schedule') fragment.append(scheduleSummary(ui));
  if (ui.section === 'waitlists') fragment.append(waitlistSummary(ui));
  for (const course of shown) fragment.append(row(course, ui));
  if (!shown.length) fragment.append(el('div', {class: 'empty'}, el('h3', {}, (EMPTY[ui.section] || EMPTY.catalog)[0]), el('p', {}, (EMPTY[ui.section] || EMPTY.catalog)[1])));
  return fragment;
}

// ---- the ways a course can be taken, with the operation each one allows --------------
function bundleLines(detail, ui) {
  const course = detail.course, held = enrollmentFor(ui, course), entries = entriesFor(ui, course);
  const table = new Map(course.sections.map(s => [s.id, s]));
  return detail.bundles.map(bundle => {
    const ids = bundle.section_ids, label = ids.map(id => table.get(id).label).join(' + ');
    const waitingHere = entries.find(entry => sameBundle(entry.section_ids, ids));
    // For a swap only the sections not already held need a seat.
    const needed = held ? ids.filter(id => !held.sections.some(s => s.id === id)) : ids;
    const free = needed.every(id => table.get(id).available > 0);
    let state, control = null;
    if (held && sameBundle(held.sections.map(s => s.id), ids)) state = 'Your enrollment';
    else if (waitingHere) state = offerFor(ui, waitingHere) ? 'A seat is on offer to you: see Waitlists & offers' : 'You are waiting, rank ' + waitingHere.rank;
    else if (held && free) { state = 'Seats available'; control = operation(ui, 'Swap to ' + label, 'enrollment.swap', {id: held.id, section_ids: ids}, course, true); }
    else if (held) { state = 'No seat now'; control = operation(ui, 'Wait for ' + label + ', keeping my place', 'waitlist.join', {section_ids: ids, swap_from_enrollment_id: held.id}, course); }
    else if (free) { state = 'Seats available'; control = operation(ui, 'Enroll in ' + label, 'enrollment.enroll', {section_ids: ids}, course, true); }
    else { state = 'No seat now'; control = operation(ui, 'Join waitlist for ' + label, 'waitlist.join', {section_ids: ids}, course); }
    return el('div', {class: 'metadata-line', 'data-bundle': ids.join(' ')}, el('span', {}, label), el('strong', {}, state, control ? ' ' : null, control));
  });
}

function eligibility(detail, ui) {
  const course = detail.course, record = ui.aux.record;
  const out = [heading('Sections')];
  for (const s of course.sections) {
    out.push(line(s.label + ' · ' + times(s.meetings), seats(s)));
    if (s.linked_lecture_ids) out.push(note(s.label + ' can only be taken with ' + s.linked_lecture_ids.map(id => (course.sections.find(x => x.id === id) || {label: id}).label).join(' or ') + '.'));
  }
  out.push(heading('Eligibility'));
  out.push(line('Prerequisites', detail.prerequisites.length
    ? detail.prerequisites.map(p => p.code + (p.completed ? ' (completed)' : ' (not completed)')).join(', ') : 'None'));
  out.push(line('Registration', (detail.registration.open ? 'Open until ' : 'Closed. Window: ' + detail.registration.opens_at + ' to ') + detail.registration.closes_at));
  if (record) out.push(line('Your credits', record.credits.enrolled + ' of ' + record.credits.limit + ' in use; this course is ' + course.credits));
  out.push(heading(course.requires_lab ? 'Lecture and lab combinations' : 'Sections you can take'));
  out.push(...bundleLines(detail, ui));
  out.push(note('The App checks every rule again when you act; a refusal is shown above and changes nothing.'));
  return out;
}

// Course detail is read again for the combinations and the eligibility facts.
function withDetail(course, ui, render) {
  const more = el('div', {'data-detail': course.id}, note('Loading…'));
  ui.call(T('course.get'), {id: course.id}).then(detail => { if (more.isConnected) more.replaceChildren(...render(detail)); }).catch(ui.error);
  return more;
}

// ---- view 1: Catalog -------------------------------------------------------------------
function catalogView(course, ui) {
  return el('article', {'data-view': 'catalog'},
    el('span', {class: 'kicker'}, course.department),
    el('h2', {}, course.code + ' · ' + course.title),
    el('div', {class: 'tags'}, tag(plural(course.credits, 'credit')), tag(course.requires_lab ? 'Lecture + lab' : 'Lecture only')),
    withDetail(course, ui, detail => eligibility(detail, ui)));
}

// ---- view 2: My schedule ---------------------------------------------------------------
function scheduleView(course, ui) {
  const enrollment = enrollmentFor(ui, course), schedule = ui.aux.schedule;
  if (!enrollment) return el('article', {'data-view': 'schedule'}, el('h2', {}, course.code + ' · ' + course.title), note('You are not enrolled in this course.'));
  const mine = new Set(enrollment.sections.map(s => s.id));
  const conflicts = schedule.conflicts.filter(c => c.section_ids.some(id => mine.has(id)));
  const pending = schedule.pending_swaps.filter(p => p.from_enrollment_id === enrollment.id);
  const box = el('article', {'data-view': 'schedule', 'data-enrollment': enrollment.id},
    el('span', {class: 'kicker'}, 'Enrolled'),
    el('h2', {}, course.code + ' · ' + course.title),
    el('div', {class: 'tags'}, tag(plural(enrollment.credits, 'credit')), conflicts.length ? tag('Time conflict') : null, pending.length ? tag('Swap pending') : null),
    ...enrollment.sections.map(s => line(s.label, times(s.meetings))),
    line('Enrolled at', enrollment.enrolled_at));
  if (conflicts.length) box.append(heading('Time conflicts'), ...conflicts.map(c => el('p', {role: 'note'}, conflictText(ui, c))));
  for (const swap of pending) {
    box.append(heading('Pending swap'), note('Waiting to move to ' + bundleName(ui, swap.section_ids) + ' (' + swap.status
      + '). This enrollment is kept until the replacement commits. Withdrawing from it cancels the pending swap.'));
  }
  box.append(heading('Change this enrollment'), el('div', {class: 'actions'},
    operation(ui, 'Withdraw from ' + course.code, 'enrollment.withdraw', {id: enrollment.id}, course)));
  box.append(withDetail(course, ui, detail => {
    const others = bundleLines(detail, ui).filter(node => !sameBundle(node.dataset.bundle.split(' '), [...mine]));
    return others.length ? [heading('Other sections of ' + course.code), ...others] : [note('This course has no other section to move to.')];
  }));
  return box;
}

// ---- view 3: Waitlists & offers ------------------------------------------------------------
function waitlistView(course, ui) {
  const entries = entriesFor(ui, course), held = enrollmentFor(ui, course);
  const box = el('article', {'data-view': 'waitlists'}, el('span', {class: 'kicker'}, 'Waitlist'), el('h2', {}, course.code + ' · ' + course.title));
  if (!entries.length) box.append(note('You are not waiting for this course.'));
  for (const entry of entries) {
    const offer = offerFor(ui, entry);
    const part = el('section', {'data-entry': entry.id},
      heading(bundleName(ui, entry.section_ids)),
      el('div', {class: 'tags'}, tag(offer ? 'Seat offered' : 'In queue'), entry.swap_from_enrollment_id ? tag('Swap') : null, entry.blocked_by.length ? tag('Blocked') : null),
      line('Rank', String(entry.rank)),
      line('Joined', entry.joined_at),
      line('Waiting for a seat in', entry.waiting_for_section_ids.length ? entry.waiting_for_section_ids.map(id => sectionName(ui, id)).join(', ') : 'Nothing: the seats are there'));
    if (entry.swap_from_enrollment_id) {
      part.append(note('Accepting an offer replaces your current ' + course.code + (held ? ' (' + held.sections.map(s => s.label).join(' + ') + ')' : '')
        + '. Until then you keep it; leaving this entry keeps it too.'));
    }
    for (const reason of entry.blocked_by) part.append(el('p', {role: 'note', 'data-blocked': reason.code}, 'Blocked (' + reason.code + '): ' + reason.message));
    if (entry.blocked_by.length) part.append(note('A blocked entry keeps its place but is passed over and holds no seat.'));
    if (offer) {
      part.append(line(offer.expired ? 'Offer deadline passed' : 'Seat held for you until', offer.expires_at),
        note(offer.expired ? 'This offer can no longer be accepted. You can decline it to release the seat.'
          : 'The offer is not an enrollment. It must be accepted before the deadline; at the deadline it is too late.'));
      part.append(el('div', {class: 'actions'},
        offer.expired ? null : operation(ui, 'Accept offer', 'offer.accept', {id: offer.id}, course, true),
        operation(ui, 'Decline offer', 'offer.decline', {id: offer.id}, course)));
    }
    part.append(el('div', {class: 'actions'}, operation(ui, 'Leave waitlist', 'waitlist.leave', {id: entry.id}, course)));
    box.append(part);
  }
  return box;
}

const VIEWS = {catalog: catalogView, schedule: scheduleView, waitlists: waitlistView};

export const config = {
  id: APP,
  title: 'Course Registration',
  description: 'Inspect courses, enroll, wait for seats and swap sections for one term.',
  symbol: '✎',
  searchLabel: 'Search courses',
  list: T('catalog.search'), collection: 'courses', queryField: 'query', listArgs: {},
  get: T('course.get'), item: 'course',
  heading: course => course.code + ' · ' + course.title,
  subtitle: course => plural(course.credits, 'credit') + ' · ' + course.department,
  initialSection: 'catalog',
  // Operations are offered where they apply, as buttons in the views below.
  actions: [],
  // The student's own schedule, waitlists and record, re-read with every refresh.
  load: async ui => {
    const read = (name, args = {}) => ui.has(T(name)) ? ui.call(T(name), args) : Promise.resolve(null);
    const [schedule, waitlist, record, all] = await Promise.all([read('schedule.get'), read('waitlist.list'), read('record.get'), read('catalog.search')]);
    return {schedule, waitlist, record, catalog: all ? all.courses : null};
  },
  sections: ui => [
    {id: 'catalog', label: 'Catalog', symbol: '▤'},
    {id: 'schedule', label: 'My schedule', symbol: '▦', filter: course => Boolean(enrollmentFor(ui, course))},
    {id: 'waitlists', label: 'Waitlists & offers', symbol: '⧖', filter: course => entriesFor(ui, course).length > 0}
  ],
  renderList,
  view: (course, ui) => (VIEWS[ui.section] || catalogView)(course, ui),
  emptyView: () => el('div', {class: 'empty'}, el('h3', {}, 'Nothing selected'), el('p', {}, 'Choose a course from the list.'))
};

mount(config);
