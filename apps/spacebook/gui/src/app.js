import { el, tag, metadata, textBlock } from "/shared/client.js";
const tools = {
  context: "spacebook.context",
  search: "spacebook.resources.search",
  resource: "spacebook.resources.get",
  list: "spacebook.bookings.list",
  get: "spacebook.bookings.get",
  hold: "spacebook.holds.create",
  release: "spacebook.holds.release",
  confirm: "spacebook.holds.confirm",
  replace: "spacebook.bookings.replace",
  cancel: "spacebook.bookings.cancel",
  notices: "spacebook.notifications.list",
  read: "spacebook.notifications.read",
};
let csrf,
  version,
  context,
  resources = [],
  bookings = [],
  notices = [],
  allowed = new Set(),
  section = "search",
  selected = null,
  searchArgs = null,
  busy = false;
const status = el("p", { role: "status", id: "status" }),
  list = el("div", { id: "records" }),
  detail = el("article", { "aria-label": "Details" }),
  nav = el("nav", { "aria-label": "SpaceBook navigation" }),
  dialog = el("dialog"),
  clock = el("small", {}),
  filterArea = el("div", { class: "collection-head" });
const heading = el("h2", { class: "section-title" }, "Find a room");
const button = (label, fn, attrs = {}) =>
  el(
    "button",
    {
      type: "button",
      onclick: () => Promise.resolve().then(fn).catch(error),
      ...attrs,
    },
    label,
  );
