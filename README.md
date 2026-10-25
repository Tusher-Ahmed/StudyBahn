# StudyBahn — your track to studying in Germany

Find international Bachelor's and Master's programmes in Germany. You can see admission requirements, language scores and application deadlines without leaving the site.

## Features

- **Search & filters**: 2,127 programmes (DAAD International Programmes). Search understands abbreviations (AI, CS, TUM…). Filter counts update live for degree, deadline window, subject area, field of study, teaching language, tuition, requirements (no German, no GRE, uni-assist), start semester and city. Shareable URLs.
- **List / grid / map views**: clustered map of every university.
- **Programme page**:
  - Academic requirements
  - English/German CEFR level with the accepted certificates and their minimum scores
  - How to apply (uni-assist or direct)
  - Application deadlines per applicant group and semester, with countdowns and **Add to calendar (.ics)** with 14- and 3-day reminders
  - A document checklist you can tick off
  - Costs and living-cost breakdown, student services, contact details, a map and similar programmes
- **Match profile**: enter IELTS/TOEFL/German level and EU or non-EU status. Programmes are marked "You qualify" or "Language gap", and the deadlines shown are the ones that apply to you.
- **Shortlist**: a deadline planner grouped by month (exportable to your calendar), saved programmes, and a side-by-side comparison of up to 4.
- **Export to Excel or PDF** (`export.html`): pick programmes by searching, adding your shortlist, using the export button on any card, or sending a whole filtered result list with "Export results". Choose which sections to include.
  - *Excel tracker*: Programmes (with a "My status" dropdown, Applied on and Notes columns), Deadlines, Requirements, Costs, Checklist, Details and Contacts sheets, all with filters and frozen headers.
  - *PDF dossier*: a cover page with a summary and a deadline calendar, then one section per programme (facts, deadlines, requirements, language scores, costs, a tickable checklist and clickable links).
  - Generated entirely in the browser (ExcelJS / jsPDF, loaded on demand).
- Dark mode, mobile layout, no build step. Works from `file://` or any static host (GitHub Pages).

## Run

Open `index.html`, or serve the folder:

```sh
python -m http.server 8000
```

## Refresh the data

```sh
python scripts/fetch.py      # downloads the list + every detail page into scripts/.cache (about 10 min)
python scripts/build.py      # writes data/programmes.js and data/details/<id>.js
```

Delete `scripts/.cache/` first to force a full re-download. Data © DAAD. Always confirm details on the university's official page.
