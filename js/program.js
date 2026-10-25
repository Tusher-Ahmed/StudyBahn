/* Programme detail page: requirements, deadlines, costs, checklist, contact. */
(function () {
  const { $, $$, esc, icon, avatar, watchlist, compare, profile, match, deadlines, fmtDate, daysLabel, degreeName, feeLabel, isFree, store, DATA, byId, CEFR } = UH;
  UH.header("find");

  const id = parseInt(new URLSearchParams(location.search).get("id"), 10);
  const row = byId.get(id);
  const app = $("#app");

  if (!row) return notFound();

  // Detail files are plain scripts so the site also works from file://
  window.__studybahnDetail = (d) => render(Object.assign({}, row, d));
  const s = document.createElement("script");
  s.src = `data/details/${id}.js`;
  s.onerror = () => render(Object.assign({ sections: {}, daadUrl: `https://www2.daad.de/deutschland/studienangebote/international-programmes/en/detail/${id}/` }, row));
  document.head.appendChild(s);

  function notFound() {
    app.innerHTML = `<div class="container"><div class="empty" style="margin:60px 0"><h3>Programme not found</h3><p>It may have been removed from the DAAD database.</p><a class="btn btn-primary" href="index.html">${icon("back")} Back to search</a></div></div>`;
  }

  function sectionVal(d, tab, label) {
    const it = ((d.sections || {})[tab] || []).find((x) => x.label.toLowerCase() === label.toLowerCase());
    return it ? it.html : "";
  }

  function render(d) {
    document.title = `${d.n} · ${d.u} — StudyBahn`;
    const dls = deadlines(d);
    const next = dls[0];
    const prof = profile.get();
    const m = match(d, prof);

    app.innerHTML = `
      ${hero(d)}
      <div class="container">
        ${facts(d, next)}
        <div class="p-layout">
          <div>
            <nav class="tabs" id="tabs" aria-label="Sections">
              <a href="#overview">${icon("info")} Overview</a>
              <a href="#requirements">${icon("check")} Requirements</a>
              <a href="#deadlines">${icon("calendar")} Deadlines</a>
              <a href="#checklist">${icon("doc")} Checklist</a>
              <a href="#costs">${icon("euro")} Costs</a>
              <a href="#life">${icon("home")} Student life</a>
            </nav>
            ${overview(d)}
            ${requirements(d, m, prof)}
            ${deadlineSection(d, dls)}
            ${checklist(d)}
            ${costs(d)}
            ${life(d)}
          </div>
          <aside class="side">${sidebar(d, next)}</aside>
        </div>
      </div>`;
    wire(d, dls);
  }

  // ---------------------------------------------------------------- hero
  function hero(d) {
    const saved = watchlist.has(d.id);
    const cmp = compare.has(d.id);
    const course = (d.contact || {}).courseUrl;
    return `
      <section class="p-hero">
        ${d.img ? `<div class="bgimg" style="background-image:url('${esc(d.img.replace("16_9_300px", "full_web_optimized"))}')"></div>` : ""}
        <div class="container p-hero-inner">
          <div class="crumbs"><a href="index.html">${icon("back")} All programmes</a><span>/</span><span>${degreeName(d.d)}</span><span>/</span><span>${esc(d.s || "")}</span></div>
          <div class="p-head">
            ${d.logo ? `<div class="logo"><img src="${esc(d.logo)}" alt="${esc(d.u)} logo" onerror="this.parentNode.outerHTML='${avatar(d.u, "lg").replace(/"/g, "&quot;").replace(/'/g, "\\'")}'"></div>` : avatar(d.u, "lg")}
            <div class="p-head-main">
              <span class="badge badge-gold">${icon("cap")} ${degreeName(d.d)}${d.s ? " · " + esc(d.s) : ""}</span>
              <h1>${esc(d.n)}</h1>
              <div class="sub"><span>${icon("cap")} ${esc(d.u)}</span><span>${icon("pin")} ${esc(d.c)}</span></div>
            </div>
          </div>
          <div class="p-actions">
            ${course ? `<a class="btn btn-primary" href="${esc(course)}" target="_blank" rel="noopener">Official programme page ${icon("external")}</a>` : ""}
            <button class="btn btn-ghost ${saved ? "is-on" : ""}" id="save-btn">${icon("bookmark")} <span>${saved ? "Saved" : "Save"}</span></button>
            <button class="btn btn-ghost ${cmp ? "is-on" : ""}" id="cmp-btn">${icon("compare")} <span>${cmp ? "In compare" : "Compare"}</span></button>
            <button class="btn btn-ghost ${UH.exportList.has(d.id) ? "is-on" : ""}" id="exp-btn">${icon("download")} <span>${UH.exportList.has(d.id) ? "In export list" : "Add to export"}</span></button>
            <button class="btn btn-ghost" id="share-btn">${icon("share")} Share</button>
            <a class="btn btn-ghost" href="${esc(d.daadUrl)}" target="_blank" rel="noopener">DAAD page ${icon("external")}</a>
          </div>
        </div>
      </section>`;
  }

  function facts(d, next) {
    const tuition = d.tuitionText && !/none/i.test(d.tuitionText) ? d.tuitionText : feeLabel(d);
    const nextHtml = next
      ? `${fmtDate(next.date)}<small>${next.state === "notyet" ? "Opens " + fmtDate(next.opens) : daysLabel(next.days)}${next.semester ? " · " + esc(next.semester) : ""}</small>`
      : /no deadline/i.test(d.dl || "")
      ? `Rolling<small>No fixed deadline listed</small>`
      : `See below<small>Check the official page</small>`;
    const f = [
      ["cap", "Degree", degreeName(d.d)],
      ["clock", "Duration", esc(d.dur || "—")],
      ["lang", "Language", esc(UH.langLabel(d.l))],
      ["euro", "Tuition", esc(isFree(d) ? "Free" : tuition)],
      ["calendar", "Starts", esc((d.b || "—").replace(/ semester/gi, ""))],
    ];
    return `<div class="facts">${f.map(([i, k, v]) => `<div class="fact"><div class="k">${icon(i)} ${k}</div><div class="v">${v}</div></div>`).join("")}
      <div class="fact deadline"><div class="k">${icon("bell")} Next deadline</div><div class="v">${nextHtml}</div></div></div>`;
  }

  // ---------------------------------------------------------------- sections
  function overview(d) {
    const desc = sectionVal(d, "overview", "Description/content");
    const skip = /^(degree|course location|teaching language|languages|programme duration|beginning|application periods|description\/content)$/i;
    const rest = ((d.sections || {}).overview || []).filter((x) => !skip.test(x.label));
    return `
      <section class="section" id="overview">
        <h2>Overview</h2>
        ${desc ? `<div class="panel"><h3>${icon("doc")} What you'll study</h3><div class="rich clamp" id="desc">${desc}</div><button class="link-btn" id="desc-more" hidden>Read more</button></div>` : ""}
        ${rest.length ? `<div class="acc">${rest.map((x, i) => `<details ${i === 0 ? "open" : ""}><summary>${esc(x.label)}</summary><div class="rich">${x.html}</div></details>`).join("")}</div>` : ""}
        ${!desc && !rest.length ? `<div class="panel muted">No description is available. See the official page.</div>` : ""}
      </section>`;
  }

  function langPanel(title, L, kind, prof) {
    if (!L) return `<div class="panel"><h3>${icon("lang")} ${title}</h3><p class="muted">Not specified — check the official page.</p></div>`;
    const lvl = L.level;
    const idx = lvl ? CEFR.indexOf(lvl) : -1;
    const certs = Object.entries(L.certs || {});
    let yours = "";
    if (kind === "en" && (prof.ielts || prof.toefl) && certs.length) {
      const need = [];
      let pass = null;
      const ielts = certs.find(([k]) => /ielts/i.test(k));
      const toefl = certs.find(([k]) => /toefl/i.test(k));
      if (prof.ielts && ielts) {
        const n = parseFloat(ielts[1]);
        if (!isNaN(n)) {
          pass = +prof.ielts >= n;
          need.push(`IELTS ${n} required · you have ${prof.ielts}`);
        }
      } else if (prof.toefl && toefl) {
        const n = parseFloat(toefl[1]);
        if (!isNaN(n)) {
          pass = +prof.toefl >= n;
          need.push(`TOEFL ${n} required · you have ${prof.toefl}`);
        }
      }
      if (pass !== null) yours = `<div class="yours ${pass ? "ok" : "no"}">${icon(pass ? "check" : "alert")} ${pass ? "You meet this requirement" : "Below the requirement"} — ${esc(need[0])}</div>`;
    }
    if (kind === "de" && lvl) {
      const have = prof.german ? CEFR.indexOf(prof.german) : -1;
      const pass = have >= idx;
      yours = `<div class="yours ${pass ? "ok" : "no"}">${icon(pass ? "check" : "alert")} ${pass ? "You meet this requirement" : `You need German ${lvl}`} — your level: ${esc(prof.german || "none")}</div>`;
    }
    if (!yours && !profile.isSet()) yours = `<div class="yours unknown">${icon("user")} <span><a href="#" data-profile>Add your scores</a> to check if you qualify.</span></div>`;
    return `
      <div class="panel">
        <h3>${icon("lang")} ${title}</h3>
        <div class="level">
          ${lvl ? `<div class="big">${esc(lvl)}</div><div><div class="muted" style="font-size:13px">CEFR level required</div><div class="cefr">${CEFR.map((c, i) => `<i class="${i <= idx ? "on" : ""}" title="${c}"></i>`).join("")}</div></div>` : `<div class="big none">${L.none ? "Not required" : "See details"}</div>`}
        </div>
        ${certs.length ? `<div class="certs">${certs.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>` : !lvl && L.html ? `<div class="rich">${L.html}</div>` : ""}
        ${yours}
      </div>`;
  }

  function requirements(d, m, prof) {
    const flags = [];
    if (d.uniAssist) flags.push(`<span class="badge badge-info">${icon("doc")} Apply via uni-assist</span>`);
    else if (d.applyVia) flags.push(`<span class="badge badge-ok">${icon("check")} Apply to university</span>`);
    if (d.gre) flags.push(`<span class="badge badge-gold">${icon("alert")} GRE mentioned</span>`);
    if (d.gmat) flags.push(`<span class="badge badge-gold">${icon("alert")} GMAT mentioned</span>`);
    if (d.online) flags.push(`<span class="badge badge-ok">${icon("globe")} Fully online application</span>`);
    if (m.status === "ok") flags.push(`<span class="badge badge-ok">${icon("sparkle")} Matches your language profile</span>`);
    return `
      <section class="section" id="requirements">
        <h2>Admission requirements</h2>
        <p class="lede">What you need to be admitted, as published by the university.</p>
        ${flags.length ? `<div class="flags">${flags.join("")}</div>` : ""}
        <div class="panel"><h3>${icon("cap")} Academic requirements</h3><div class="rich">${d.academic || '<span class="muted">Not specified — see the official programme page.</span>'}</div></div>
        <div class="req-grid">
          ${langPanel("English", d.english, "en", prof)}
          ${langPanel("German", d.german, "de", prof)}
        </div>
        ${d.langExempt ? `<div class="panel"><h3>${icon("info")} Language exemptions</h3><div class="rich">${d.langExempt}</div></div>` : ""}
        ${d.applyVia ? `<div class="panel"><h3>${icon("arrow")} How to apply</h3><div class="rich">${d.applyVia}</div>${
          d.uniAssist ? `<div class="notice">${icon("info")}<span><b>uni-assist</b> checks international certificates for many German universities. Processing takes 4–6 weeks and there's a fee, so submit well before the deadline.</span></div>` : ""
        }</div>` : ""}
      </section>`;
  }

  function deadlineSection(d, dls) {
    const all = (d.periods || []).filter((p) => p.until || p.text);
    const cards = dls
      .map((x, i) => {
        const dt = x.date;
        const label = x.state === "notyet" ? `Opens ${fmtDate(x.opens)}` : x.state === "soon" ? "Closing soon" : x.opens ? "Open now" : "Upcoming";
        const cls = x.state === "soon" ? "badge-danger" : x.state === "notyet" ? "badge-info" : "badge-ok";
        return `
          <div class="dl-card ${i === 0 ? "next" : ""} ${x.state === "soon" ? "soon" : ""}">
            <div class="dl-cal"><div class="m">${dt.toLocaleString("en", { month: "short" }).toUpperCase()}</div><div class="d">${dt.getDate()}</div><div class="y">${dt.getFullYear()}</div></div>
            <div>
              <h4>${esc(x.semester ? x.semester.replace(/^\w/, (c) => c.toUpperCase()) : "Application deadline")} ${i === 0 ? '<span class="badge badge-gold">Next</span>' : ""}</h4>
              <div class="who">${x.who ? "For applicants from " + esc(x.who) : "All applicants"}${x.from ? ` · Applications open ${UH.fmtDM(x.from)}` : ""}</div>
              <div style="margin-top:6px" class="row-gap"><span class="badge ${cls}">${label}</span>${x.tx ? `<span class="badge badge-muted" title="Read from the university's description — check the official page">Read from text · verify</span>` : ""}</div>
            </div>
            <div class="dl-count"><b>${x.days}</b><span>days left</span><br><button class="btn btn-ghost btn-sm" data-ics="${i}" style="margin-top:8px">${icon("calendar")} Add to calendar</button></div>
          </div>`;
      })
      .join("");
    const region = profile.get().region === "EU" ? "EU/EEA" : "non-EU";
    return `
      <section class="section" id="deadlines">
        <h2>Application deadlines</h2>
        <p class="lede">Showing deadlines for <b>${region}</b> applicants. <a href="#" data-profile>Change</a></p>
        ${
          dls.length
            ? `<div class="timeline">${cards}</div>${dls.length > 1 ? `<div style="margin-top:12px"><button class="btn btn-ghost btn-sm" data-ics="all">${icon("download")} Add all deadlines to calendar</button></div>` : ""}`
            : `<div class="panel">${/no deadline/i.test(d.dl || "") ? `<h3>${icon("infinity")} No fixed deadline</h3><p class="muted">This programme lists no application deadline. Applications may be accepted on a rolling basis — contact the university to confirm.</p>` : `<p class="muted">No structured deadline found.</p>`}</div>`
        }
        ${
          all.length || d.periodsHtml
            ? `<details class="acc" style="margin-top:14px"><summary>All application periods as published</summary><div class="rich">${d.periodsHtml || all.map((p) => esc(p.text)).join("<br>")}</div></details>`
            : ""
        }
        <div class="notice warn">${icon("alert")}<span>Deadlines usually refer to when your application must be <b>received</b>. Visa appointments in many countries take months — start early.</span></div>
      </section>`;
  }

  function checklist(d) {
    const items = UH.checklistItems(d);
    const done = store.get("check:" + d.id, []);
    const n = items.filter(([k]) => done.includes(k)).length;
    return `
      <section class="section" id="checklist">
        <h2>Your application checklist</h2>
        <p class="lede">Tick documents off as you prepare them. Progress is saved in this browser.</p>
        <div class="panel">
          <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:650"><span>Progress</span><span id="chk-count">${n} / ${items.length}</span></div>
          <div class="progress"><i id="chk-bar" style="width:${(n / items.length) * 100}%"></i></div>
          <div class="checklist" id="chk">
            ${items.map(([k, t, desc]) => `<label><input type="checkbox" value="${k}" ${done.includes(k) ? "checked" : ""}><span><div class="t">${esc(t)}</div><div class="d">${esc(desc)}</div></span></label>`).join("")}
          </div>
        </div>
      </section>`;
  }

  function costs(d) {
    const live = d.living || { items: [], total: null };
    const items = live.items.filter((x) => x.eur);
    const max = Math.max(1, ...items.map((x) => x.eur));
    const tuition = isFree(d) ? "€0" : d.tuitionEur ? `€${d.tuitionEur.toLocaleString("en")}` : esc(d.fee || "Varies");
    const other = ((d.sections || {}).costs || []).filter((x) => !/^(tuition fees|semester contribution|costs of living)/i.test(x.label));
    return `
      <section class="section" id="costs">
        <h2>Costs &amp; funding</h2>
        <div class="cost-top">
          <div class="kpi"><div class="k">Tuition per semester</div><div class="v">${tuition}</div><div class="s">${esc(d.tuitionText && !isFree(d) ? d.tuitionText : isFree(d) ? "No tuition fees" : "")}</div></div>
          <div class="kpi"><div class="k">Semester contribution</div><div class="v">${d.semesterFee ? "€" + d.semesterFee.toLocaleString("en") : "—"}</div><div class="s">Often includes a public transport ticket</div></div>
          <div class="kpi"><div class="k">Living costs / month</div><div class="v">${live.total ? (live.low ? `€${live.low.toLocaleString("en")}–${live.total.toLocaleString("en")}` : "€" + live.total.toLocaleString("en")) : "—"}</div><div class="s">${live.total ? `≈ €${(live.total * 12).toLocaleString("en")} per year (upper estimate)` : "Estimate not provided"}</div></div>
        </div>
        ${
          items.length
            ? `<div class="panel"><h3>${icon("euro")} Monthly living cost breakdown</h3><div class="bars">${items
                .map((x) => `<div class="bar-row"><span>${esc(x.label)}</span><div class="track"><i style="width:${(x.eur / max) * 100}%"></i></div><span class="amt">€${x.eur.toLocaleString("en")}</span></div>`)
                .join("")}</div></div>`
            : ""
        }
        ${other.map((x) => `<div class="panel"><h3>${icon("info")} ${esc(x.label)}</h3><div class="rich">${x.html}</div></div>`).join("")}
        ${sectionVal(d, "costs", "Semester contribution") ? `<details class="acc"><summary>Semester contribution details</summary><div class="rich">${sectionVal(d, "costs", "Semester contribution")}</div></details>` : ""}
      </section>`;
  }

  function life(d) {
    const s = (d.sections || {}).services || [];
    if (!s.length) return "";
    return `
      <section class="section" id="life">
        <h2>Student life &amp; support</h2>
        <div class="acc">${s.map((x, i) => `<details ${i === 0 ? "open" : ""}><summary>${esc(x.label)}</summary><div class="rich">${x.html}</div></details>`).join("")}</div>
      </section>`;
  }

  // ---------------------------------------------------------------- sidebar
  function sidebar(d, next) {
    const c = d.contact || {};
    const sim = similar(d);
    return `
      ${
        next
          ? `<div class="panel" style="background:linear-gradient(135deg,var(--gold-soft),var(--bg-elev))">
              <h3>${icon("bell")} Next deadline</h3>
              <div style="font-family:var(--display);font-size:34px;font-weight:700;line-height:1">${next.days}<span style="font-size:15px;font-family:var(--font);color:var(--muted);font-weight:600"> days left</span></div>
              <div class="muted" style="margin:6px 0 12px;font-size:14px">${fmtDate(next.date)}${next.semester ? " · " + esc(next.semester) : ""}</div>
              <button class="btn btn-primary btn-sm" data-ics="0" style="width:100%">${icon("calendar")} Remind me (.ics)</button>
            </div>`
          : ""
      }
      <div class="panel">
        <h3>${icon("mail")} Contact</h3>
        ${c.uniName ? `<div class="contact-line">${icon("cap")}<span>${c.uniUrl ? `<a href="${esc(c.uniUrl)}" target="_blank" rel="noopener">${esc(c.uniName)}</a>` : esc(c.uniName)}${c.faculty ? `<br><span class="muted">${esc(c.faculty)}</span>` : ""}</span></div>` : ""}
        ${c.address ? `<div class="contact-line">${icon("pin")}<span>${c.address.map(esc).join("<br>")}</span></div>` : ""}
        ${c.email ? `<div class="contact-line">${icon("mail")}<a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>` : ""}
        ${c.courseUrl ? `<div class="contact-line">${icon("globe")}<a href="${esc(c.courseUrl)}" target="_blank" rel="noopener">Programme website</a></div>` : ""}
        ${d.geo ? `<div id="pmap"></div>` : ""}
      </div>
      ${
        sim.length
          ? `<div class="panel"><h3>${icon("sparkle")} Similar programmes</h3><div class="similar">${sim
              .map((p) => `<a href="program.html?id=${p.id}"><b>${esc(p.n)}</b><span>${esc(p.u)} · ${esc(p.c)}</span></a>`)
              .join("")}</div></div>`
          : ""
      }
      <p class="muted" style="font-size:12.5px;margin:0">Source: <a href="${esc(d.daadUrl)}" target="_blank" rel="noopener">DAAD International Programmes</a>, ${esc(DATA.meta.built || "")}. Always confirm on the university's website.</p>`;
  }

  function similar(d) {
    const f = new Set(d.f || []);
    if (!f.size) return [];
    return DATA.programmes
      .filter((p) => p.id !== d.id && p.d === d.d && (p.f || []).some((x) => f.has(x)))
      .map((p) => {
        const words = new Set(p.n.toLowerCase().split(/\W+/));
        const overlap = d.n.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && words.has(w)).length;
        return { p, score: overlap * 2 + (p.f || []).filter((x) => f.has(x)).length };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => x.p);
  }

  // ---------------------------------------------------------------- events
  function wire(d, dls) {
    const desc = $("#desc");
    if (desc && desc.scrollHeight > 280) {
      const more = $("#desc-more");
      more.hidden = false;
      more.onclick = () => {
        desc.classList.toggle("open");
        more.textContent = desc.classList.contains("open") ? "Show less" : "Read more";
      };
    } else if (desc) desc.classList.add("open");

    $("#save-btn").onclick = (e) => {
      const on = watchlist.toggle(d.id);
      e.currentTarget.classList.toggle("is-on", on);
      e.currentTarget.querySelector("span").textContent = on ? "Saved" : "Save";
      UH.toast(on ? "Saved to your shortlist" : "Removed from shortlist");
    };
    $("#cmp-btn").onclick = (e) => {
      const on = compare.toggle(d.id);
      e.currentTarget.classList.toggle("is-on", on);
      e.currentTarget.querySelector("span").textContent = on ? "In compare" : "Compare";
    };
    $("#exp-btn").onclick = (e) => {
      const on = !UH.exportList.has(d.id);
      on ? UH.exportList.addMany([d.id]) : UH.exportList.remove(d.id);
      e.currentTarget.classList.toggle("is-on", on);
      e.currentTarget.querySelector("span").textContent = on ? "In export list" : "Add to export";
      UH.toast(on ? "Added — open Export in the menu to download Excel / PDF" : "Removed from export list");
    };
    $("#share-btn").onclick = async () => {
      const url = location.href;
      try {
        if (navigator.share) await navigator.share({ title: d.n, text: `${d.n} — ${d.u}`, url });
        else {
          await navigator.clipboard.writeText(url);
          UH.toast("Link copied");
        }
      } catch (e) {}
    };

    app.addEventListener("click", (e) => {
      const ics = e.target.closest("[data-ics]");
      if (ics) {
        const which = ics.dataset.ics === "all" ? dls : [dls[+ics.dataset.ics]];
        const ev = which.filter(Boolean).map((x) => ({
          id: d.id,
          date: x.date,
          title: `${d.n} (${d.u})${x.semester ? " – " + x.semester : ""}`,
          desc: `Application deadline${x.who ? " for applicants from " + x.who : ""}.\n${location.href}`,
        }));
        UH.download(`deadline-${d.id}.ics`, UH.buildIcs(ev));
        UH.toast("Calendar file downloaded — reminders set 14 and 3 days before");
      }
      if (e.target.closest("[data-profile]")) {
        e.preventDefault();
        UH.openProfile();
      }
    });

    $("#chk").addEventListener("change", () => {
      const vals = $$("#chk input:checked").map((i) => i.value);
      store.set("check:" + d.id, vals);
      const total = $$("#chk input").length;
      $("#chk-count").textContent = `${vals.length} / ${total}`;
      $("#chk-bar").style.width = (vals.length / total) * 100 + "%";
      if (vals.length === total) UH.toast("🎉 All documents ready!");
    });

    document.addEventListener("studybahn:store", (e) => {
      if (e.detail.key === "profile") render(d);
    });

    // scroll-spy for the section tabs
    const links = $$("#tabs a");
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) links.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + en.target.id));
        });
      },
      { rootMargin: "-140px 0px -60% 0px" }
    );
    $$(".section").forEach((s) => obs.observe(s));

    // map
    const initMap = () => {
      if (!d.geo || !$("#pmap")) return;
      if (!window.L) return setTimeout(initMap, 300);
      const m = L.map("pmap", { scrollWheelZoom: false, zoomControl: false }).setView(d.geo, 14);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 18,
      }).addTo(m);
      L.marker(d.geo).addTo(m).bindPopup(esc(d.u));
    };
    initMap();
  }
})();
