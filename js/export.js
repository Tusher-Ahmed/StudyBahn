/* Export page: pick programmes, then download everything as an Excel tracker or a PDF dossier. */
(function () {
  const { $, $$, esc, icon, avatar, exportList, watchlist, compare, profile, deadlines, deadlineBadge, fmtDate, degreeName, feeLabel, isFree, byId, store, DATA, loadDetails, loadScript, checklistItems } = UH;

  const LIBS = {
    xlsx: ["https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js"],
    pdf: ["https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js", "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js"],
  };
  const SECTIONS = [
    ["summary", "Summary of all programmes", true],
    ["deadlines", "Application deadlines", true],
    ["requirements", "Academic requirements & how to apply", true],
    ["language", "Language requirements (IELTS, TOEFL, German…)", true],
    ["costs", "Tuition, fees & living costs", true],
    ["checklist", "Document checklist", true],
    ["contacts", "Contacts & links", true],
    ["description", "Programme description", false],
    ["services", "Student services & support", false],
  ];
  const STATUSES = ["Not started", "Preparing documents", "Applied", "Interview / test", "Admitted", "Rejected", "Withdrawn"];

  // ================================================================ data shaping
  const decoder = document.createElement("textarea");
  function htmlToText(h) {
    if (!h) return "";
    let s = String(h)
      .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (m, href, label) => {
        const t = label.replace(/<[^>]+>/g, "").trim();
        if (/^mailto:/i.test(href)) return t || href.slice(7);
        return !t || t === href || href.includes(t) ? href : `${t} (${href})`;
      })
      .replace(/<li[^>]*>/gi, "\n• ")
      .replace(/<\/(p|li|ul|ol|h4|h5|tr|table)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/t[dh]>/gi, "  ")
      .replace(/<[^>]+>/g, "");
    decoder.innerHTML = s;
    s = decoder.value;
    return s
      .split("\n")
      .map((l) => l.replace(/[ \t ]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  const fosName = (id) => (DATA.meta.fos[id] || {}).name || "";
  const sectionHtml = (d, tab, label) => (((d.sections || {})[tab] || []).find((x) => x.label.toLowerCase() === label.toLowerCase()) || {}).html || "";
  const eur = (n) => (n || n === 0 ? "€" + Number(n).toLocaleString("en") : "");

  function record(d, region) {
    const en = d.english || {};
    const de = d.german || {};
    const liv = d.living || {};
    const dls = deadlines(d, region);
    const checks = store.get("check:" + d.id, []);
    const c = d.contact || {};
    const free = isFree(d);
    return {
      id: d.id,
      name: d.n,
      uni: d.u,
      city: d.c,
      degree: degreeName(d.d),
      subject: d.s || "",
      fields: (d.f || []).map(fosName).filter(Boolean).join(", "),
      language: UH.langLabel(d.l),
      duration: d.dur || "",
      start: d.b || "",
      tuition: free ? "No tuition fees" : d.tuitionText || feeLabel(d),
      tuitionEur: free ? 0 : d.tuitionEur || null,
      semesterFee: d.semesterFee || null,
      livingTotal: liv.total || null,
      living: liv.total ? (liv.low ? `€${liv.low.toLocaleString("en")}–${liv.total.toLocaleString("en")}` : eur(liv.total)) : "",
      livingItems: (liv.items || []).map((x) => `${x.label}: ${x.value}`),
      livingText: htmlToText(sectionHtml(d, "costs", "Costs of living")),
      otherCosts: ((d.sections || {}).costs || []).filter((x) => !/^(tuition fees|semester contribution|costs of living)/i.test(x.label)).map((x) => ({ label: x.label, text: htmlToText(x.html) })),
      enLevel: en.level || "",
      ielts: d.ielts || null,
      toefl: d.toefl || null,
      enCerts: Object.entries(en.certs || {}),
      enText: htmlToText(en.html),
      deLevel: de.none ? "Not required" : de.level || (d.german ? "" : "Not specified"),
      deText: htmlToText(de.html),
      langExempt: htmlToText(d.langExempt),
      gre: !!d.gre,
      gmat: !!d.gmat,
      applyVia: d.uniAssist ? "uni-assist" : d.applyVia ? "Directly to university" : "",
      applyText: htmlToText(d.applyVia),
      academic: htmlToText(d.academic),
      deadlines: dls,
      next: dls[0] || null,
      deadlineText: htmlToText(d.periodsHtml) || d.dl || "",
      rolling: /no deadline/i.test(d.dl || ""),
      description: htmlToText(sectionHtml(d, "overview", "Description/content")),
      organisation: htmlToText(sectionHtml(d, "overview", "Course organisation")),
      services: ((d.sections || {}).services || []).map((x) => ({ label: x.label, text: htmlToText(x.html) })),
      faculty: c.faculty || "",
      address: (c.address || []).join(", "),
      email: c.email || "",
      courseUrl: c.courseUrl || "",
      uniUrl: c.uniUrl || "",
      daadUrl: d.daadUrl || `https://www2.daad.de/deutschland/studienangebote/international-programmes/en/detail/${d.id}/`,
      siteUrl: new URL(`program.html?id=${d.id}`, location.href).href,
      checklist: checklistItems(d).map(([k, title, desc]) => ({ title, desc, done: checks.includes(k) })),
    };
  }

  function sortRecs(recs, order) {
    const by = {
      deadline: (a, b) => (a.next ? a.next.days : 1e6) - (b.next ? b.next.days : 1e6) || a.name.localeCompare(b.name),
      uni: (a, b) => a.uni.localeCompare(b.uni) || a.name.localeCompare(b.name),
      city: (a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name),
      added: () => 0,
    };
    return [...recs].sort(by[order] || by.added);
  }
  const deadlineSummary = (r) =>
    r.next ? `${fmtDate(r.next.date)}${r.next.semester ? " (" + r.next.semester + ")" : ""}` : r.rolling ? "No fixed deadline" : "See programme website";
  const langSummary = (r) => [r.enLevel && `English ${r.enLevel}`, r.ielts && `IELTS ${r.ielts}`, r.toefl && `TOEFL ${r.toefl}`].filter(Boolean).join(" · ");
  const profileSummary = () => {
    const p = profile.get();
    return [p.ielts && `IELTS ${p.ielts}`, p.toefl && `TOEFL ${p.toefl}`, p.german && `German ${p.german}`, p.gre && "GRE"].filter(Boolean).join(", ") || "not set";
  };

  // ================================================================ Excel
  async function buildXlsx(recs, opts) {
    const wb = new ExcelJS.Workbook();
    wb.creator = "StudyBahn";
    wb.created = new Date();
    const NAVY = "FF10172A";
    const ZEBRA = "FFF5F7FB";
    const LINK = { color: { argb: "FF2340D9" }, underline: true };
    const today = new Date();
    const xlDate = (d) => (d ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) : null);
    const clip = (s) => (s && s.length > 32000 ? s.slice(0, 32000) + "…" : s || "");

    function sheet(name, cols, rows, freezeCols) {
      const ws = wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: freezeCols || 0, ySplit: 1 }] });
      ws.columns = cols.map((c) => ({ header: c.h, key: c.k, width: c.w || 16 }));
      rows.forEach((r, i) => {
        const row = ws.addRow(cols.map((c) => (c.link ? null : typeof r[c.k] === "string" ? clip(r[c.k]) : r[c.k] == null ? "" : r[c.k])));
        row.eachCell({ includeEmpty: true }, (cell, n) => {
          const c = cols[n - 1];
          if (!c) return;
          cell.alignment = { vertical: "top", wrapText: !!c.wrap };
          if (i % 2) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
          if (c.date && r[c.k]) cell.numFmt = "dd mmm yyyy";
          if (c.money && typeof r[c.k] === "number") cell.numFmt = '"€"#,##0';
          if (c.link && r[c.k]) {
            cell.value = { text: c.linkText || r[c.k], hyperlink: r[c.k] };
            cell.font = LINK;
          }
          if (c.list) cell.dataValidation = { type: "list", allowBlank: true, formulae: [`"${c.list.join(",")}"`] };
          if (c.days && typeof r[c.k] === "number") {
            const v = r[c.k];
            const color = v <= 30 ? "FFFDE2DF" : v <= 60 ? "FFFFF1CC" : "FFE3F6EC";
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
            cell.font = { bold: true, color: { argb: v <= 30 ? "FFC0261F" : "FF1F2937" } };
          }
          if (c.bold) cell.font = Object.assign({ bold: true }, cell.font || {});
        });
      });
      const head = ws.getRow(1);
      head.height = 30;
      head.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.border = { bottom: { style: "medium", color: { argb: "FFF5B301" } } };
      });
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
      return ws;
    }

    const S = new Set(opts.sections);
    if (S.has("summary")) {
      sheet(
        "Programmes",
        [
          { h: "#", k: "n", w: 5 },
          { h: "Programme", k: "name", w: 38, wrap: true, bold: true },
          { h: "University", k: "uni", w: 30, wrap: true },
          { h: "City", k: "city", w: 14 },
          { h: "Degree", k: "degree", w: 11 },
          { h: "Subject", k: "subject", w: 22, wrap: true },
          { h: "Language", k: "language", w: 14 },
          { h: "Duration", k: "duration", w: 13 },
          { h: "Starts", k: "start", w: 18, wrap: true },
          { h: "Next deadline", k: "nextDate", w: 14, date: true },
          { h: "Semester", k: "nextSem", w: 16 },
          { h: "Days left", k: "days", w: 10, days: true },
          { h: "Tuition / semester", k: "tuition", w: 20, wrap: true },
          { h: "Semester contribution", k: "semesterFee", w: 13, money: true },
          { h: "Living cost / month", k: "living", w: 15 },
          { h: "English level", k: "enLevel", w: 10 },
          { h: "Min. IELTS", k: "ielts", w: 10 },
          { h: "Min. TOEFL iBT", k: "toefl", w: 10 },
          { h: "German", k: "deLevel", w: 13 },
          { h: "GRE / GMAT", k: "test", w: 11 },
          { h: "Apply via", k: "applyVia", w: 18 },
          { h: "Programme website", k: "courseUrl", w: 18, link: true, linkText: "Open website" },
          { h: "Contact email", k: "email", w: 26 },
          { h: "DAAD page", k: "daadUrl", w: 12, link: true, linkText: "DAAD" },
          { h: "My status", k: "status", w: 20, list: STATUSES },
          { h: "Applied on", k: "appliedOn", w: 12 },
          { h: "Notes", k: "notes", w: 34, wrap: true },
        ],
        recs.map((r, i) => ({
          ...r,
          n: i + 1,
          nextDate: r.next ? xlDate(r.next.date) : r.rolling ? "No deadline" : "See website",
          nextSem: r.next ? r.next.semester : "",
          days: r.next ? r.next.days : "",
          test: [r.gre && "GRE", r.gmat && "GMAT"].filter(Boolean).join(", ") || "—",
          status: "Not started",
        })),
        2
      );
    }
    if (S.has("deadlines")) {
      const rows = [];
      recs.forEach((r) => {
        if (r.deadlines.length)
          r.deadlines.forEach((d) =>
            rows.push({ name: r.name, uni: r.uni, sem: d.semester || "", who: d.who || "All applicants", opens: d.opens ? xlDate(d.opens) : "", date: xlDate(d.date), days: d.days, state: d.state === "soon" ? "Closing soon" : d.state === "notyet" ? "Not open yet" : "Upcoming", sort: d.date })
          );
        else rows.push({ name: r.name, uni: r.uni, sem: "", who: "", opens: "", date: r.rolling ? "No fixed deadline" : "See website", days: "", state: r.deadlineText, sort: new Date(8.64e15) });
      });
      rows.sort((a, b) => a.sort - b.sort);
      sheet(
        "Deadlines",
        [
          { h: "Deadline", k: "date", w: 14, date: true, bold: true },
          { h: "Days left", k: "days", w: 10, days: true },
          { h: "Programme", k: "name", w: 38, wrap: true },
          { h: "University", k: "uni", w: 30, wrap: true },
          { h: "Semester", k: "sem", w: 18 },
          { h: "Applicants from", k: "who", w: 24, wrap: true },
          { h: "Applications open", k: "opens", w: 14, date: true },
          { h: "Status / note", k: "state", w: 34, wrap: true },
          { h: "Submitted?", k: "submitted", w: 12, list: ["Yes", "No"] },
        ],
        rows,
        1
      );
    }
    if (S.has("requirements") || S.has("language")) {
      const cols = [
        { h: "Programme", k: "name", w: 32, wrap: true, bold: true },
        { h: "University", k: "uni", w: 24, wrap: true },
      ];
      if (S.has("requirements"))
        cols.push({ h: "Academic requirements", k: "academic", w: 70, wrap: true }, { h: "GRE / GMAT mentioned", k: "test", w: 12 }, { h: "How to apply", k: "applyFull", w: 40, wrap: true });
      if (S.has("language"))
        cols.push(
          { h: "English level", k: "enLevel", w: 10 },
          { h: "Accepted English certificates", k: "certs", w: 40, wrap: true },
          { h: "German requirement", k: "german", w: 30, wrap: true },
          { h: "Language exemptions", k: "langExempt", w: 40, wrap: true }
        );
      sheet(
        "Requirements",
        cols,
        recs.map((r) => ({
          ...r,
          test: [r.gre && "GRE", r.gmat && "GMAT"].filter(Boolean).join(", ") || "No",
          applyFull: [r.applyVia, r.applyText].filter(Boolean).join("\n"),
          certs: r.enCerts.length ? r.enCerts.map(([k, v]) => `${k}: ${v}`).join("\n") : r.enText,
          german: [r.deLevel, r.deText && r.deText !== r.deLevel ? r.deText : ""].filter(Boolean).join("\n"),
        })),
        1
      );
    }
    if (S.has("costs")) {
      sheet(
        "Costs",
        [
          { h: "Programme", k: "name", w: 32, wrap: true, bold: true },
          { h: "University", k: "uni", w: 24, wrap: true },
          { h: "City", k: "city", w: 14 },
          { h: "Tuition / semester", k: "tuition", w: 26, wrap: true },
          { h: "Tuition (€)", k: "tuitionEur", w: 12, money: true },
          { h: "Semester contribution (€)", k: "semesterFee", w: 14, money: true },
          { h: "Living cost / month", k: "living", w: 16 },
          { h: "Living cost / year (upper)", k: "livingYear", w: 15, money: true },
          { h: "Living cost details", k: "livingText", w: 60, wrap: true },
          { h: "Funding & other costs", k: "other", w: 50, wrap: true },
        ],
        recs.map((r) => ({ ...r, livingYear: r.livingTotal ? r.livingTotal * 12 : "", other: r.otherCosts.map((x) => `${x.label}: ${x.text}`).join("\n\n") })),
        1
      );
    }
    if (S.has("checklist")) {
      const rows = [];
      recs.forEach((r) => r.checklist.forEach((c, i) => rows.push({ name: i ? "" : r.name, uni: i ? "" : r.uni, doc: c.title, desc: c.desc, done: c.done ? "Yes" : "No" })));
      sheet(
        "Checklist",
        [
          { h: "Programme", k: "name", w: 34, wrap: true, bold: true },
          { h: "University", k: "uni", w: 24, wrap: true },
          { h: "Document", k: "doc", w: 34, wrap: true },
          { h: "Details", k: "desc", w: 60, wrap: true },
          { h: "Ready?", k: "done", w: 10, list: ["Yes", "No", "N/A"] },
        ],
        rows,
        1
      );
    }
    if (S.has("description") || S.has("services")) {
      const cols = [
        { h: "Programme", k: "name", w: 32, wrap: true, bold: true },
        { h: "University", k: "uni", w: 24, wrap: true },
      ];
      if (S.has("description")) cols.push({ h: "Description", k: "description", w: 90, wrap: true }, { h: "Course organisation", k: "organisation", w: 50, wrap: true });
      if (S.has("services")) cols.push({ h: "Student services & support", k: "svc", w: 80, wrap: true });
      sheet("Details", cols, recs.map((r) => ({ ...r, svc: r.services.map((x) => `${x.label}:\n${x.text}`).join("\n\n") })), 1);
    }
    if (S.has("contacts")) {
      sheet(
        "Contacts",
        [
          { h: "Programme", k: "name", w: 34, wrap: true, bold: true },
          { h: "University", k: "uni", w: 28, wrap: true },
          { h: "Faculty / department", k: "faculty", w: 28, wrap: true },
          { h: "Address", k: "address", w: 34, wrap: true },
          { h: "Email", k: "email", w: 30 },
          { h: "Programme website", k: "courseUrl", w: 40, link: true },
          { h: "University website", k: "uniUrl", w: 30, link: true },
          { h: "DAAD page", k: "daadUrl", w: 30, link: true },
        ],
        recs,
        1
      );
    }
    // About sheet
    const about = wb.addWorksheet("About");
    about.columns = [{ width: 26 }, { width: 80 }];
    const t = about.addRow(["StudyBahn — your track to studying in Germany"]);
    t.font = { bold: true, size: 16, color: { argb: NAVY } };
    about.addRow([]);
    [
      ["Generated", fmtDate(today)],
      ["Programmes", String(recs.length)],
      ["Deadlines shown for", opts.region === "EU" ? "EU / EEA applicants" : "Non-EU applicants"],
      ["Your profile", profileSummary()],
      ["Source", "DAAD International Programmes in Germany (daad.de)"],
      ["Tip", "Use the 'My status' dropdown and filters on the Programmes sheet to track your applications."],
      ["Important", "Requirements and deadlines can change. Always confirm on the university's official programme page before applying."],
    ].forEach(([k, v]) => {
      const r = about.addRow([k, v]);
      r.getCell(1).font = { bold: true };
      r.getCell(2).alignment = { wrapText: true };
    });
    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  // ================================================================ PDF
  const PDF_MAP = { "‘": "'", "’": "'", "‚": ",", "“": '"', "”": '"', "„": '"', "–": "-", "—": " - ", "…": "...", "€": "EUR ", "•": "-", " ": " ", "‐": "-", "‑": "-", "−": "-", "­": "", "→": "->", "≤": "<=", "≥": ">=", "™": "(TM)", "·": "-", "​": "" };
  const pdfText = (s) =>
    String(s == null ? "" : s)
      .replace(/[‘’‚“”„–—…€• ‐‑−­→≤≥™·​]/g, (c) => PDF_MAP[c])
      .replace(/EUR (\d)/g, "EUR $1")
      .replace(/[^\x00-\xff]/g, "")
      .replace(/€/g, "EUR");

  async function buildPdf(recs, opts) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 40;
    const C = { navy: [16, 23, 42], gold: [245, 179, 1], red: [224, 50, 43], ink: [17, 24, 39], ink2: [55, 65, 81], muted: [107, 114, 128], line: [227, 231, 239], primary: [35, 64, 217], soft: [245, 247, 251], ok: [15, 157, 107], danger: [212, 54, 47] };
    const S = new Set(opts.sections);
    let y = M;
    const T = pdfText;

    const ensure = (h) => {
      if (y + h > H - M - 16) {
        doc.addPage();
        y = M;
      }
    };
    const set = (size, style, color) => {
      doc.setFont("helvetica", style || "normal");
      doc.setFontSize(size);
      doc.setTextColor(...(color || C.ink));
    };
    function heading(label) {
      ensure(44);
      y += 10;
      doc.setFillColor(...C.gold);
      doc.rect(M, y - 10, 3, 14, "F");
      set(12.5, "bold", C.navy);
      doc.text(T(label), M + 10, y + 1);
      y += 16;
    }
    function sub(label) {
      ensure(26);
      set(10, "bold", C.ink);
      doc.text(T(label), M, y);
      y += 13;
    }
    function para(s, opt) {
      if (!s) return;
      opt = opt || {};
      set(opt.size || 9.5, opt.style || "normal", opt.color || C.ink2);
      const lh = (opt.size || 9.5) * 1.35;
      const width = W - 2 * M - (opt.indent || 0);
      T(s)
        .split("\n")
        .forEach((line) => {
          if (!line.trim()) {
            y += lh * 0.5;
            return;
          }
          doc.splitTextToSize(line, width).forEach((l) => {
            ensure(lh);
            doc.text(l, M + (opt.indent || 0), y);
            y += lh;
          });
        });
      y += 4;
    }
    function table(head, body, o) {
      ensure(40);
      doc.autoTable(
        Object.assign(
          {
            startY: y,
            head: head ? [head.map(T)] : undefined,
            body: body.map((r) => r.map((c) => (typeof c === "object" && c !== null ? Object.assign({}, c, { content: T(c.content) }) : T(c)))),
            margin: { left: M, right: M, top: M, bottom: M + 10 },
            styles: { font: "helvetica", fontSize: 8.5, cellPadding: 5, textColor: C.ink2, lineColor: C.line, lineWidth: 0.5, overflow: "linebreak", valign: "top" },
            headStyles: { fillColor: C.navy, textColor: [255, 255, 255], fontStyle: "bold" },
            alternateRowStyles: { fillColor: C.soft },
            theme: "grid",
          },
          o || {}
        )
      );
      y = doc.lastAutoTable.finalY + 12;
    }
    function link(label, url) {
      if (!url) return;
      ensure(14);
      set(9.5, "bold", C.ink);
      doc.text(T(label), M, y);
      set(9.5, "normal", C.primary);
      const shown = T(url.length > 85 ? url.slice(0, 82) + "..." : url);
      doc.textWithLink(shown, M + 110, y, { url });
      y += 14;
    }
    function logo(x, yy, s) {
      doc.setDrawColor(255, 255, 255);
      doc.setLineWidth(s * 0.07);
      doc.lines([[0, -s * 0.27, s * 0.47, -s * 0.2, s * 0.47, -s * 0.47]], x, yy, [1, 1], "S", false);
      doc.setFillColor(...C.red);
      doc.circle(x, yy, s * 0.1, "F");
      doc.setFillColor(...C.gold);
      doc.circle(x + s * 0.47, yy - s * 0.47, s * 0.11, "F");
    }

    // ---------- cover
    doc.setFillColor(...C.navy);
    doc.rect(0, 0, W, 170, "F");
    doc.setFillColor(20, 20, 20);
    doc.rect(0, 170, W / 3, 4, "F");
    doc.setFillColor(...C.red);
    doc.rect(W / 3, 170, W / 3, 4, "F");
    doc.setFillColor(...C.gold);
    doc.rect((2 * W) / 3, 170, W / 3, 4, "F");
    logo(M + 4, 76, 40);
    set(22, "bold", [255, 255, 255]);
    doc.text("StudyBahn", M + 34, 64);
    set(10, "normal", [200, 205, 215]);
    doc.text("Your track to studying in Germany", M + 34, 80);
    set(24, "bold", [255, 255, 255]);
    doc.text("My programme selection", M, 136);
    y = 204;
    const nextAll = recs.filter((r) => r.next).sort((a, b) => a.next.date - b.next.date)[0];
    [
      ["Generated", fmtDate(new Date())],
      ["Programmes", String(recs.length)],
      ["Deadlines shown for", opts.region === "EU" ? "EU / EEA applicants" : "Non-EU applicants"],
      ["Your profile", profileSummary()],
      ["Earliest deadline", nextAll ? `${fmtDate(nextAll.next.date)} - ${nextAll.name} (${nextAll.next.days} days left)` : "-"],
    ].forEach(([k, v]) => {
      set(9.5, "bold", C.muted);
      doc.text(T(k), M, y);
      set(9.5, "normal", C.ink);
      doc.text(doc.splitTextToSize(T(v), W - 2 * M - 120)[0], M + 120, y);
      y += 15;
    });
    y += 8;

    if (S.has("summary")) {
      heading("Summary");
      table(
        ["#", "Programme", "University / City", "Next deadline", "Language", "Tuition"],
        recs.map((r, i) => [String(i + 1), { content: r.name, styles: { fontStyle: "bold", textColor: C.ink } }, `${r.uni}\n${r.city}`, r.next ? `${fmtDate(r.next.date)}\n${r.next.days} days left` : r.rolling ? "No fixed deadline" : "See website", langSummary(r) || r.language, r.tuition]),
        { columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 140 }, 3: { cellWidth: 78 } } }
      );
    }
    if (S.has("deadlines")) {
      const rows = [];
      recs.forEach((r) => r.deadlines.forEach((d) => rows.push([d, r])));
      rows.sort((a, b) => a[0].date - b[0].date);
      if (rows.length) {
        heading("Deadline calendar");
        table(
          ["Deadline", "Days left", "Programme", "Semester", "Applicants"],
          rows.map(([d, r]) => [fmtDate(d.date), { content: String(d.days), styles: d.days <= 30 ? { textColor: C.danger, fontStyle: "bold" } : {} }, `${r.name}\n${r.uni}`, d.semester || "-", d.who || "All"]),
          { columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 48 } } }
        );
      }
    }

    // ---------- one section per programme
    recs.forEach((r, i) => {
      doc.addPage();
      doc.setFillColor(...C.navy);
      doc.rect(0, 0, W, 92, "F");
      doc.setFillColor(...C.gold);
      doc.rect(0, 92, W, 3, "F");
      set(8.5, "bold", C.gold);
      doc.text(T(`PROGRAMME ${i + 1} OF ${recs.length}  ·  ${r.degree.toUpperCase()}`).replace(/[^\x00-\xff]/g, "-"), M, 28);
      set(15, "bold", [255, 255, 255]);
      const title = doc.splitTextToSize(T(r.name), W - 2 * M).slice(0, 2);
      doc.text(title, M, 48);
      set(10, "normal", [205, 210, 220]);
      doc.text(T(`${r.uni}  -  ${r.city}`), M, 48 + title.length * 17);
      y = 116;

      table(
        null,
        [
          ["Degree", r.degree, "Duration", r.duration || "-"],
          ["Language", r.language, "Starts", r.start || "-"],
          ["Tuition", r.tuition, "Semester fee", r.semesterFee ? `EUR ${r.semesterFee}` : "-"],
          ["Next deadline", r.next ? `${fmtDate(r.next.date)} (${r.next.days} days)` : r.rolling ? "No fixed deadline" : "See website", "English", langSummary(r) || "-"],
          ["Subject", r.subject || "-", "German", r.deLevel || "-"],
        ],
        { theme: "plain", styles: { fontSize: 9, cellPadding: 4, textColor: C.ink }, columnStyles: { 0: { fontStyle: "bold", textColor: C.muted, cellWidth: 80 }, 2: { fontStyle: "bold", textColor: C.muted, cellWidth: 80 } }, alternateRowStyles: {} }
      );

      if (S.has("deadlines")) {
        heading("Application deadlines");
        if (r.deadlines.length)
          table(
            ["Semester", "Applicants from", "Opens", "Deadline", "Days left"],
            r.deadlines.map((d) => [d.semester || "-", d.who || "All applicants", d.opens ? fmtDate(d.opens) : "-", { content: fmtDate(d.date), styles: { fontStyle: "bold", textColor: C.ink } }, { content: String(d.days), styles: d.days <= 30 ? { textColor: C.danger, fontStyle: "bold" } : {} }])
          );
        else para(r.deadlineText || "No deadline listed - check the programme website.");
      }
      if (S.has("requirements")) {
        heading("Academic requirements");
        para(r.academic || "Not specified - see the programme website.");
        if (r.gre || r.gmat) para(`Note: ${[r.gre && "GRE", r.gmat && "GMAT"].filter(Boolean).join(" / ")} is mentioned in the requirements.`, { style: "bold", color: C.ink });
        if (r.applyVia || r.applyText) {
          sub("How to apply");
          para([r.applyVia, r.applyText].filter(Boolean).join(" - "));
        }
      }
      if (S.has("language")) {
        heading("Language requirements");
        sub(`English: ${r.enLevel || "see below"}`);
        if (r.enCerts.length) table(["Accepted certificate", "Minimum"], r.enCerts, { columnStyles: { 1: { cellWidth: 120 } } });
        else para(r.enText || "Not specified.");
        sub(`German: ${r.deLevel || "not specified"}`);
        if (r.deText && r.deText !== r.deLevel) para(r.deText);
        if (r.langExempt) {
          sub("Exemptions");
          para(r.langExempt);
        }
      }
      if (S.has("costs")) {
        heading("Costs & funding");
        const rows = [
          ["Tuition per semester", r.tuition],
          ["Semester contribution", r.semesterFee ? `EUR ${r.semesterFee}` : "-"],
          ["Living costs per month", r.living ? r.living : "-"],
        ];
        r.livingItems.forEach((x) => rows.push(["  " + x.split(":")[0], x.split(":").slice(1).join(":").trim()]));
        table(null, rows, { theme: "grid", columnStyles: { 0: { fontStyle: "bold", cellWidth: 150 } } });
        if (!r.livingItems.length && r.livingText) para(r.livingText, { size: 9 });
        r.otherCosts.forEach((x) => {
          sub(x.label);
          para(x.text, { size: 9 });
        });
      }
      if (S.has("checklist")) {
        heading("Document checklist");
        table(
          null,
          r.checklist.map((c) => ["", { content: c.title, styles: { fontStyle: "bold", textColor: C.ink } }, c.desc]),
          {
            theme: "plain",
            styles: { fontSize: 9, cellPadding: 4 },
            columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 170 } },
            didDrawCell: (h) => {
              if (h.section !== "body" || h.column.index !== 0) return;
              const done = r.checklist[h.row.index].done;
              const x = h.cell.x + 5;
              const yy = h.cell.y + 4;
              doc.setDrawColor(...(done ? C.ok : C.muted));
              doc.setLineWidth(0.8);
              doc.rect(x, yy, 9, 9);
              if (done) {
                doc.setDrawColor(...C.ok);
                doc.setLineWidth(1.4);
                doc.lines([[2.5, 3], [5, -6.5]], x + 1.8, yy + 4.5);
              }
            },
          }
        );
      }
      if (S.has("description") && (r.description || r.organisation)) {
        heading("About the programme");
        para(r.description, { size: 9 });
        if (r.organisation) {
          sub("Course organisation");
          para(r.organisation, { size: 9 });
        }
      }
      if (S.has("services") && r.services.length) {
        heading("Student services & support");
        r.services.forEach((x) => {
          sub(x.label);
          para(x.text, { size: 9 });
        });
      }
      if (S.has("contacts")) {
        heading("Contacts & links");
        if (r.faculty) para(`${r.uni} - ${r.faculty}`, { color: C.ink });
        if (r.address) para(r.address);
        if (r.email) link("Email", "mailto:" + r.email);
        link("Programme website", r.courseUrl);
        link("University website", r.uniUrl);
        link("DAAD page", r.daadUrl);
        link("StudyBahn page", r.siteUrl);
      }
    });

    // ---------- footer on every page
    const n = doc.internal.getNumberOfPages();
    for (let p = 1; p <= n; p++) {
      doc.setPage(p);
      doc.setDrawColor(...C.line);
      doc.setLineWidth(0.5);
      doc.line(M, H - 30, W - M, H - 30);
      set(7.5, "normal", C.muted);
      doc.text(T(`StudyBahn - generated ${fmtDate(new Date())} - data: DAAD. Always confirm on the university's website.`), M, H - 18);
      doc.text(`Page ${p} of ${n}`, W - M, H - 18, { align: "right" });
    }
    return doc.output("blob");
  }

  window.SBExport = { record, buildXlsx, buildPdf, htmlToText, sortRecs, SECTIONS };

  // ================================================================ UI
  if (!$("#selection")) return;
  UH.header("export");

  let fmt = store.get("exportFormat", "xlsx");
  let chosen = new Set(store.get("exportSections", SECTIONS.filter((s) => s[2]).map((s) => s[0])));
  $("#region").value = profile.get().region === "EU" ? "EU" : "non-EU";
  $("#order").value = store.get("exportOrder", "deadline");

  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  DATA.programmes.forEach((p) => (p._hay = p._hay || norm(`${p.n} ${p.u} ${p.c} ${p.s || ""}`)));

  function renderSections() {
    $("#sections").innerHTML = SECTIONS.map(([k, label]) => `<label class="opt"><input type="checkbox" value="${k}" ${chosen.has(k) ? "checked" : ""}><span>${esc(label)}</span></label>`).join("");
  }
  function renderFormat() {
    $$(".fmt").forEach((b) => {
      const on = b.dataset.fmt === fmt;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on);
    });
    updateButton();
  }
  function updateButton() {
    const n = exportList.all().length;
    const btn = $("#do-export");
    btn.disabled = !n || !chosen.size;
    btn.innerHTML = `${icon("download")} ${n ? `Export ${n} programme${n === 1 ? "" : "s"} as ${fmt === "xlsx" ? "Excel" : "PDF"}` : "Select programmes to export"}`;
  }

  function orderedIds() {
    const ids = exportList.all().filter((id) => byId.has(id));
    const order = $("#order").value;
    if (order === "added") return ids;
    const region = $("#region").value;
    const rows = ids.map((id) => byId.get(id));
    const key = {
      deadline: (a, b) => ((deadlines(a, region)[0] || {}).days ?? 1e6) - ((deadlines(b, region)[0] || {}).days ?? 1e6),
      uni: (a, b) => a.u.localeCompare(b.u),
      city: (a, b) => a.c.localeCompare(b.c),
    }[order];
    return rows.sort((a, b) => key(a, b) || a.n.localeCompare(b.n)).map((p) => p.id);
  }

  function renderSelection() {
    const ids = orderedIds();
    $("#sel-title").textContent = ids.length ? `Selected programmes (${ids.length})` : "Selected programmes";
    $("#clear-sel").hidden = !ids.length;
    $("#selection").innerHTML = ids.length
      ? `<div class="sel-list">${ids
          .map((id) => {
            const p = byId.get(id);
            return `<div class="sel-row">
              ${avatar(p.u)}
              <div class="sel-main">
                <a href="program.html?id=${p.id}" class="sel-name">${esc(p.n)}</a>
                <div class="muted sel-sub">${esc(p.u)} · ${esc(p.c)}</div>
                <div class="tags"><span class="badge badge-primary">${degreeName(p.d)}</span>${deadlineBadge(p)}${p.ielts ? `<span class="badge badge-gold">IELTS ${p.ielts}</span>` : ""}<span class="badge ${isFree(p) ? "badge-ok" : ""}">${esc(feeLabel(p))}</span></div>
              </div>
              <button class="icon-btn" data-remove="${p.id}" title="Remove" aria-label="Remove ${esc(p.n)}">${icon("x")}</button>
            </div>`;
          })
          .join("")}</div>`
      : `<div class="empty"><h3>No programmes selected yet</h3><p>Search above, add your shortlist, or use <b>Export results</b> on the finder to bring in a whole filtered list.</p><a class="btn btn-ghost" href="index.html">${icon("search")} Browse programmes</a></div>`;
    renderQuickAdd();
    updateButton();
  }

  function renderQuickAdd() {
    const sel = new Set(exportList.all());
    const w = watchlist.all().filter((id) => !sel.has(id));
    const c = compare.all().filter((id) => !sel.has(id));
    $("#quick-add").innerHTML = [
      w.length ? `<button class="chip" data-addlist="watchlist">${icon("bookmark")} Add my shortlist (${w.length})</button>` : "",
      c.length ? `<button class="chip" data-addlist="compare">${icon("compare")} Add compare list (${c.length})</button>` : "",
      `<a class="chip" href="index.html">${icon("search")} Filter in the finder, then “Export results”</a>`,
    ].join("");
  }

  // ---------- search picker
  let hits = [];
  let active = -1;
  function search(q) {
    const terms = norm(q).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const out = [];
    for (const p of DATA.programmes) {
      if (terms.every((t) => p._hay.includes(t))) {
        out.push(p);
        if (out.length >= 30) break;
      }
    }
    return out.sort((a, b) => (norm(b.n).includes(terms[0]) ? 1 : 0) - (norm(a.n).includes(terms[0]) ? 1 : 0)).slice(0, 8);
  }
  function renderHits() {
    const box = $("#pick-results");
    const q = $("#pick-q").value.trim();
    if (!q) {
      box.hidden = true;
      $("#pick-q").setAttribute("aria-expanded", "false");
      return;
    }
    const sel = new Set(exportList.all());
    box.hidden = false;
    $("#pick-q").setAttribute("aria-expanded", "true");
    box.innerHTML = hits.length
      ? hits
          .map(
            (p, i) => `<button type="button" role="option" class="pick-item ${i === active ? "active" : ""} ${sel.has(p.id) ? "added" : ""}" data-pick="${p.id}">
              <span><b>${esc(p.n)}</b><small>${esc(p.u)} · ${esc(p.c)} · ${degreeName(p.d)}</small></span>
              <span class="pick-add">${sel.has(p.id) ? icon("check") + " Added" : "+ Add"}</span>
            </button>`
          )
          .join("")
      : `<div class="pick-empty muted">No programmes match “${esc(q)}”</div>`;
  }
  $("#pick-q").addEventListener("input", (e) => {
    hits = search(e.target.value);
    active = hits.length ? 0 : -1;
    renderHits();
  });
  $("#pick-q").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!hits.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
      renderHits();
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      togglePick(hits[active].id);
    } else if (e.key === "Escape") {
      e.target.value = "";
      renderHits();
    }
  });
  function togglePick(id) {
    if (exportList.has(id)) exportList.remove(id);
    else exportList.addMany([id]);
    renderHits();
  }
  $("#pick-results").addEventListener("mousedown", (e) => {
    const b = e.target.closest("[data-pick]");
    if (!b) return;
    e.preventDefault();
    togglePick(+b.dataset.pick);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".picker")) $("#pick-results").hidden = true;
  });
  $("#pick-q").addEventListener("focus", renderHits);

  // ---------- other controls
  $("#quick-add").addEventListener("click", (e) => {
    const b = e.target.closest("[data-addlist]");
    if (!b) return;
    const n = exportList.addMany(b.dataset.addlist === "watchlist" ? watchlist.all() : compare.all());
    UH.toast(`Added ${n} programme${n === 1 ? "" : "s"}`);
  });
  $("#selection").addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove]");
    if (b) exportList.remove(+b.dataset.remove);
  });
  $("#clear-sel").onclick = () => {
    if (confirm("Remove all programmes from the export list?")) exportList.clear();
  };
  $("#order").onchange = () => {
    store.set("exportOrder", $("#order").value);
    renderSelection();
  };
  $("#region").onchange = renderSelection;
  $$(".fmt").forEach(
    (b) =>
      (b.onclick = () => {
        fmt = b.dataset.fmt;
        store.set("exportFormat", fmt);
        renderFormat();
      })
  );
  $("#sections").addEventListener("change", () => {
    chosen = new Set($$("#sections input:checked").map((i) => i.value));
    store.set("exportSections", [...chosen]);
    updateButton();
  });
  document.addEventListener("studybahn:store", (e) => {
    if (e.detail.key === "export" || e.detail.key === "watchlist" || e.detail.key === "compare") renderSelection();
  });

  // ---------- export
  function progress(pct, text) {
    $("#progress").hidden = false;
    $("#progress-bar").style.width = pct + "%";
    $("#progress-text").textContent = text;
  }
  $("#do-export").onclick = async () => {
    const ids = orderedIds();
    if (!ids.length) return;
    if (fmt === "pdf" && ids.length > 60 && !confirm(`A PDF with ${ids.length} programmes will be very long. Continue?`)) return;
    const btn = $("#do-export");
    btn.disabled = true;
    try {
      progress(3, "Loading export library…");
      for (const src of LIBS[fmt]) await loadScript(src);
      const details = await loadDetails(ids, (done, total) => progress(5 + (done / total) * 70, `Collecting details ${done} / ${total}…`));
      const region = $("#region").value;
      const recs = details.map((d) => record(d, region));
      progress(80, `Building ${fmt === "xlsx" ? "Excel workbook" : "PDF"}…`);
      await new Promise((r) => setTimeout(r, 30));
      const opts = { sections: SECTIONS.map((s) => s[0]).filter((k) => chosen.has(k)), region };
      const blob = fmt === "xlsx" ? await buildXlsx(recs, opts) : await buildPdf(recs, opts);
      const name = ($("#fname").value.trim() || "StudyBahn-export").replace(/[\\/:*?"<>|]+/g, "-");
      UH.download(`${name}.${fmt}`, blob, blob.type);
      progress(100, `Done — ${name}.${fmt} downloaded`);
      UH.toast(`${fmt === "xlsx" ? "Excel" : "PDF"} downloaded`);
    } catch (err) {
      console.error(err);
      progress(0, "Export failed: " + (err && err.message ? err.message : err) + ". Check your internet connection and try again.");
    } finally {
      updateButton();
    }
  };

  renderSections();
  renderFormat();
  renderSelection();
})();
