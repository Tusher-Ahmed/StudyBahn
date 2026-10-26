/* Shared helpers: storage, profile, deadlines, header, small DOM utils. */
(function () {
  const DAY = 86400000;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"];

  // ---------- storage (always guarded: private windows can throw)
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem("studybahn:" + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem("studybahn:" + key, JSON.stringify(value));
      } catch (e) {}
      document.dispatchEvent(new CustomEvent("studybahn:store", { detail: { key } }));
    },
  };

  // ---------- watchlist & compare
  const list = (key, max) => ({
    all: () => store.get(key, []),
    has: (id) => store.get(key, []).includes(id),
    toggle(id) {
      let ids = store.get(key, []);
      if (ids.includes(id)) ids = ids.filter((x) => x !== id);
      else {
        if (max && ids.length >= max) {
          toast(`You can compare up to ${max} programmes. Remove one first.`);
          return false;
        }
        ids = [...ids, id];
      }
      store.set(key, ids);
      return ids.includes(id);
    },
    remove(id) {
      store.set(key, store.get(key, []).filter((x) => x !== id));
    },
    clear: () => store.set(key, []),
  });
  const watchlist = list("watchlist");
  const compare = list("compare", 4);
  const exportList = Object.assign(list("export"), {
    addMany(ids) {
      const cur = store.get("export", []);
      const add = ids.filter((id) => !cur.includes(id));
      store.set("export", [...cur, ...add]);
      return add.length;
    },
  });

  /** Load full detail records (data/details/<id>.js) for many ids, a few at a time. */
  const detailCache = new Map();
  function loadDetails(ids, onProgress) {
    window.__studybahnDetail = (d) => detailCache.set(d.id, d);
    let done = 0;
    const one = (id) =>
      new Promise((resolve) => {
        if (detailCache.has(id)) return resolve();
        const s = document.createElement("script");
        s.src = `data/details/${id}.js`;
        s.onload = s.onerror = () => {
          s.remove();
          resolve();
        };
        document.head.appendChild(s);
      }).then(() => onProgress && onProgress(++done, ids.length));
    const queue = [...ids];
    const worker = async () => {
      while (queue.length) await one(queue.shift());
    };
    return Promise.all(Array.from({ length: Math.min(6, ids.length) }, worker)).then(() =>
      ids.map((id) => Object.assign({}, byId.get(id), detailCache.get(id) || {}))
    );
  }

  /** Load an external script once (used for the export libraries). */
  const scriptCache = {};
  function loadScript(src) {
    if (!scriptCache[src])
      scriptCache[src] = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = () => {
          delete scriptCache[src];
          reject(new Error("Could not load " + src));
        };
        document.head.appendChild(s);
      });
    return scriptCache[src];
  }

  // ---------- profile
  const defaultProfile = { region: "non-EU", degree: "", ielts: "", toefl: "", german: "", gre: false };
  const profile = {
    get: () => Object.assign({}, defaultProfile, store.get("profile", {})),
    set: (p) => store.set("profile", p),
    isSet: () => {
      const p = store.get("profile", null);
      return !!(p && (p.ielts || p.toefl || p.german || p.degree));
    },
  };

  /** Compare a programme's language requirements with the profile.
   *  Returns {status: 'ok'|'no'|'unknown', notes:[...]} */
  function match(p, prof) {
    prof = prof || profile.get();
    const notes = [];
    let ok = true;
    let known = false;
    if (prof.ielts && p.ielts) {
      known = true;
      const pass = +prof.ielts >= p.ielts;
      ok = ok && pass;
      notes.push({ pass, text: `IELTS ${p.ielts} needed · you have ${prof.ielts}` });
    } else if (prof.toefl && p.toefl) {
      known = true;
      const pass = +prof.toefl >= p.toefl;
      ok = ok && pass;
      notes.push({ pass, text: `TOEFL ${p.toefl} needed · you have ${prof.toefl}` });
    }
    if (p.de) {
      known = true;
      const need = CEFR.indexOf(p.de);
      const have = prof.german ? CEFR.indexOf(prof.german) : -1;
      const pass = have >= need;
      ok = ok && pass;
      notes.push({ pass, text: `German ${p.de} needed · you have ${prof.german || "none"}` });
    }
    if (p.gre && !prof.gre) notes.push({ pass: null, text: "GRE may be required" });
    return { status: known ? (ok ? "ok" : "no") : "unknown", notes };
  }

  // ---------- deadlines
  function today() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  /** Next calendar occurrence of {d,m,y?} on/after `from`. */
  function nextDate(dm, from) {
    from = from || today();
    if (dm.y) return new Date(dm.y, dm.m - 1, dm.d);
    let dt = new Date(from.getFullYear(), dm.m - 1, dm.d);
    if (dt < from) dt = new Date(from.getFullYear() + 1, dm.m - 1, dm.d);
    return dt;
  }
  function appliesTo(period, region) {
    const who = (period.who || "").toLowerCase();
    if (!who) return true;
    if (region === "EU") return !/non-eu/.test(who);
    return /non-eu/.test(who) || !/eu countries|iceland|norway|liechtenstein/.test(who);
  }
  /** All upcoming deadlines for a programme (relevant to the profile region), soonest first. */
  function deadlines(p, region) {
    region = region || profile.get().region;
    const t = today();
    const periods = (p.p || p.periods || []).filter((x) => x.until);
    let rel = periods.filter((x) => appliesTo(x, region));
    if (!rel.length) rel = periods;
    return rel
      .map((x) => {
        const until = nextDate(x.until, t);
        let from = x.from ? new Date(until.getFullYear(), x.from.m - 1, x.from.d) : null;
        if (from && from > until) from.setFullYear(from.getFullYear() - 1);
        const days = Math.round((until - t) / DAY);
        let state = "upcoming";
        if (from && t < from) state = "notyet";
        else if (days <= 30) state = "soon";
        else state = from ? "open" : "upcoming";
        return { ...x, date: until, opens: from, days, state };
      })
      .filter((x) => x.days >= 0)
      .sort((a, b) => a.date - b.date);
  }
  function nextDeadline(p, region) {
    return deadlines(p, region)[0] || null;
  }
  // ---------- remote study / deferral
  const REMOTE = {
    full: ["Fully online", "No need to be in Germany for classes"],
    hybrid: ["Hybrid / online start possible", "Part of the programme can be followed online"],
    partly: ["Mostly on-site", "Some optional online elements"],
    text: ["Online elements mentioned", "Read the university's wording below"],
  };
  const remoteLabel = (p) => (REMOTE[p.rm || p.remote] || ["On-site", "No online option listed — plan to be in Germany"])[0];
  const remoteHint = (p) => (REMOTE[p.rm || p.remote] || ["On-site", "No online option listed — plan to be in Germany"])[1];
  const canStartRemote = (p) => ["full", "hybrid"].includes(p.rm || p.remote);

  // ---------- GRE & semester start
  const GRE = { req: "Required", some: "Required for some applicants", waive: "Required, can be waived", rec: "Recommended / optional" };
  const greLabel = (p) => (p.gr || p.greStatus ? GRE[p.gr || p.greStatus] : "Not mentioned (not required)");
  const greNeeded = (p) => ["req", "some", "waive"].includes(p.gr || p.greStatus);

  /** When the semester a deadline belongs to starts. German semesters are fixed:
   *  winter 1 Oct (lectures ~mid-Oct), summer 1 Apr (lectures ~mid-Apr). */
  function semesterStart(sem, after) {
    const winter = /winter/i.test(sem || "");
    const summer = /summer/i.test(sem || "");
    if (!winter && !summer) return null;
    const ref = after || today();
    const m = winter ? 9 : 3;
    let y = ref.getFullYear();
    if (ref.getMonth() >= m) y++;
    const date = new Date(y, m, 1);
    return {
      date,
      name: winter ? `Winter semester ${y}/${String(y + 1).slice(2)}` : `Summer semester ${y}`,
      lectures: winter ? `mid-October ${y}` : `mid-April ${y}`,
    };
  }
  /** Next intake for a programme: from its next deadline's semester, else from "Beginning". */
  function nextIntake(p, region) {
    const dl = nextDeadline(p, region);
    if (dl && semesterStart(dl.semester)) return semesterStart(dl.semester, dl.date);
    const opts = [/winter/i.test(p.b || "") && semesterStart("winter"), /summer/i.test(p.b || "") && semesterStart("summer")].filter(Boolean);
    return opts.sort((a, b) => a.date - b.date)[0] || null;
  }
  const intakeLabel = (s) => (s ? `${fmtDate(s.date)} (${s.name}; lectures usually from ${s.lectures})` : "");

  const fmtDate = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const fmtDM = (dm) => `${dm.d} ${MONTHS[dm.m - 1]}${dm.y ? " " + dm.y : ""}`;
  function daysLabel(days) {
    if (days === 0) return "Closes today";
    if (days === 1) return "1 day left";
    if (days < 60) return `${days} days left`;
    const months = Math.round(days / 30.4);
    return `${months} months left`;
  }
  function deadlineBadge(p) {
    const dl = nextDeadline(p);
    if (!dl) {
      if (/no deadline/i.test(p.dl || "")) return `<span class="badge badge-muted" title="No fixed deadline listed">${icon("infinity")} Rolling</span>`;
      return `<span class="badge badge-muted">${icon("calendar")} See details</span>`;
    }
    const cls = dl.state === "soon" ? "badge-danger" : dl.state === "notyet" ? "badge-info" : "badge-ok";
    const label = dl.state === "notyet" ? `Opens ${fmtDate(dl.opens)}` : `${fmtDate(dl.date)} · ${daysLabel(dl.days)}`;
    return `<span class="badge ${cls}" title="${esc(dl.semester || "Application deadline")}">${icon("calendar")} ${label}</span>`;
  }

  // ---------- application checklist (shared by programme page and exports)
  function checklistItems(d) {
    const ielts = d.english && Object.entries(d.english.certs || {}).find(([k]) => /ielts/i.test(k));
    const items = [];
    if (d.d === 1) {
      items.push(["hzb", "School-leaving certificate", "Your higher education entrance qualification (HZB). Some countries need Studienkolleg or a year of university first."]);
      items.push(["transcript", "School transcripts", "Grades from your final school years, certified copies."]);
    } else {
      items.push(["degree", "Bachelor's degree certificate", "Or proof that you'll finish before the programme starts."]);
      items.push(["transcript", "Transcript of records", "Full grade sheet with credits per module."]);
      items.push(["modules", "Module descriptions", "Often needed to prove subject-specific credits."]);
    }
    items.push(["lang", "Language certificate", ielts ? `IELTS Academic ${ielts[1]} or an accepted equivalent.` : d.english && d.english.level ? `English ${d.english.level} (see accepted certificates above).` : "Check which certificate is accepted."]);
    if (d.german && d.german.level) items.push(["german", `German certificate (${d.german.level})`, "e.g. Goethe, TestDaF, DSH, telc."]);
    items.push(["cv", "CV", "Tabular CV, ideally in Europass format."]);
    items.push(["motivation", "Motivation letter / Statement of purpose", "Why this programme, why this university, your goals."]);
    if (d.d === 2) items.push(["lor", "Letters of recommendation", "Usually 1–2 academic references, if required."]);
    if (d.gre) items.push(["gre", "GRE General Test score", "Mentioned in the requirements — check whether it applies to you."]);
    if (d.gmat) items.push(["gmat", "GMAT score", "Mentioned in the requirements."]);
    items.push(["aps", "APS certificate (if required)", "Mandatory for applicants from some countries (e.g. India, China, Vietnam). Check if yours is one."]);
    if (d.uniAssist) items.push(["ua", "uni-assist application & fee", "Submit documents via the uni-assist portal; allow 4–6 weeks."]);
    items.push(["passport", "Passport copy", "Valid for your whole study period if possible."]);
    items.push(["blocked", "Blocked account / proof of finances", "Needed for your visa after admission."]);
    return items;
  }


  // ---------- .ics export
  function icsDate(d) {
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  }
  function icsEscape(s) {
    return String(s).replace(/[\\;,]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
  }
  function buildIcs(events) {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//StudyBahn//Deadlines//EN", "CALSCALE:GREGORIAN"];
    const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    events.forEach((e, i) => {
      const end = new Date(e.date.getTime() + DAY);
      lines.push(
        "BEGIN:VEVENT",
        `UID:studybahn-${e.id}-${icsDate(e.date)}-${i}@studybahn`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
        `DTEND;VALUE=DATE:${icsDate(end)}`,
        `SUMMARY:${icsEscape("Deadline: " + e.title)}`,
        `DESCRIPTION:${icsEscape(e.desc || "")}`,
        "BEGIN:VALARM",
        "TRIGGER:-P14D",
        "ACTION:DISPLAY",
        `DESCRIPTION:${icsEscape("2 weeks left: " + e.title)}`,
        "END:VALARM",
        "BEGIN:VALARM",
        "TRIGGER:-P3D",
        "ACTION:DISPLAY",
        `DESCRIPTION:${icsEscape("3 days left: " + e.title)}`,
        "END:VALARM",
        "END:VEVENT"
      );
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }
  function download(name, content, type) {
    const blob = new Blob([content], { type: type || "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  // ---------- DOM utils
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  function toast(msg) {
    let t = $("#toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.setAttribute("role", "status");
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove("show"), 2600);
  }

  /** Deterministic pastel avatar for a university name. */
  function initials(name) {
    const words = name.replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter((w) => w && !/^(of|the|for|and|und|der|die|des|am|an|in|university|universität|hochschule|technische)$/i.test(w));
    return (words[0] ? words[0][0] : name[0]).toUpperCase() + (words[1] ? words[1][0].toUpperCase() : "");
  }
  function hue(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }
  function avatar(name, cls) {
    return `<span class="avatar ${cls || ""}" style="--h:${hue(name)}" aria-hidden="true">${esc(initials(name))}</span>`;
  }

  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.5 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.5-3.5-8.5s1-5.9 3.5-8.5Z"/>',
    euro: '<path d="M17 6.5A6.5 6.5 0 1 0 17 17.5M4.5 10.5h9M4.5 13.5h9"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    cap: '<path d="m2.5 9 9.5-4.5L21.5 9 12 13.5 2.5 9Z"/><path d="M6.5 11v4.5c1.5 1.5 3.4 2 5.5 2s4-.5 5.5-2V11M21.5 9v5"/>',
    bookmark: '<path d="M6.5 4.5h11a1 1 0 0 1 1 1v14l-6.5-4.5-6.5 4.5v-14a1 1 0 0 1 1-1Z"/>',
    compare: '<path d="M8 4v16M16 4v16M3.5 8H8M16 16h4.5M3.5 16H8M16 8h4.5"/>',
    user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    map: '<path d="M9 4.5 3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2-6-2ZM9 4.5v13M15 6.5v13"/>',
    external: '<path d="M13.5 4.5h6v6M19.5 4.5 11 13M18 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H10"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
    share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6"/>',
    lang: '<path d="M4 5.5h9M8.5 3.5v2M6 5.5c.8 3.5 3 6 6 7.5M11 5.5c-.8 3.5-3 6-6 7.5M13 20.5l3.5-9 3.5 9M14.2 17.5h4.6"/>',
    doc: '<path d="M7 3.5h7l4.5 4.5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15.5a1 1 0 0 1 1-1Z"/><path d="M14 3.5V8h4.5M9 12.5h6M9 16h6"/>',
    home: '<path d="M4 11 12 4.5 20 11M6 9.5V19.5h12V9.5"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15L6 16.5ZM10 20.5h4"/>',
    sparkle: '<path d="M12 3.5 13.6 9l5.4 1.5-5.4 1.5L12 17.5 10.4 12 5 10.5 10.4 9 12 3.5Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    infinity: '<path d="M7 9a3 3 0 1 0 0 6c3 0 7-6 10-6a3 3 0 1 1 0 6c-3 0-7-6-10-6Z"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
    alert: '<path d="M12 4 21 19.5H3L12 4Z"/><path d="M12 10v4.5M12 17v.2"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
    trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7"/>',
  };
  function icon(name, cls) {
    return `<svg class="icon ${cls || ""}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
  }

  // ---------- every content link opens in a new tab
  // (except the top menu, in-page #section jumps, email links and file downloads)
  document.addEventListener(
    "click",
    (e) => {
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a || a.closest("#site-header")) return;
      const href = a.getAttribute("href") || "";
      if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href) || a.hasAttribute("download")) return;
      a.target = "_blank";
      a.rel = "noopener";
    },
    true
  );

  // ---------- theme
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
  }
  applyTheme(store.get("theme", null));
  function currentTheme() {
    const t = document.documentElement.getAttribute("data-theme");
    if (t) return t;
    return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  // ---------- header
  function header(active) {
    const el = $("#site-header");
    if (!el) return;
    const links = [
      ["index.html", "Find programmes", "search", "find"],
      ["saved.html", "My shortlist", "bookmark", "saved"],
      ["export.html", "Export", "download", "export"],
      ["guide.html", "Application guide", "doc", "guide"],
    ];
    el.innerHTML = `
      <div class="header-inner container">
        <a class="brand" href="index.html" aria-label="StudyBahn home">
          <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M8.5 23.5C8.5 15 23.5 17 23.5 8.5" class="rail"/><path d="M8.5 23.5C8.5 15 23.5 17 23.5 8.5" class="ties"/><circle cx="8.5" cy="23.5" r="3.2" class="s"/><circle cx="23.5" cy="8.5" r="3.6" class="n"/><circle cx="23.5" cy="8.5" r="1.3" class="hub"/></svg></span>
          <span class="brand-text">Study<b>Bahn</b></span>
        </a>
        <nav class="nav" id="nav" aria-label="Main">
          ${links
            .map(
              ([href, label, ic, key]) =>
                `<a href="${href}" class="nav-link ${active === key ? "active" : ""}">${icon(ic)}<span>${label}</span>${
                  key === "saved" || key === "export" ? `<span class="count" id="${key}-count"></span>` : ""
                }</a>`
            )
            .join("")}
        </nav>
        <div class="header-actions">
          <button class="icon-btn" id="profile-btn" title="My profile" aria-label="My profile">${icon("user")}<span class="dot" id="profile-dot" hidden></span></button>
          <button class="icon-btn" id="theme-btn" title="Toggle dark mode" aria-label="Toggle dark mode">${icon(currentTheme() === "dark" ? "sun" : "moon")}</button>
          <button class="icon-btn nav-toggle" id="nav-toggle" aria-label="Menu" aria-expanded="false">${icon("menu")}</button>
        </div>
      </div>`;
    $("#theme-btn").onclick = () => {
      const next = currentTheme() === "dark" ? "light" : "dark";
      applyTheme(next);
      store.set("theme", next);
      $("#theme-btn").innerHTML = icon(next === "dark" ? "sun" : "moon");
    };
    $("#nav-toggle").onclick = () => {
      const open = el.classList.toggle("nav-open");
      $("#nav-toggle").setAttribute("aria-expanded", open);
    };
    $("#profile-btn").onclick = openProfile;
    const refresh = () => {
      [
        ["#saved-count", watchlist.all().length],
        ["#export-count", exportList.all().length],
      ].forEach(([sel, n]) => {
        const c = $(sel);
        if (c) {
          c.textContent = n || "";
          c.hidden = !n;
        }
      });
      $("#profile-dot").hidden = !profile.isSet();
    };
    refresh();
    document.addEventListener("studybahn:store", refresh);
    compareBar();
  }

  // ---------- floating compare tray
  function compareBar() {
    let bar = $("#compare-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "compare-bar";
      document.body.appendChild(bar);
    }
    const render = () => {
      const ids = compare.all();
      bar.classList.toggle("show", ids.length > 0 && !document.body.classList.contains("page-saved"));
      bar.innerHTML = `
        <div class="compare-bar-inner">
          <span>${icon("compare")} <b>${ids.length}</b> of 4 selected to compare</span>
          <div class="row-gap">
            <button class="btn btn-ghost btn-sm" id="cmp-clear">Clear</button>
            <a class="btn btn-primary btn-sm" href="saved.html#compare">Compare now ${icon("arrow")}</a>
          </div>
        </div>`;
      $("#cmp-clear", bar).onclick = () => compare.clear();
    };
    render();
    document.addEventListener("studybahn:store", (e) => e.detail.key === "compare" && render());
  }

  // ---------- profile modal
  function openProfile() {
    const p = profile.get();
    const m = modal(`
      <h2>Your match profile</h2>
      <p class="muted">We use this to highlight programmes you meet the language requirements for, and to show the deadlines that apply to you. It stays in this browser.</p>
      <form id="profile-form" class="form-grid">
        <label>Applicant from
          <select name="region">
            <option value="non-EU" ${p.region === "non-EU" ? "selected" : ""}>Outside the EU/EEA</option>
            <option value="EU" ${p.region === "EU" ? "selected" : ""}>EU / EEA</option>
          </select>
        </label>
        <label>I'm looking for
          <select name="degree">
            <option value="">Bachelor's or Master's</option>
            <option value="2" ${p.degree === "2" ? "selected" : ""}>Master's</option>
            <option value="1" ${p.degree === "1" ? "selected" : ""}>Bachelor's</option>
          </select>
        </label>
        <label>IELTS overall
          <input name="ielts" type="number" min="4" max="9" step="0.5" placeholder="e.g. 6.5" value="${esc(p.ielts)}">
        </label>
        <label>TOEFL iBT
          <input name="toefl" type="number" min="30" max="120" step="1" placeholder="e.g. 90" value="${esc(p.toefl)}">
        </label>
        <label>German level
          <select name="german">
            <option value="">None</option>
            ${CEFR.map((l) => `<option ${p.german === l ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </label>
        <label class="check"><input type="checkbox" name="gre" ${p.gre ? "checked" : ""}> I have a GRE score</label>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">Save profile</button>
        </div>
      </form>`);
    $("#profile-form", m).onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      profile.set({
        region: f.get("region"),
        degree: f.get("degree"),
        ielts: f.get("ielts"),
        toefl: f.get("toefl"),
        german: f.get("german"),
        gre: !!f.get("gre"),
      });
      closeModal(m);
      toast("Profile saved — matches updated");
    };
  }

  function modal(html) {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="icon-btn modal-close" data-close aria-label="Close">${icon("x")}</button>${html}</div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add("show"));
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap || e.target.closest("[data-close]")) closeModal(wrap);
    });
    const onKey = (e) => e.key === "Escape" && closeModal(wrap);
    document.addEventListener("keydown", onKey);
    wrap._off = () => document.removeEventListener("keydown", onKey);
    const first = wrap.querySelector("input,select,button:not(.modal-close)");
    if (first) setTimeout(() => first.focus(), 50);
    return wrap;
  }
  function closeModal(m) {
    m.classList.remove("show");
    m._off && m._off();
    setTimeout(() => m.remove(), 200);
  }

  // ---------- lookups over the programme index
  const DATA = window.STUDYBAHN || { meta: { groups: {}, fos: {} }, programmes: [] };
  const byId = new Map(DATA.programmes.map((p) => [p.id, p]));
  const degreeName = (d) => (d === 1 ? "Bachelor's" : d === 2 ? "Master's" : "Programme");
  const langLabel = (l) => (!l || !l.length ? "—" : l.join(" & "));
  function feeLabel(p) {
    if (/no tuition/i.test(p.fee || "")) return "No tuition fees";
    if (p.eur) return `€${p.eur.toLocaleString("en")} / semester`;
    if (/^\d/.test(p.fee || "")) return `€${p.fee} / semester`;
    return p.fee || "Tuition varies";
  }
  const isFree = (p) => /no tuition/i.test(p.fee || "");

  window.UH = {
    store, watchlist, compare, exportList, checklistItems, remoteLabel, remoteHint, canStartRemote, greLabel, greNeeded, semesterStart, nextIntake, intakeLabel, loadDetails, loadScript, profile, match, deadlines, nextDeadline, deadlineBadge,
    fmtDate, fmtDM, daysLabel, buildIcs, download, esc, $, $$, toast, avatar, icon,
    header, modal, closeModal, openProfile, DATA, byId, degreeName, langLabel, feeLabel, isFree, CEFR,
  };
})();
