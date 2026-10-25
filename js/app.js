/* Finder page: search, faceted filters, list/grid/map views, URL state. */
(function () {
  const { DATA, $, $$, esc, icon, avatar, watchlist, compare, profile, match, nextDeadline, deadlineBadge, degreeName, feeLabel, isFree, store } = UH;
  UH.header("find");

  const P = DATA.programmes;
  const META = DATA.meta;
  const groupName = (id) => META.groups[id] || "Other";
  const fosName = (id) => (META.fos[id] || {}).name || "";

  // ---------- search index
  const SYN = {
    ai: ["artificial intelligence", "ai", "machine learning", "intelligent"],
    ml: ["machine learning"],
    cs: ["computer science", "informatics"],
    ds: ["data science"],
    it: ["information technology", "informatics"],
    mba: ["mba", "business administration"],
    ee: ["electrical engineering"],
    me: ["mechanical engineering"],
    tum: ["technical university of munich"],
    kit: ["karlsruhe institute of technology"],
    rwth: ["rwth aachen"],
    lmu: ["ludwig-maximilians", "lmu munich"],
    munich: ["munich", "münchen", "garching"],
    cologne: ["cologne", "köln"],
    nuremberg: ["nuremberg", "nürnberg"],
    informatik: ["informatics", "computer science"],
  };
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  P.forEach((p) => {
    p._n = norm(p.n);
    p._u = norm(p.u + " " + p.c);
    p._o = norm([p.s, ...(p.f || []).map(fosName), ...(p.g || []).map(groupName)].join(" "));
    p._lang = langCat(p.l || []);
  });
  function langCat(l) {
    const en = l.includes("English");
    const de = l.includes("German");
    if (en && de) return "both";
    if (en && l.length === 1) return "en";
    if (de && l.length === 1) return "de";
    if (en) return "en+";
    return "other";
  }
  function wordRe(t) {
    return new RegExp("(^|[^a-z0-9])" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + (t.length <= 3 ? "($|[^a-z0-9])" : ""));
  }
  function scoreFor(p, terms) {
    let score = 0;
    for (const alts of terms) {
      let best = 0;
      for (const a of alts) {
        if (a.re.test(p._n)) best = Math.max(best, 6);
        else if (a.re.test(p._u)) best = Math.max(best, 3);
        else if (a.re.test(p._o)) best = Math.max(best, 2);
      }
      if (!best) return 0;
      score += best;
    }
    return score;
  }
  function parseQuery(q) {
    q = norm(q.trim());
    if (!q) return [];
    return q
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => [t, ...(SYN[t] || [])].map((a) => ({ re: wordRe(norm(a)) })));
  }

  // ---------- state <-> URL
  const DEFAULT = { q: "", deg: "", g: [], f: [], lang: [], fee: "", beg: [], city: [], dl: "", req: [], sort: "rel", page: 1, per: 20 };
  const LISTS = ["g", "f", "lang", "beg", "city", "req"];
  let S = readState();
  let view = store.get("view", "list");

  function readState() {
    const u = new URLSearchParams(location.search);
    const s = JSON.parse(JSON.stringify(DEFAULT));
    for (const [k, v] of u) {
      if (!(k in s)) continue;
      if (LISTS.includes(k)) s[k] = v.split(",").filter(Boolean);
      else if (k === "page" || k === "per") s[k] = Math.max(1, parseInt(v, 10) || DEFAULT[k]);
      else s[k] = v;
    }
    if (!u.has("deg")) {
      const pd = profile.get().degree;
      if (pd) s.deg = pd;
    }
    return s;
  }
  function writeState() {
    const u = new URLSearchParams();
    for (const k in S) {
      const v = S[k];
      if (Array.isArray(v) ? v.length : v !== DEFAULT[k]) u.set(k, Array.isArray(v) ? v.join(",") : v);
    }
    const qs = u.toString();
    history.replaceState(null, "", qs ? "?" + qs : location.pathname);
  }

  // ---------- filtering
  const PREDICATES = {
    deg: (p) => !S.deg || String(p.d) === S.deg,
    g: (p) => !S.g.length || (p.g || []).some((x) => S.g.includes(String(x))),
    f: (p) => !S.f.length || (p.f || []).some((x) => S.f.includes(String(x))),
    lang: (p) => !S.lang.length || S.lang.some((l) => (l === "en" ? p._lang === "en" || p._lang === "en+" : p._lang === l)),
    fee: (p) => !S.fee || (S.fee === "free" ? isFree(p) : !isFree(p)),
    beg: (p) =>
      !S.beg.length ||
      S.beg.some((b) => (b === "winter" ? /winter/i.test(p.b) : b === "summer" ? /summer/i.test(p.b) : !/winter|summer/i.test(p.b))),
    city: (p) => !S.city.length || S.city.includes(p.c),
    dl: (p) => {
      if (!S.dl) return true;
      if (S.dl === "rolling") return /no deadline/i.test(p.dl || "");
      const d = nextDeadline(p);
      if (!d) return false;
      if (S.dl === "open") return d.state !== "notyet";
      return d.days <= +S.dl && d.state !== "notyet";
    },
    req: (p) =>
      S.req.every((r) => {
        if (r === "nogerman") return !p.de;
        if (r === "nogre") return !p.gre;
        if (r === "direct") return !p.ua;
        if (r === "uniassist") return !!p.ua;
        if (r === "eligible") return match(p).status !== "no";
        if (r === "online") return !!p.online;
        return true;
      }),
  };
  let qTerms = parseQuery(S.q);
  function apply(except) {
    const out = [];
    for (const p of P) {
      if (qTerms.length) {
        p._score = scoreFor(p, qTerms);
        if (!p._score) continue;
      } else p._score = 0;
      let ok = true;
      for (const k in PREDICATES) {
        if (k === except) continue;
        if (!PREDICATES[k](p)) {
          ok = false;
          break;
        }
      }
      if (ok) out.push(p);
    }
    return out;
  }
  function countBy(rows, fn) {
    const m = new Map();
    for (const p of rows) for (const k of fn(p)) m.set(k, (m.get(k) || 0) + 1);
    return m;
  }

  // ---------- filter sidebar
  const CITIES = [...new Set(P.map((p) => p.c))].sort((a, b) => a.localeCompare(b));
  const FOS = Object.entries(META.fos)
    .map(([id, f]) => ({ id, name: f.name, group: String(f.group) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const LANGS = [
    ["en", "English only"],
    ["both", "English & German"],
    ["de", "German only"],
    ["other", "Other languages"],
  ];
  const BEGS = [
    ["winter", "Winter semester (Oct)"],
    ["summer", "Summer semester (Apr)"],
    ["other", "Other / trimester"],
  ];
  const REQS = [
    ["eligible", "I meet the language requirement", "Uses your profile"],
    ["nogerman", "No German required"],
    ["nogre", "No GRE mentioned"],
    ["direct", "Apply directly to university"],
    ["uniassist", "Apply via uni-assist"],
    ["online", "Fully online application"],
  ];
  let citySearch = "";
  let fosSearch = "";
  const openGroups = new Set(store.get("openFilters", ["deg", "g", "lang", "fee", "dl", "req"]));

  function fgroup(key, title, body) {
    return `<details class="fgroup" data-key="${key}" ${openGroups.has(key) ? "open" : ""}><summary>${title}</summary>${body}</details>`;
  }
  function opt(key, value, label, n, checked, hint) {
    return `<label class="opt ${n ? "" : "zero"}"><input type="checkbox" data-k="${key}" value="${esc(value)}" ${checked ? "checked" : ""}><span>${esc(label)}${
      hint ? `<br><small class="muted">${esc(hint)}</small>` : ""
    }</span><span class="n">${n.toLocaleString("en")}</span></label>`;
  }
  function seg(key, options) {
    return `<div class="seg">${options.map(([v, l]) => `<button type="button" data-seg="${key}" data-v="${v}" class="${S[key] === v ? "on" : ""}">${l}</button>`).join("")}</div>`;
  }

  function renderFilters() {
    const el = $("#filters");
    const scroll = el.scrollTop;
    const prof = profile.get();
    const hasProf = profile.isSet();
    const tags = [];
    if (prof.ielts) tags.push(`IELTS ${prof.ielts}`);
    if (prof.toefl) tags.push(`TOEFL ${prof.toefl}`);
    if (prof.german) tags.push(`German ${prof.german}`);
    tags.push(prof.region === "EU" ? "EU applicant" : "Non-EU applicant");

    const cG = countBy(apply("g"), (p) => (p.g || []).map(String));
    const cF = countBy(apply("f"), (p) => (p.f || []).map(String));
    const cL = countBy(apply("lang"), (p) => [p._lang === "en+" ? "en" : p._lang]);
    const cB = countBy(apply("beg"), (p) => [/winter/i.test(p.b) && "winter", /summer/i.test(p.b) && "summer", !/winter|summer/i.test(p.b) && "other"].filter(Boolean));
    const cC = countBy(apply("city"), (p) => [p.c]);
    const rowsReq = apply("req");
    const cR = new Map(
      REQS.map(([k]) => {
        const saved = S.req;
        S.req = [k];
        const n = rowsReq.filter(PREDICATES.req).length;
        S.req = saved;
        return [k, n];
      })
    );

    const fosList = FOS.filter((f) => (!S.g.length || S.g.includes(f.group)) && (!fosSearch || norm(f.name).includes(norm(fosSearch))));
    const cityList = CITIES.filter((c) => !citySearch || norm(c).includes(norm(citySearch)))
      .map((c) => ({ c, n: cC.get(c) || 0 }))
      .sort((a, b) => S.city.includes(b.c) - S.city.includes(a.c) || b.n - a.n || a.c.localeCompare(b.c));

    el.innerHTML = `
      <div class="filters-head"><h2>Filters</h2><button class="link-btn" id="clear-all">Clear all</button></div>
      <div class="profile-card">
        <h3>${icon("sparkle")} ${hasProf ? "Your match profile" : "Get personal matches"}</h3>
        ${hasProf ? `<div class="tags">${tags.map((t) => `<span class="badge badge-primary">${esc(t)}</span>`).join("")}</div>` : `<p>Add your IELTS / German level to see which programmes you already qualify for.</p>`}
        <button class="btn btn-ghost btn-sm" id="edit-profile">${hasProf ? "Edit profile" : "Set up profile"}</button>
      </div>
      ${fgroup("deg", "Degree", seg("deg", [["", "All"], ["2", "Master's"], ["1", "Bachelor's"]]))}
      ${fgroup(
        "dl",
        "Application deadline",
        `<div class="opts">${[
          ["", "Any time"],
          ["30", "Closes within 30 days"],
          ["90", "Closes within 3 months"],
          ["open", "Has an upcoming deadline"],
          ["rolling", "No fixed deadline"],
        ]
          .map(([v, l]) => `<label class="opt"><input type="radio" name="dl" data-radio="dl" value="${v}" ${S.dl === v ? "checked" : ""}><span>${l}</span></label>`)
          .join("")}</div>`
      )}
      ${fgroup("g", "Subject area", `<div class="opts">${Object.entries(META.groups).map(([id, name]) => [id, name, cG.get(id) || 0]).filter((x) => x[2] || S.g.includes(x[0])).sort((a, b) => b[2] - a[2]).map(([id, name, n]) => opt("g", id, name, n, S.g.includes(id))).join("")}</div>`)}
      ${fgroup(
        "f",
        `Field of study${S.f.length ? ` <span class="count">${S.f.length}</span>` : ""}`,
        `<input class="fsearch" id="fos-search" placeholder="Search fields…" value="${esc(fosSearch)}"><div class="opts scroll">${fosList
          .map((f) => [f, cF.get(f.id) || 0])
          .filter(([f, n]) => n || S.f.includes(f.id))
          .sort((a, b) => S.f.includes(b[0].id) - S.f.includes(a[0].id) || b[1] - a[1])
          .map(([f, n]) => opt("f", f.id, f.name, n, S.f.includes(f.id)))
          .join("") || '<p class="muted">No match</p>'}</div>`
      )}
      ${fgroup("lang", "Teaching language", `<div class="opts">${LANGS.map(([v, l]) => opt("lang", v, l, cL.get(v) || 0, S.lang.includes(v))).join("")}</div>`)}
      ${fgroup("fee", "Tuition fees", seg("fee", [["", "Any"], ["free", "Free"], ["paid", "Paid"]]))}
      ${fgroup("req", "Requirements & applying", `<div class="opts">${REQS.map(([v, l, h]) => opt("req", v, l, cR.get(v) || 0, S.req.includes(v), h)).join("")}</div>`)}
      ${fgroup("beg", "Start", `<div class="opts">${BEGS.map(([v, l]) => opt("beg", v, l, cB.get(v) || 0, S.beg.includes(v))).join("")}</div>`)}
      ${fgroup(
        "city",
        `City${S.city.length ? ` <span class="count">${S.city.length}</span>` : ""}`,
        `<input class="fsearch" id="city-search" placeholder="Search cities…" value="${esc(citySearch)}"><div class="opts scroll">${cityList
          .filter((x) => x.n || S.city.includes(x.c))
          .map((x) => opt("city", x.c, x.c, x.n, S.city.includes(x.c)))
          .join("") || '<p class="muted">No match</p>'}</div>`
      )}
      <button class="btn btn-primary filters-toggle" id="filters-close" style="width:100%;margin-top:16px">Show results</button>`;
    el.scrollTop = scroll;
  }

  // ---------- results
  function sortRows(rows) {
    const by = {
      name: (a, b) => a.n.localeCompare(b.n),
      uni: (a, b) => a.u.localeCompare(b.u) || a.n.localeCompare(b.n),
      city: (a, b) => a.c.localeCompare(b.c) || a.n.localeCompare(b.n),
      ielts: (a, b) => (a.ielts || 99) - (b.ielts || 99) || a.n.localeCompare(b.n),
      deadline: (a, b) => {
        const da = nextDeadline(a);
        const db = nextDeadline(b);
        return (da ? da.days : 9999) - (db ? db.days : 9999) || a.n.localeCompare(b.n);
      },
      rel: (a, b) => b._score - a._score || a.n.localeCompare(b.n),
    };
    return rows.sort(by[S.sort] || by.rel);
  }

  function card(p) {
    const saved = watchlist.has(p.id);
    const cmp = compare.has(p.id);
    const m = profile.isSet() ? match(p) : null;
    const tags = [
      `<span class="badge badge-primary">${icon("cap")} ${degreeName(p.d)}</span>`,
      `<span class="badge">${icon("lang")} ${esc(UH.langLabel(p.l))}</span>`,
      `<span class="badge ${isFree(p) ? "badge-ok" : ""}">${icon("euro")} ${esc(feeLabel(p))}</span>`,
      deadlineBadge(p),
    ];
    if (p.ielts) tags.push(`<span class="badge badge-gold" title="Minimum IELTS Academic">IELTS ${p.ielts}</span>`);
    if (p.de) tags.push(`<span class="badge badge-gold">German ${esc(p.de)}</span>`);
    if (m && m.status === "ok") tags.push(`<span class="badge badge-ok match">${icon("check")} You qualify</span>`);
    if (m && m.status === "no") tags.push(`<span class="badge badge-danger match" title="${esc(m.notes.filter((n) => n.pass === false).map((n) => n.text).join(" · "))}">${icon("x")} Language gap</span>`);
    return `
      <article class="card">
        ${avatar(p.u)}
        <div>
          <h3><a href="program.html?id=${p.id}">${esc(p.n)}</a></h3>
          <div class="uni"><span>${icon("cap")} ${esc(p.u)}</span><span>${icon("pin")} ${esc(p.c)}</span>${p.dur ? `<span>${icon("clock")} ${esc(p.dur)}</span>` : ""}</div>
          <div class="tags">${tags.join("")}</div>
        </div>
        <div class="card-actions">
          <button class="icon-btn exp ${UH.exportList.has(p.id) ? "on" : ""}" data-exp="${p.id}" title="${UH.exportList.has(p.id) ? "Remove from export list" : "Add to Excel / PDF export"}" aria-pressed="${UH.exportList.has(p.id)}">${icon("download")}</button>
          <button class="icon-btn cmp ${cmp ? "on" : ""}" data-cmp="${p.id}" title="${cmp ? "Remove from compare" : "Add to compare"}" aria-pressed="${cmp}">${icon("compare")}</button>
          <button class="icon-btn ${saved ? "on" : ""}" data-save="${p.id}" title="${saved ? "Remove from shortlist" : "Save to shortlist"}" aria-pressed="${saved}">${icon("bookmark")}</button>
        </div>
      </article>`;
  }

  let lastRows = [];
  function render() {
    qTerms = parseQuery(S.q);
    const rows = sortRows(apply());
    lastRows = rows;
    const pages = Math.max(1, Math.ceil(rows.length / S.per));
    if (S.page > pages) S.page = pages;
    $("#count").innerHTML = `${rows.length.toLocaleString("en")} programmes <span>${S.q ? `for “${esc(S.q)}”` : ""}</span>`;
    $$(".viewseg button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));

    const res = $("#results");
    const mapEl = $("#map");
    if (view === "map") {
      res.hidden = true;
      mapEl.hidden = false;
      $("#pager").innerHTML = "";
      renderMap(rows);
    } else {
      res.hidden = false;
      mapEl.hidden = true;
      res.className = "results " + (view === "grid" ? "grid" : "");
      const slice = rows.slice((S.page - 1) * S.per, S.page * S.per);
      res.innerHTML = slice.length
        ? slice.map(card).join("")
        : `<div class="empty"><h3>No programmes match</h3><p>Try removing a filter or searching a broader term.</p><button class="btn btn-ghost" id="empty-clear">Clear all filters</button></div>`;
      renderPager(pages);
    }
    renderActive();
    renderFilters();
    writeState();
  }

  function renderPager(pages) {
    const el = $("#pager");
    if (pages <= 1) {
      el.innerHTML = "";
      return;
    }
    const cur = S.page;
    const nums = new Set([1, pages, cur, cur - 1, cur + 1, cur - 2, cur + 2].filter((n) => n >= 1 && n <= pages));
    const list = [...nums].sort((a, b) => a - b);
    let html = `<button data-page="${cur - 1}" ${cur === 1 ? "disabled" : ""} aria-label="Previous page">‹</button>`;
    let prev = 0;
    for (const n of list) {
      if (n - prev > 1) html += `<button disabled>…</button>`;
      html += `<button data-page="${n}" class="${n === cur ? "on" : ""}" ${n === cur ? 'aria-current="page"' : ""}>${n}</button>`;
      prev = n;
    }
    html += `<button data-page="${cur + 1}" ${cur === pages ? "disabled" : ""} aria-label="Next page">›</button>`;
    el.innerHTML = html;
  }

  function renderActive() {
    const chips = [];
    const add = (label, fn) => chips.push({ label, fn });
    if (S.q) add(`“${S.q}”`, () => ((S.q = ""), ($("#q").value = "")));
    if (S.deg) add(degreeName(+S.deg), () => ((S.deg = ""), ($("#deg-select").value = "")));
    if (S.dl) add({ 30: "Closes ≤ 30 days", 90: "Closes ≤ 3 months", open: "Upcoming deadline", rolling: "No fixed deadline" }[S.dl], () => (S.dl = ""));
    S.g.forEach((g) => add(groupName(g), () => (S.g = S.g.filter((x) => x !== g))));
    S.f.forEach((f) => add(fosName(f), () => (S.f = S.f.filter((x) => x !== f))));
    S.lang.forEach((l) => add(LANGS.find((x) => x[0] === l)[1], () => (S.lang = S.lang.filter((x) => x !== l))));
    if (S.fee) add(S.fee === "free" ? "Tuition-free" : "Paid tuition", () => (S.fee = ""));
    S.req.forEach((r) => add(REQS.find((x) => x[0] === r)[1], () => (S.req = S.req.filter((x) => x !== r))));
    S.beg.forEach((b) => add(BEGS.find((x) => x[0] === b)[1], () => (S.beg = S.beg.filter((x) => x !== b))));
    S.city.forEach((c) => add(c, () => (S.city = S.city.filter((x) => x !== c))));
    const el = $("#active");
    el.innerHTML = chips.map((c, i) => `<button class="chip" data-chip="${i}">${esc(c.label)} <span class="x">${icon("x")}</span></button>`).join("");
    el._chips = chips;
    renderQuick();
  }

  // ---------- quick chips & stats
  const QUICK = [
    { label: "Computer Science", on: () => S.f.includes("226"), toggle: () => toggleIn("f", "226") },
    { label: "Data Science & AI", on: () => S.q === "data ai", toggle: () => setQ(S.q === "data ai" ? "" : "data ai") },
    { label: "Tuition-free", on: () => S.fee === "free", toggle: () => (S.fee = S.fee === "free" ? "" : "free") },
    { label: "English only", on: () => S.lang.length === 1 && S.lang[0] === "en", toggle: () => (S.lang = S.lang[0] === "en" && S.lang.length === 1 ? [] : ["en"]) },
    { label: "No German needed", on: () => S.req.includes("nogerman"), toggle: () => toggleIn("req", "nogerman") },
    { label: "⏰ Closing in 30 days", on: () => S.dl === "30", toggle: () => (S.dl = S.dl === "30" ? "" : "30") },
  ];
  function renderQuick() {
    $("#quick").innerHTML = QUICK.map((q, i) => `<button class="chip ${q.on() ? "on" : ""}" data-quick="${i}">${esc(q.label)}</button>`).join("");
  }
  function setQ(v) {
    S.q = v;
    $("#q").value = v;
  }
  function toggleIn(k, v) {
    S[k] = S[k].includes(v) ? S[k].filter((x) => x !== v) : [...S[k], v];
  }
  function renderStats() {
    const unis = new Set(P.map((p) => p.u)).size;
    const cities = new Set(P.map((p) => p.c)).size;
    const free = P.filter(isFree).length;
    const soon = P.filter((p) => {
      const d = nextDeadline(p);
      return d && d.state === "soon";
    }).length;
    $("#stats").innerHTML = [
      [P.length, "programmes"],
      [unis, "universities"],
      [cities, "cities"],
      [free, "tuition-free"],
      [soon, "deadlines in the next 30 days"],
    ]
      .map(([n, l]) => `<div class="stat"><b>${n.toLocaleString("en")}</b><span>${l}</span></div>`)
      .join("");
    $("#built").textContent = META.built;
  }

  // ---------- map
  let map, cluster;
  function renderMap(rows) {
    if (!window.L) {
      $("#map").innerHTML = '<div class="loading">Map library is loading…</div>';
      setTimeout(() => view === "map" && renderMap(lastRows), 400);
      return;
    }
    if (!map) {
      $("#map").innerHTML = "";
      map = L.map("map", { scrollWheelZoom: true }).setView([51.1, 10.4], 6);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);
    }
    if (cluster) map.removeLayer(cluster);
    cluster = L.markerClusterGroup ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 }) : L.layerGroup();
    const byLoc = new Map();
    rows.forEach((p) => {
      if (!p.geo) return;
      const k = p.geo[0].toFixed(3) + "," + p.geo[1].toFixed(3);
      if (!byLoc.has(k)) byLoc.set(k, []);
      byLoc.get(k).push(p);
    });
    byLoc.forEach((list) => {
      const p0 = list[0];
      const mk = L.marker(p0.geo, { title: p0.u });
      mk.bindPopup(
        `<b>${esc(p0.u)}</b><br><span class="muted">${esc(p0.c)} · ${list.length} programme${list.length > 1 ? "s" : ""}</span><hr style="border:0;border-top:1px solid #ddd">` +
          list
            .slice(0, 30)
            .map((p) => `<a href="program.html?id=${p.id}">${esc(p.n)}</a>`)
            .join("") +
          (list.length > 30 ? `<span class="muted">+${list.length - 30} more</span>` : "")
      );
      cluster.addLayer(mk);
    });
    map.addLayer(cluster);
    setTimeout(() => map.invalidateSize(), 50);
  }

  // ---------- events
  let debounce;
  $("#q").value = S.q;
  $("#deg-select").value = S.deg;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      S.q = e.target.value;
      S.page = 1;
      render();
    }, 180);
  });
  $("#search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    S.q = $("#q").value;
    S.page = 1;
    render();
    $("#results-top").scrollIntoView({ behavior: "smooth" });
  });
  $("#deg-select").addEventListener("change", (e) => {
    S.deg = e.target.value;
    S.page = 1;
    render();
  });
  $("#sort").value = S.sort;
  $("#sort").addEventListener("change", (e) => {
    S.sort = e.target.value;
    S.page = 1;
    render();
  });
  const VIEW_ICONS = { list: "list", grid: "grid", map: "map" };
  $$(".viewseg button").forEach((b) => {
    b.innerHTML = icon(VIEW_ICONS[b.dataset.view]);
    b.onclick = () => {
      view = b.dataset.view;
      store.set("view", view);
      render();
    };
  });

  const filtersEl = $("#filters");
  filtersEl.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.k) {
      const k = t.dataset.k;
      S[k] = t.checked ? [...S[k], t.value] : S[k].filter((x) => x !== t.value);
      if (k === "g") S.f = S.f.filter((f) => !S.g.length || S.g.includes(String((META.fos[f] || {}).group)));
    } else if (t.dataset.radio) S[t.dataset.radio] = t.value;
    else return;
    S.page = 1;
    render();
  });
  filtersEl.addEventListener("click", (e) => {
    const sb = e.target.closest("[data-seg]");
    if (sb) {
      S[sb.dataset.seg] = sb.dataset.v;
      if (sb.dataset.seg === "deg") $("#deg-select").value = S.deg;
      S.page = 1;
      render();
      return;
    }
    if (e.target.closest("#clear-all")) return clearAll();
    if (e.target.closest("#edit-profile")) return UH.openProfile();
    if (e.target.closest("#filters-close")) document.body.classList.remove("filters-open");
  });
  filtersEl.addEventListener(
    "toggle",
    (e) => {
      const d = e.target;
      if (!d.dataset || !d.dataset.key) return;
      d.open ? openGroups.add(d.dataset.key) : openGroups.delete(d.dataset.key);
      store.set("openFilters", [...openGroups]);
    },
    true
  );
  filtersEl.addEventListener("input", (e) => {
    if (e.target.id !== "city-search" && e.target.id !== "fos-search") return;
    const id = e.target.id;
    if (id === "city-search") citySearch = e.target.value;
    else fosSearch = e.target.value;
    const pos = e.target.selectionStart;
    renderFilters();
    const inp = $("#" + id);
    inp.focus();
    inp.setSelectionRange(pos, pos);
  });
  function clearAll() {
    S = JSON.parse(JSON.stringify(DEFAULT));
    $("#q").value = "";
    $("#deg-select").value = "";
    $("#sort").value = "rel";
    render();
  }
  $("#filters-open").onclick = () => document.body.classList.add("filters-open");
  document.addEventListener("click", (e) => {
    if (document.body.classList.contains("filters-open") && !e.target.closest("#filters") && !e.target.closest("#filters-open")) document.body.classList.remove("filters-open");
  });

  $("#active").addEventListener("click", (e) => {
    const b = e.target.closest("[data-chip]");
    if (!b) return;
    $("#active")._chips[+b.dataset.chip].fn();
    S.page = 1;
    render();
  });
  $("#quick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-quick]");
    if (!b) return;
    QUICK[+b.dataset.quick].toggle();
    S.page = 1;
    render();
  });
  $("#results").addEventListener("click", (e) => {
    if (e.target.closest("#empty-clear")) return clearAll();
    const btn = e.target.closest("[data-save],[data-cmp],[data-exp]");
    if (!btn) return;
    e.preventDefault();
    const id = +(btn.dataset.save || btn.dataset.cmp || btn.dataset.exp);
    if (btn.dataset.exp) {
      const on = !UH.exportList.has(id);
      on ? UH.exportList.addMany([id]) : UH.exportList.remove(id);
      UH.toast(on ? "Added to your export list" : "Removed from export list");
    } else if (btn.dataset.save) {
      const on = watchlist.toggle(id);
      UH.toast(on ? "Saved to your shortlist" : "Removed from shortlist");
    } else compare.toggle(id);
    btn.closest(".card").outerHTML = card(UH.byId.get(id));
  });
  $("#export-results").addEventListener("click", () => {
    const ids = lastRows.map((p) => p.id);
    if (!ids.length) return UH.toast("No results to export");
    if (ids.length > 300) return UH.toast(`${ids.length} results — narrow your filters to 300 or fewer to export`);
    const n = UH.exportList.addMany(ids);
    UH.toast(`Added ${n} programme${n === 1 ? "" : "s"} — opening export…`);
    setTimeout(() => (location.href = "export.html"), 500);
  });
  $("#pager").addEventListener("click", (e) => {
    const b = e.target.closest("[data-page]");
    if (!b || b.disabled) return;
    S.page = +b.dataset.page;
    render();
    $("#results-top").scrollIntoView({ behavior: "smooth" });
  });
  document.addEventListener("studybahn:store", (e) => {
    if (e.detail.key === "profile") render();
    if (e.detail.key === "compare") $$("[data-cmp]").forEach((b) => b.classList.toggle("on", compare.has(+b.dataset.cmp)));
  });

  renderStats();
  render();
})();
