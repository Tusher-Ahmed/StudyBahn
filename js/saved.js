/* Shortlist page: deadline planner, saved list, compare table. */
(function () {
  const { $, $$, esc, icon, avatar, watchlist, compare, profile, match, deadlines, nextDeadline, deadlineBadge, fmtDate, daysLabel, degreeName, feeLabel, isFree, byId, store } = UH;
  UH.header("saved");

  let tab = (location.hash || "#planner").slice(1);
  if (!["planner", "saved", "compare"].includes(tab)) tab = "planner";

  const saved = () => watchlist.all().map((id) => byId.get(id)).filter(Boolean);
  const compared = () => compare.all().map((id) => byId.get(id)).filter(Boolean);

  function render() {
    $$(".page-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    const ns = saved().length;
    const nc = compared().length;
    $("#n-saved").textContent = ns || "";
    $("#n-saved").hidden = !ns;
    $("#n-cmp").textContent = nc || "";
    $("#n-cmp").hidden = !nc;
    $("#tab-body").innerHTML = tab === "planner" ? planner() : tab === "saved" ? savedList() : compareTable();
  }

  function emptyState(title, text) {
    return `<div class="empty"><h3>${title}</h3><p>${text}</p><a class="btn btn-primary" href="index.html">${icon("search")} Find programmes</a></div>`;
  }

  // ---------------------------------------------------------------- planner
  function allEvents() {
    const ev = [];
    saved().forEach((p) => deadlines(p).forEach((d) => ev.push({ p, d })));
    return ev.sort((a, b) => a.d.date - b.d.date);
  }
  function planner() {
    const list = saved();
    if (!list.length) return emptyState("No saved programmes yet", "Save programmes with the bookmark button and their deadlines will appear here in date order.");
    const ev = allEvents();
    const none = list.filter((p) => !deadlines(p).length);
    const byMonth = new Map();
    ev.forEach((e) => {
      const k = e.d.date.toLocaleString("en", { month: "long", year: "numeric" });
      if (!byMonth.has(k)) byMonth.set(k, []);
      byMonth.get(k).push(e);
    });
    return `
      <div class="row-gap" style="justify-content:space-between;margin-bottom:14px">
        <p class="muted" style="margin:0">${ev.length} upcoming deadline${ev.length === 1 ? "" : "s"} across ${list.length} saved programme${list.length === 1 ? "" : "s"} · showing ${profile.get().region === "EU" ? "EU/EEA" : "non-EU"} deadlines</p>
        ${ev.length ? `<button class="btn btn-primary btn-sm" id="ics-all">${icon("download")} Export all to calendar</button>` : ""}
      </div>
      <div class="planner">
        ${[...byMonth]
          .map(
            ([month, items]) => `
          <div class="month"><h3>${month}</h3><div class="timeline">
            ${items
              .map(
                ({ p, d }) => `
              <div class="dl-card ${d.state === "soon" ? "soon" : ""}">
                <div class="dl-cal"><div class="m">${d.date.toLocaleString("en", { month: "short" }).toUpperCase()}</div><div class="d">${d.date.getDate()}</div><div class="y">${d.date.getFullYear()}</div></div>
                <div>
                  <h4><a href="program.html?id=${p.id}" target="_blank" rel="noopener">${esc(p.n)}</a></h4>
                  <div class="who">${esc(p.u)} · ${esc(p.c)}${d.semester ? " · " + esc(d.semester) : ""}</div>
                  ${d.state === "notyet" ? `<div style="margin-top:6px"><span class="badge badge-info">Opens ${fmtDate(d.opens)}</span></div>` : ""}
                </div>
                <div class="dl-count"><b>${d.days}</b><span>days left</span></div>
              </div>`
              )
              .join("")}
          </div></div>`
          )
          .join("")}
        ${
          none.length
            ? `<div class="month"><h3>No fixed date</h3><div class="panel">${none
                .map((p) => `<div class="contact-line">${icon("infinity")}<span><a href="program.html?id=${p.id}" target="_blank" rel="noopener">${esc(p.n)}</a> <span class="muted">· ${esc(p.u)} — check the programme page</span></span></div>`)
                .join("")}</div></div>`
            : ""
        }
      </div>`;
  }

  // ---------------------------------------------------------------- saved list
  function savedList() {
    const list = saved();
    if (!list.length) return emptyState("Your shortlist is empty", "Tap the bookmark on any programme to save it here.");
    return `<div class="row-gap" style="justify-content:flex-end;margin-bottom:12px"><button class="btn btn-primary btn-sm" id="export-saved">${icon("download")} Export shortlist to Excel / PDF</button></div><div class="results">${list
      .map((p) => {
        const chk = store.get("check:" + p.id, []);
        const m = profile.isSet() ? match(p) : null;
        return `
        <article class="card">
          ${avatar(p.u)}
          <div>
            <h3><a href="program.html?id=${p.id}" target="_blank" rel="noopener">${esc(p.n)}</a></h3>
            <div class="uni"><span>${icon("cap")} ${esc(p.u)}</span><span>${icon("pin")} ${esc(p.c)}</span></div>
            <div class="tags">
              <span class="badge badge-primary">${degreeName(p.d)}</span>
              ${deadlineBadge(p)}
              <span class="badge">${icon("doc")} Checklist ${chk.length} done</span>
              ${m && m.status === "ok" ? `<span class="badge badge-ok">${icon("check")} You qualify</span>` : ""}
              ${m && m.status === "no" ? `<span class="badge badge-danger">${icon("x")} Language gap</span>` : ""}
            </div>
          </div>
          <div class="card-actions">
            <button class="icon-btn cmp ${compare.has(p.id) ? "on" : ""}" data-cmp="${p.id}" title="Compare">${icon("compare")}</button>
            <button class="icon-btn" data-remove="${p.id}" title="Remove from shortlist">${icon("trash")}</button>
          </div>
        </article>`;
      })
      .join("")}</div>`;
  }

  // ---------------------------------------------------------------- compare
  function compareTable() {
    const list = compared();
    const suggestions = saved().filter((p) => !compare.has(p.id));
    if (!list.length)
      return (
        emptyState("Nothing to compare yet", "Use the compare button on up to 4 programmes to see them side by side.") +
        (suggestions.length ? addFromSaved(suggestions) : "")
      );
    const prof = profile.get();
    const minIelts = Math.min(...list.map((p) => p.ielts || 99));
    const minLive = Math.min(...list.map((p) => p.live || 1e9));
    const nextDays = list.map((p) => (nextDeadline(p) || {}).days);
    const rows = [
      ["University", (p) => `${esc(p.u)}<br><span class="muted">${esc(p.c)}</span>`],
      ["Degree", (p) => degreeName(p.d)],
      ["Duration", (p) => esc(p.dur || "—")],
      ["Language", (p) => esc(UH.langLabel(p.l))],
      ["Tuition", (p) => `<span class="${isFree(p) ? "best" : ""}">${esc(feeLabel(p))}</span>`],
      ["Living costs", (p) => (p.live ? `<span class="${p.live === minLive && list.length > 1 ? "best" : ""}">${p.liveLo ? `€${p.liveLo}–${p.live}` : "€" + p.live} / month</span>` : "—")],
      ["English", (p) => (p.en ? `${esc(p.en)}${p.ielts ? ` · <span class="${p.ielts === minIelts && list.length > 1 ? "best" : ""}">IELTS ${p.ielts}</span>` : ""}${p.toefl ? ` · TOEFL ${p.toefl}` : ""}` : "—")],
      ["German", (p) => (p.de ? esc(p.de) : '<span class="best">Not required</span>')],
      ["GRE", (p) => esc(UH.greLabel(p))],
      ["Classes start", (p) => { const s = UH.nextIntake(p); return s ? `<b>${fmtDate(s.date)}</b><br><span class="muted">${esc(s.name)}</span>` : "—"; }],
      ["Apply via", (p) => (p.ua ? "uni-assist" : "University")],
      ["Starts", (p) => esc(p.b || "—")],
      [
        "Next deadline",
        (p, i) => {
          const d = nextDeadline(p);
          if (!d) return /no deadline/i.test(p.dl || "") ? "Rolling" : "See programme page";
          return `<b>${fmtDate(d.date)}</b><br><span class="${d.state === "soon" ? "" : "muted"}" style="${d.state === "soon" ? "color:var(--danger);font-weight:700" : ""}">${daysLabel(d.days)}</span>`;
        },
      ],
      [
        "Your match",
        (p) => {
          if (!profile.isSet()) return `<a href="#" data-profile>Set profile</a>`;
          const m = match(p, prof);
          if (m.status === "unknown") return '<span class="muted">Not enough data</span>';
          return m.notes.map((n) => `<div style="color:${n.pass === false ? "var(--danger)" : n.pass ? "var(--ok)" : "var(--muted)"}">${n.pass === false ? "✗" : n.pass ? "✓" : "•"} ${esc(n.text)}</div>`).join("");
        },
      ],
    ];
    return `
      <div class="cmp-wrap">
        <table class="cmp-table">
          <thead><tr><th scope="row"></th>${list
            .map(
              (p) => `<th><a href="program.html?id=${p.id}" target="_blank" rel="noopener">${esc(p.n)}</a><div style="margin-top:8px" class="row-gap"><button class="btn btn-ghost btn-sm" data-uncmp="${p.id}">${icon("x")} Remove</button></div></th>`
            )
            .join("")}</tr></thead>
          <tbody>${rows.map(([label, fn]) => `<tr><th scope="row">${label}</th>${list.map((p, i) => `<td>${fn(p, i)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
      <p class="muted" style="font-size:13px">Green marks the best value in a row. ${list.length < 4 ? "You can add up to " + (4 - list.length) + " more." : ""}</p>
      ${list.length < 4 && suggestions.length ? addFromSaved(suggestions) : ""}`;
  }
  function addFromSaved(list) {
    return `<div class="panel" style="margin-top:16px"><h3>${icon("bookmark")} Add from your shortlist</h3><div class="row-gap">${list
      .map((p) => `<button class="chip" data-cmp="${p.id}">+ ${esc(p.n)} <span class="muted">· ${esc(p.u)}</span></button>`)
      .join("")}</div></div>`;
  }

  // ---------------------------------------------------------------- events
  $(".page-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    tab = b.dataset.tab;
    history.replaceState(null, "", "#" + tab);
    render();
  });
  $("#tab-body").addEventListener("click", (e) => {
    const t = e.target;
    const rm = t.closest("[data-remove]");
    const cmp = t.closest("[data-cmp]");
    const un = t.closest("[data-uncmp]");
    if (rm) {
      watchlist.remove(+rm.dataset.remove);
      UH.toast("Removed from shortlist");
    } else if (cmp) compare.toggle(+cmp.dataset.cmp);
    else if (un) compare.remove(+un.dataset.uncmp);
    else if (t.closest("#export-saved")) {
      UH.exportList.addMany(watchlist.all());
      location.href = "export.html";
    } else if (t.closest("#ics-all")) {
      const ev = allEvents().map(({ p, d }) => ({
        id: p.id,
        date: d.date,
        title: `${p.n} (${p.u})${d.semester ? " – " + d.semester : ""}`,
        desc: `Application deadline${d.who ? " for applicants from " + d.who : ""}.`,
      }));
      UH.download("studybahn-deadlines.ics", UH.buildIcs(ev));
      UH.toast("Calendar file downloaded");
    } else if (t.closest("[data-profile]")) {
      e.preventDefault();
      UH.openProfile();
    }
  });
  document.addEventListener("studybahn:store", render);
  render();
})();