const error = (e) => {
  status.textContent = e.message;
  status.dataset.error = "true";
};
const fmt = (value) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: context.office.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
const resourceName = (id) => resources.find((r) => r.id === id)?.name || id;
const readable = (s) => s.replaceAll("_", " ");
const root = document.querySelector("#app");
root.replaceChildren(
  el(
    "div",
    { class: "app-shell" },
    el(
      "aside",
      { class: "sidebar" },
      el(
        "div",
        { class: "brand" },
        el("span", { class: "brand-mark" }, "S"),
        el("h1", {}, "SpaceBook"),
      ),
      nav,
      el("div", { class: "sidebar-foot" }, clock),
    ),
    el(
      "main",
      { class: "app-main" },
      el(
        "header",
        { class: "toolbar" },
        el("strong", {}, "Rooms & equipment"),
        button("Refresh", () => refresh()),
      ),
      status,
      el(
        "div",
        { class: "workspace" },
        el(
          "section",
          { class: "collection" },
          el("div", { class: "collection-head" }, heading),
          filterArea,
          list,
        ),
        el("section", { class: "detail" }, detail),
      ),
    ),
  ),
  dialog,
);
async function request(url, method = "GET", body) {
  const r = await fetch(url, {
    method,
    headers:
      method === "POST"
        ? { "Content-Type": "application/json", "X-Pale-CSRF": csrf }
        : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await r.json();
  if (!r.ok) throw Error(result.error || "Request failed");
  return result;
}
async function call(name, args = {}) {
  const r = await request("/api/call", "POST", { name, arguments: args });
  if (!["ok", "committed"].includes(r.status))
    throw Object.assign(
      Error(
        r.status === "stale_version"
          ? "Availability changed. Close this form and refresh before trying again."
          : r.message || r.status,
      ),
      { code: r.status },
    );
  return r;
}
function parts(value) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: context.office.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .map((p) => [p.type, p.value]),
  );
}
function localInput(value) {
  const p = parts(value);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function toInstant(value) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))
    throw Error("Enter a valid date and time.");
  const target = Date.parse(value + "Z");
  let candidate = target;
  for (let i = 0; i < 4; i++) {
    const shown = Date.parse(localInput(candidate) + "Z");
    candidate += target - shown;
  }
  if (localInput(candidate) !== value)
    throw Error("This local time does not exist in the office time zone.");
  return new Date(candidate).toISOString();
}
function defaultInterval() {
  const p = parts(context.virtual_now);
  let day = new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`);
  for (let i = 0; i < 370; i++) {
    const date = day.toISOString().slice(0, 10),
      start = toInstant(date + "T14:00");
    if (
      context.office.weekdays.includes(day.getUTCDay()) &&
      Date.parse(start) > Date.parse(context.virtual_now)
    )
      return { start_at: start, end_at: toInstant(date + "T15:00") };
    day.setUTCDate(day.getUTCDate() + 1);
  }
  throw Error("No open date found.");
}
function setBusy(value) {
  busy = value;
  root.setAttribute("aria-busy", String(value));
  for (const b of document.querySelectorAll("#app button"))
    b.disabled = value || Boolean(b.dataset.denied);
}
async function refresh() {
  if (busy) return;
  setBusy(true);
  try {
    allowed = new Set((await request("/api/tools")).tools.map((t) => t.name));
    const c = await call(tools.context);
    context = c;
    version = c.version;
    searchArgs = searchArgs || defaultInterval();
    const r = await call(tools.search, searchArgs);
    resources = r.items;
    version = r.version;
    const b = await call(tools.list);
    bookings = b.items;
    version = b.version;
    const n = await call(tools.notices);
    notices = n.items;
    version = n.version;
    clock.textContent = `${context.office.name} · ${context.office.timezone} · ${fmt(context.virtual_now)}`;
    render();
    status.textContent = "Availability refreshed";
    delete status.dataset.error;
  } finally {
    setBusy(false);
  }
}
function can(label, name, fn) {
  return button(
    label,
    fn,
    allowed.has(name) ? {} : { disabled: true, "data-denied": "true" },
  );
}
function navigate(id) {
  section = id;
  selected = null;
  render();
}
function render() {
  nav.replaceChildren(
    ...[
      ["search", "Find a room"],
      ["holds", "My holds"],
      ["bookings", "My bookings"],
      ["notices", "Activity & notices"],
    ].map(([id, label]) =>
      button(label, () => navigate(id), {
        "aria-current": section === id ? "page" : null,
      }),
    ),
  );
  heading.textContent = {
    search: "Find a room",
    holds: "My holds",
    bookings: "My bookings",
    notices: "Activity & notices",
  }[section];
  filterArea.replaceChildren();
  list.replaceChildren();
  detail.replaceChildren(el("p", {}, "Choose a record to see details."));
  if (section === "search") {
    const start = el("input", {
        type: "datetime-local",
        value: localInput(searchArgs.start_at),
        required: true,
        "aria-label": "Search start",
      }),
      end = el("input", {
        type: "datetime-local",
        value: localInput(searchArgs.end_at),
        required: true,
        "aria-label": "Search end",
      });
    const form = el(
      "form",
      {},
      el("label", {}, "From", start),
      el("label", {}, "Until", end),
      el("small", {}, context.office.timezone),
      el("button", { type: "submit" }, "Search availability"),
    );
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        searchArgs = {
          start_at: toInstant(start.value),
          end_at: toInstant(end.value),
        };
        await refresh();
      } catch (e) {
        error(e);
      }
    };
    filterArea.append(form);
    for (const r of resources.filter((r) => r.kind === "room"))
      list.append(
        row(
          r.id,
          r.name,
          `${r.capacity} people · ${r.available ? "Available" : "Unavailable"}`,
          () => showResource(r.id),
        ),
      );
  } else if (section === "holds") {
    for (const h of context.holds)
      list.append(
        row(
          h.id,
          h.title,
          `${readable(h.status)} · ${resourceName(h.room_id)}`,
          () => showHold(h.id),
        ),
      );
  } else if (section === "bookings") {
    for (const b of bookings.slice().reverse())
      list.append(
        row(
          b.id,
          b.title,
          `${readable(b.status)}${b.past ? " · Past" : ""} · ${resourceName(b.room_id)}`,
          () => showBooking(b.id),
        ),
      );
  } else
    for (const n of notices.slice().reverse())
      list.append(
        row(
          n.id,
          readable(n.type),
          `${n.read ? "Read" : "Unread"} · ${fmt(n.at)}`,
          () => showNotice(n.id),
        ),
      );
  if (!list.children.length) list.append(el("p", {}, "Nothing here yet."));
}
function row(id, title, subtitle, fn) {
  return button("", fn, { class: "record", "data-record-id": id }).appendChild(
    el("span", {}, el("strong", {}, title), el("small", {}, subtitle)),
  ).parentNode;
}
function recordDetails(r) {
  return [
    el("h2", {}, r.title),
    el("div", { class: "tags" }, tag(readable(r.status))),
    metadata("Room", resourceName(r.room_id)),
    metadata(
      "Equipment",
      r.equipment_ids.map(resourceName).join(", ") || "None",
    ),
    metadata("Starts", fmt(r.start_at)),
    metadata("Ends", fmt(r.end_at)),
  ];
}
async function showResource(id) {
  selected = id;
  setBusy(true);
  try {
    const r = await call(tools.resource, { id, ...searchArgs });
    version = r.version;
    const x = r.item;
    detail.replaceChildren(
      el("h2", {}, x.name),
      metadata("Capacity", x.capacity + " people"),
      metadata(
        "Step-free access",
        x.step_free === null ? "Unknown" : x.step_free ? "Yes" : "No",
      ),
      metadata(
        "Built-in video",
        x.video === null ? "Unknown" : x.video ? "Yes" : "No",
      ),
      el(
        "div",
        { class: "tags" },
        tag(x.available ? "Available" : "Unavailable"),
      ),
      el("h3", {}, "Busy intervals"),
      ...x.busy.map((b) =>
        el(
          "p",
          {},
          `${readable(b.kind)} · ${fmt(b.start_at)} – ${fmt(b.end_at)}`,
        ),
      ),
      can("Hold this room", tools.hold, () => bundleForm(null, x.id)),
    );
  } finally {
    setBusy(false);
  }
}
function showHold(id) {
  const h = context.holds.find((x) => x.id === id);
  selected = id;
  detail.replaceChildren(
    ...recordDetails(h),
    metadata("Hold expires", fmt(h.expires_at)),
    el("p", {}, "A hold is temporary. Confirm it to make a reservation."),
  );
  if (h.status === "active")
    detail.append(
      can("Confirm booking", tools.confirm, () =>
        simpleForm(
          "Confirm booking",
          tools.confirm,
          { id },
          "Confirm this room and equipment?",
          () => {
            section = "bookings";
          },
        ),
      ),
      can("Release hold", tools.release, () =>
        simpleForm(
          "Release hold",
          tools.release,
          { id },
          "Release this room and all held equipment?",
        ),
      ),
    );
}
async function showBooking(id) {
  selected = id;
  setBusy(true);
  try {
    const response = await call(tools.get, { id });
    version = response.version;
    const b = response.item;
    detail.replaceChildren(
      ...recordDetails(b),
      metadata("Previous booking", b.previous_id || "None"),
      metadata("Replacement booking", b.replacement_id || "None"),
      el("h3", {}, "Activity"),
      ...b.history.map((h) =>
        el(
          "p",
          {},
          `${fmt(h.at)} · ${readable(h.action)}${h.reason ? " · " + h.reason : ""}`,
        ),
      ),
    );
    if (
      ["confirmed", "disrupted"].includes(b.status) &&
      Date.parse(b.start_at) > Date.parse(context.virtual_now)
    )
      detail.append(
        can("Change booking", tools.replace, () => bundleForm(b)),
        can("Cancel booking", tools.cancel, () =>
          simpleForm(
            "Cancel booking",
            tools.cancel,
            { id },
            "Cancel this booking and release its resources?",
          ),
        ),
      );
  } finally {
    setBusy(false);
  }
}
function showNotice(id) {
  const n = notices.find((x) => x.id === id);
  detail.replaceChildren(
    el("h2", {}, readable(n.type)),
    textBlock(n.reason),
    metadata("When", fmt(n.at)),
    metadata("Status", n.read ? "Read" : "Unread"),
  );
  if (!n.read)
    detail.append(
      can("Mark read", tools.read, () =>
        simpleForm(
          "Mark read",
          tools.read,
          { id },
          "Mark this notice as read?",
        ),
      ),
    );
  if (bookings.some((b) => b.id === n.object_id))
    detail.append(button("View booking", () => showBooking(n.object_id)));
}
function formShell(title, name, argsBuilder, contents, onSuccess = () => {}) {
  const captured = structuredClone(version);
  let pending = null;
  const msg = el("p", { role: "alert" }),
    submit = el("button", { type: "submit" }, title),
    close = button("Close", () => dialog.close()),
    form = el(
      "form",
      {},
      el("h2", {}, title),
      ...contents,
      msg,
      el("div", { class: "actions" }, close, submit),
    );
  dialog.replaceChildren(form);
  form.onsubmit = async (event) => {
    event.preventDefault();
    submit.disabled = true;
    close.disabled = true;
    try {
      const args = { ...argsBuilder(), expected_version: captured },
        signature = JSON.stringify(args);
      if (!pending || pending.signature !== signature)
        pending = { signature, id: "web-" + crypto.randomUUID() };
      const result = await call(name, { ...args, request_id: pending.id });
      onSuccess(result);
      dialog.close();
      await refresh();
      status.textContent = "Changes saved";
    } catch (e) {
      msg.textContent = e.message;
      msg.dataset.code = e.code || "request_failed";
    } finally {
      submit.disabled = false;
      close.disabled = false;
    }
  };
  dialog.showModal();
}
function simpleForm(title, name, args, explanation, onSuccess) {
  formShell(title, name, () => args, [el("p", {}, explanation)], onSuccess);
}
function bundleForm(booking, roomId) {
  const initial = booking || {
    ...searchArgs,
    room_id: roomId,
    equipment_ids: [],
    title: "",
  };
  const title = el("input", {
      name: "title",
      value: initial.title,
      required: true,
      maxlength: 200,
      "aria-label": "Meeting title",
    }),
    room = el(
      "select",
      { "aria-label": "Room" },
      ...resources
        .filter((r) => r.kind === "room")
        .map((r) =>
          el(
            "option",
            { value: r.id, selected: r.id === initial.room_id },
            `${r.name} · ${r.capacity} people`,
          ),
        ),
    );
  const equipment = resources
    .filter((r) => r.kind === "equipment")
    .map((r) => ({
      r,
      input: el("input", {
        type: "checkbox",
        value: r.id,
        checked: initial.equipment_ids.includes(r.id),
        "aria-label": r.name,
      }),
    }));
  const start = el("input", {
      type: "datetime-local",
      value: localInput(initial.start_at),
      required: true,
      "aria-label": "Booking start",
    }),
    end = el("input", {
      type: "datetime-local",
      value: localInput(initial.end_at),
      required: true,
      "aria-label": "Booking end",
    });
  const controls = [
    el("label", {}, "Meeting title", title),
    el("label", {}, "Room", room),
    el("label", {}, "Starts", start),
    el("label", {}, "Ends", end),
    el("small", {}, context.office.timezone),
    el("h3", {}, "Equipment (up to two)"),
    ...equipment.map(({ r, input }) => el("label", {}, input, r.name)),
    el(
      "p",
      {},
      booking
        ? "The existing booking changes only if all replacement resources are available."
        : "This creates a temporary hold. Confirm separately to reserve the room.",
    ),
  ];
  formShell(
    booking ? "Save replacement" : "Create hold",
    booking ? tools.replace : tools.hold,
    () => ({
      ...(booking ? { id: booking.id } : {}),
      title: title.value,
      room_id: room.value,
      equipment_ids: equipment
        .filter((x) => x.input.checked)
        .map((x) => x.r.id),
      start_at: toInstant(start.value),
      end_at: toInstant(end.value),
    }),
    controls,
    () => {
      section = booking ? "bookings" : "holds";
    },
  );
}
try {
  const token = new URLSearchParams(location.hash.slice(1)).get("access");
  if (token) {
    history.replaceState(null, "", location.pathname);
    ({ csrf } = await request("/session", "POST", { token }));
  } else ({ csrf } = await request("/session"));
  await refresh();
} catch (e) {
  error(e);
}
