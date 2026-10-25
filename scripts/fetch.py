"""Step 1: download the DAAD International Programmes list (Bachelor + Master)
and every programme's detail page into scripts/.cache/.

Re-runs skip pages that are already cached. Delete .cache/ to refresh.
Usage:  python scripts/fetch.py [--workers 6]
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

BASE = "https://www2.daad.de/deutschland/studienangebote/international-programmes"
CACHE = Path(__file__).parent / ".cache"
DETAIL_DIR = CACHE / "detail"
UA = "Mozilla/5.0 (StudyBahn study-finder; personal project)"

DEGREES = {1: "Bachelor", 2: "Master"}
SUBJECT_GROUPS = {
    1: "Agricultural and Forest Sciences",
    146: "Art, Music, Design",
    380: "Economic Sciences, Law",
    56: "Engineering Sciences",
    17: "Humanities and Social Sciences",
    273: "Language and Cultural Studies",
    193: "Mathematics, Natural Sciences",
    255: "Medicine, Health Sciences",
    382: "Public Administration",
    381: "Teaching Degrees",
}


def get(url, retries=4):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            if attempt == retries - 1:
                raise
            time.sleep(2 * (attempt + 1))


def search(params):
    q = [("q", ""), ("limit", "3000"), ("offset", "0"), ("display", "list")]
    q += [("degree[]", str(d)) for d in DEGREES]
    q += params
    url = f"{BASE}/api/solr/en/search.json?" + urllib.parse.urlencode(q)
    return json.loads(get(url))


def main():
    workers = int(sys.argv[sys.argv.index("--workers") + 1]) if "--workers" in sys.argv else 6
    CACHE.mkdir(exist_ok=True)
    DETAIL_DIR.mkdir(exist_ok=True)

    print("Fetching programme list…")
    base = search([])
    courses = base["courses"]
    print(f"  {len(courses)} programmes (API says {base['numResults']})")

    # Tag subject groups by querying each group separately.
    groups = {}
    for gid in SUBJECT_GROUPS:
        res = search([("subjectGroup[]", str(gid))])
        for c in res["courses"]:
            groups.setdefault(c["id"], []).append(gid)
        print(f"  group {gid}: {len(res['courses'])}")

    # Fields of study (finer subject filter) come from the result page's fos map.
    fos_map = []
    html = get(f"{BASE}/en/result/?degree%5B%5D=2")
    import html as htmllib, re
    m = re.search(r'data-fos-map="([^"]+)"', html)
    if m:
        fos_map = json.loads(htmllib.unescape(m.group(1)))
    fos = {}
    for f in fos_map:
        res = search([("fos", str(f["id"]))])
        for c in res["courses"]:
            fos.setdefault(c["id"], []).append(f["id"])
    print(f"  tagged {len(fos)} programmes with {len(fos_map)} fields of study")

    (CACHE / "list.json").write_text(
        json.dumps({"courses": courses, "groups": groups, "fos": fos, "fosMap": fos_map}),
        encoding="utf-8",
    )

    todo = [c for c in courses if not (DETAIL_DIR / f"{c['id']}.html").exists()]
    print(f"Fetching {len(todo)} detail pages with {workers} workers…")

    def fetch_one(c):
        html = get(f"{BASE}/en/detail/{c['id']}/")
        (DETAIL_DIR / f"{c['id']}.html").write_text(html, encoding="utf-8")
        return c["id"]

    done = 0
    failed = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(fetch_one, c): c["id"] for c in todo}
        for fut in as_completed(futs):
            try:
                fut.result()
            except Exception as e:  # noqa: BLE001
                failed.append((futs[fut], str(e)))
            done += 1
            if done % 100 == 0:
                print(f"  {done}/{len(todo)}")
    print(f"Done. {len(failed)} failed: {failed[:10]}")


if __name__ == "__main__":
    main()
