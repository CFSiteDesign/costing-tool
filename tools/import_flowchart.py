#!/usr/bin/env python3
"""
Flow-chart re-pull (9 Sep 2026): reads every VISIBLE location tab of the
MAD MONKEY EXPERIENCE FLOW CHART workbook (hidden and "OLD" tabs skipped),
matches rows to products already in the database, then

  * proposes start / finish times read from the ITINERARY column (falling back to the
    DAY, TIME & DURATION column, then start + duration) for products whose times differ,
    queued in product_time_proposals for Reden to approve;
  * inserts experiences added to the sheet since the first pull (23 Aug 2026).

Usage:
  python3 tools/import_flowchart.py WORKBOOK.xlsx            # dry run, prints what would happen
  python3 tools/import_flowchart.py WORKBOOK.xlsx --apply    # writes via the REST API as the admin user
Env: MM_ADMIN_EMAIL, MM_ADMIN_PASSWORD (admin login), optional MM_SUPABASE_URL / MM_ANON_KEY.
"""
import sys, os, re, json, csv, difflib, datetime as dt
from collections import defaultdict, Counter
import openpyxl, requests

URL = os.environ.get("MM_SUPABASE_URL", "https://avftyexxqyykppzmrjxn.supabase.co")
ANON = os.environ.get("MM_ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2ZnR5ZXh4cXl5a3Bwem1yanhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0OTgyNzAsImV4cCI6MjEwMzA3NDI3MH0.jmXCijjRJU3I6xtylc4mlFEWlGFhtyeUIiYT799zeQc")

CATMAP = {
    "MADFIVE": "mm_tour", "MAD MONKEY OWNED TOURS": "mm_tour",
    "EVENTS": "nightly_event", "MAD MONKEY NIGHTLY EVENTS": "nightly_event",
    "OTHER TOURS": "third_party_tour", "OTHER 3RD PARTY TOURS": "third_party_tour",
    "ONE TIME EVENTS": "one_time_event", "ONE TIME EVENTS / GLOBAL EVENTS": "one_time_event",
    "COOKING CLASS": "third_party_tour", "FOOD AND BEVERAGE SPECIALS": "nightly_event",
}
SECTION_ORDER = ["mm_tour", "third_party_tour", "nightly_event", "one_time_event"]
FULL_DATE = re.compile(r"\d{4}-\d{2}-\d{2}|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*(?:,|&|and)\s*\d{1,2})*\s*,?\s*\d{4}", re.I)
LEGEND = {"FF00FFFF": "signature", "FFFFFF00": "pending_update", "FFFF9900": "paused", "FFFF0000": "remove"}
SUMMARY_TABS = {"ONE TIME EVENT LISTING SUMMARY", "SIGNATURE AND HGL SUMMARY"}
DAYS = {"monday": 1, "tuesday": 2, "wednesday": 3, "thursday": 4, "friday": 5, "saturday": 6, "sunday": 7,
        "mon": 1, "tue": 2, "tues": 2, "wed": 3, "thu": 4, "thur": 4, "thurs": 4, "fri": 5, "sat": 6, "sun": 7}
MONTHS = {m.lower(): i for i, m in enumerate(["January","February","March","April","May","June","July","August","September","October","November","December"], 1)}
MONTHS.update({k[:3]: v for k, v in list(MONTHS.items())})

sq = lambda s: re.sub(r"\s+", " ", (s or "")).strip()
norm = lambda s: re.sub(r"[^a-z0-9]+", " ", sq(s).lower()).strip()

# ── time parsing ─────────────────────────────────────────────────────
MER = r"(a\.?m\.?|p\.?m\.?)"
T12 = re.compile(r"(?<![\d:])(\d{1,2})(?:[:.](\d{2}))?\s*" + MER + r"(?![a-z])", re.I)
T24 = re.compile(r"(?<![\d:.])([01]?\d|2[0-3]):([0-5]\d)(?![\d:]|\s*[ap]\.?m)", re.I)
RANGE = re.compile(r"(\d{1,2})(?:[:.](\d{2}))?\s*" + MER + r"?\s*(?:-|–|—|to|till|until)\s*(\d{1,2})(?:[:.](\d{2}))?\s*" + MER + r"?", re.I)
HOURS = re.compile(r"(\d+(?:[.,]\d+)?)\s*h(?:o+u?rs?|rs?|r)?\b", re.I)
MINS = re.compile(r"(\d+)\s*m(?:in(?:ute)?s?)?\b", re.I)

def hhmm(h, m, mer):
    h = int(h); m = int(m or 0)
    if mer:
        mer = mer.lower().replace(".", "")
        if mer == "pm" and h < 12: h += 12
        if mer == "am" and h == 12: h = 0
    if h > 23 or m > 59: return None
    return f"{h:02d}:{m:02d}"

def times_in(text):
    """Times with an explicit AM/PM, in order of appearance; 24h HH:MM only when no AM/PM times exist."""
    out = []
    for h, m, mer in T12.findall(text or ""):
        t = hhmm(h, m, mer)
        if t: out.append(t)
    if out: return out
    return [hhmm(h, m, None) for h, m in T24.findall(text or "") if hhmm(h, m, None)]

def time_range(text):
    m = RANGE.search(text or "")
    if not m: return None
    h1, m1, mer1, h2, m2, mer2 = m.groups()
    if not mer1 and mer2:   # "8:30-11:00 PM" -> both PM unless that puts start after finish ("11-2 PM")
        mer1 = mer2 if int(h1) <= int(h2) or int(h1) == 12 else ("am" if mer2.lower().startswith("p") else "pm")
    if mer1 and not mer2: mer2 = mer1 if int(h2) >= int(h1) else ("pm" if mer1.lower().startswith("a") else "am")
    a, b = hhmm(h1, m1, mer1), hhmm(h2, m2, mer2)
    return (a, b) if a and b and a != b else None

def duration_of(text):
    t = text or ""
    h = HOURS.search(t); mi = MINS.search(t)
    mins = 0
    if h: mins += round(float(h.group(1).replace(",", ".")) * 60)
    if mi and not h: mins += int(mi.group(1))
    return mins or None

def add_minutes(t, mins):
    h, m = map(int, t.split(":")); total = (h * 60 + m + mins) % 1440
    return f"{total // 60:02d}:{total % 60:02d}"

def span_minutes(a, b):
    ha, ma = map(int, a.split(":")); hb, mb = map(int, b.split(":"))
    d = (hb * 60 + mb) - (ha * 60 + ma)
    return d + 1440 if d <= 0 else d

def propose_times(itinerary, daytime, current):
    """Returns (start, end, duration, source, source_text, note) or None."""
    dur = duration_of(daytime)
    it = times_in(itinerary)
    rng = time_range(daytime)
    dt_times = times_in(daytime)
    note = []
    if len(it) >= 2 and it[0] != it[-1]:
        start, end, src, src_text = it[0], it[-1], "itinerary", itinerary
        if rng and rng != (start, end): note.append(f"Day/time column says {fmt12(rng[0])} to {fmt12(rng[1])}")
    elif len(it) == 1:
        start, src, src_text = it[0], "itinerary", itinerary
        end = add_minutes(start, dur) if dur else (rng[1] if rng and rng[0] == start else None)
        if not end: note.append("Only one time in the itinerary and no duration to work out the finish")
    elif rng:
        start, end, src, src_text = rng[0], rng[1], "day_time_column", daytime
    elif dt_times and dur:
        start, end, src, src_text = dt_times[0], add_minutes(dt_times[0], dur), "duration", daytime
    elif dt_times:
        start, end, src, src_text = dt_times[0], None, "day_time_column", daytime
        note.append("No finish time anywhere and no duration")
    else:
        return None
    duration = dur or (span_minutes(start, end) if start and end else None)
    return start, end, duration, src, sq(src_text)[:600], "; ".join(note) or None

def fmt12(t):
    h, m = map(int, t.split(":")); ap = "AM" if h < 12 else "PM"; h12 = h % 12 or 12
    return f"{h12}:{m:02d} {ap}"

# ── other field parsing (mirrors the first import) ───────────────────
def days_of_week(text, category):
    if category == "one_time_event": return []
    t = (text or "").lower()
    if re.search(r"every\s*day|everyday|daily|all days|7 days", t): return [1, 2, 3, 4, 5, 6, 7]
    if "weekend" in t: return [6, 7]
    found = sorted({DAYS[w] for w in re.findall(r"\b(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b", t)})
    return found

def event_dates(text):
    """(first, last) dates mentioned, or (None, None)."""
    t = text or ""
    m = re.search(r"([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?((?:\s*(?:,|&|and)\s*\d{1,2}(?:st|nd|rd|th)?)+)\s*,?\s*(\d{4})?", t)
    if m and m[1].lower() in MONTHS:
        days = [int(m[2])] + [int(x) for x in re.findall(r"\d{1,2}", m[3])]
        y = int(m[4]) if m[4] else 2026
        try: return dt.date(y, MONTHS[m[1].lower()], min(days)), dt.date(y, MONTHS[m[1].lower()], max(days))
        except ValueError: pass
    d = event_date(t)
    return d, d

def event_date(text):
    t = text or ""
    m = re.match(r"\s*(\d{4})-(\d{2})-(\d{2})", t)
    if m: return dt.date(int(m[1]), int(m[2]), int(m[3]))
    m = re.search(r"([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?(?:\s*,?\s*(\d{4}))?", t)
    if m and m[1].lower() in MONTHS:
        y = int(m[3]) if m[3] else 2026
        try: return dt.date(y, MONTHS[m[1].lower()], int(m[2]))
        except ValueError: return None
    m = re.search(r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?(?:\s+(\d{4}))?", t)
    if m and m[2].lower() in MONTHS:
        y = int(m[3]) if m[3] else 2026
        try: return dt.date(y, MONTHS[m[2].lower()], int(m[1]))
        except ValueError: return None
    return None

def parse_rate(text, currency):
    """-> (rate_usd, local_amount, exception_reason)"""
    t = sq(text)
    if not t: return None, None, "blank rate"
    if re.fullmatch(r"free!?", t, re.I): return 0, None, None
    usd = re.search(r"(?:\$|usd)\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:\$|usd)", t, re.I)
    loc = re.search(r"(\d[\d,. ]*\d|\d)\s*(thb|php|vnd|idr|rp|₱|฿|baht|peso|dong|rupiah)", t, re.I)
    local = None
    if loc:
        raw = loc.group(1).replace(" ", "")
        raw = raw.replace(".", "").replace(",", "") if re.search(r"[.,]\d{3}\b", raw) else raw.replace(",", "")
        try: local = float(raw)
        except ValueError: local = None
    if usd:
        return float((usd.group(1) or usd.group(2)).replace(",", "")), local, None
    if re.fullmatch(r"\d+(?:\.\d+)?", t):
        n = float(t)
        if currency == "USD" or n < 300: return n, None, None
        return None, n, f"number without currency ({t}) at a {currency} hostel"
    return None, local, "rate written as words"

def split_desc(text):
    t = (text or "").strip()
    if not t: return None, None
    parts = [p.strip() for p in re.split(r"\n\s*\n", t) if p.strip()]
    brief = parts[0].replace("\n", " ")
    rest = "\n\n".join(parts[1:])
    if len(brief) > 95:
        rest = (brief + ("\n\n" + rest if rest else "")).strip()
        brief = brief[:92].rsplit(" ", 1)[0] + "…"
    return brief, rest or None

NTK_LABELS = [("meeting_point", r"meet at place at time\s*:?"), ("inclusions", r"inclusions?\s*:?"), ("exclusions", r"exclusions?\s*:?"),
              ("things_to_bring", r"things to bring\s*:?"), ("cancellation_policy", r"cancell?ation policy\s*:?")]
def split_ntk(text):
    out = {}
    t = text or ""
    pat = re.compile("|".join(f"(?P<{k}>{p})" for k, p in NTK_LABELS), re.I)
    marks = [(m.start(), m.end(), m.lastgroup) for m in pat.finditer(t)]
    if not marks:
        return {"meeting_point": t.strip() or None}
    for i, (s, e, k) in enumerate(marks):
        seg = t[e:(marks[i + 1][0] if i + 1 < len(marks) else len(t))].strip(" :\n-")
        if seg: out[k] = seg
    return out

def parse_minmax(text):
    t = (text or "").lower()
    mn = re.search(r"min(?:imum)?\s*:?\s*(\d+)", t); mx = re.search(r"max(?:imum)?\s*:?\s*(\d+)", t)
    if mn or mx: return (int(mn[1]) if mn else None), (int(mx[1]) if mx else None)
    if re.fullmatch(r"\s*\d+(?:\.0+)?\s*", t): return None, int(float(t))
    return None, None

# ── extraction (v3: TITLE and TYPE headers both recognised) ──────────
def fillrgb(c):
    try:
        v = c.fill.start_color.rgb if c.fill and c.fill.patternType else None
        return v if isinstance(v, str) else None
    except Exception: return None

def g_(ws, r, c):
    v = ws.cell(r, c).value
    return sq(str(v)) if v is not None else ""

def extract(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    rows = []
    for ws in wb.worksheets:
        name = ws.title
        if ws.sheet_state != "visible": continue
        if "OLD" in name.upper() or sq(name).upper() in SUMMARY_TABS: continue
        cat = None; schema = "tour"; rows_in_section = 0
        for r in range(1, ws.max_row + 1):
            a = ws.cell(r, 1).value
            A = sq(str(a)) if a is not None else ""
            U = A.upper()
            if not A: continue
            if U in CATMAP: cat = CATMAP[U]; schema = "tour"; rows_in_section = 0; continue
            if "TRANSPORTATION" in U and not g_(ws, r, 7): cat = "transport"; schema = "transport"; rows_in_section = 0; continue
            if U == "TITLE":
                if schema == "tour" and rows_in_section > 0 and cat in SECTION_ORDER and cat != SECTION_ORDER[-1]:
                    cat = SECTION_ORDER[SECTION_ORDER.index(cat) + 1]   # header without a banner: the next section
                schema = "tour"; rows_in_section = 0; continue
            if U == "TYPE": schema = "transport"; cat = "transport"; rows_in_section = 0; continue
            if cat is None: continue
            if U.startswith("MAD MONKEY EXPERIENCE") or len(A) < 3: continue
            rows_in_section += 1
            g = lambda c: sq(str(ws.cell(r, c).value)) if ws.cell(r, c).value is not None else ""
            raw = lambda c: str(ws.cell(r, c).value).strip() if ws.cell(r, c).value is not None else ""
            if schema == "transport":
                route = g(3)
                rows.append(dict(sheet=sq(name), row=r, category="transport", title=f"{A}: {route}" if route else A,
                                 vehicle=A, route=route, active=g(5), provider=g(6), rate=raw(7), minmax=raw(8), daytime=raw(9),
                                 duration=raw(10), pickup=raw(11), dropoff=raw(12), brief=raw(13), long=raw(15), remarks=raw(17),
                                 fill=fillrgb(ws.cell(r, 1)) or ""))
            else:
                rcat = cat
                if cat != "one_time_event" and FULL_DATE.search(raw(9) or "") and not re.search(r"\bevery\b", raw(9) or "", re.I): rcat = "one_time_event"
                rows.append(dict(sheet=sq(name), row=r, category=rcat, title=A, operator=g(3), kind=g(4), active=g(5), online=g(6),
                                 rate=raw(7), minmax=raw(8), daytime=raw(9), desc=raw(10), need_to_know=raw(14), insurance=g(22),
                                 photos=raw(23), itinerary=raw(24), status_col=g(31), gsv=raw(32), remarks=raw(33),
                                 fill=fillrgb(ws.cell(r, 1)) or ""))
    return rows

# ── API ──────────────────────────────────────────────────────────────
class Api:
    def __init__(self):
        r = requests.post(f"{URL}/auth/v1/token?grant_type=password", headers={"apikey": ANON},
                          json={"email": os.environ["MM_ADMIN_EMAIL"], "password": os.environ["MM_ADMIN_PASSWORD"]})
        r.raise_for_status(); tok = r.json()["access_token"]; self.uid = r.json()["user"]["id"]
        self.h = {"apikey": ANON, "Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    def get(self, path, params=None):
        out, off = [], 0
        while True:
            r = requests.get(f"{URL}/rest/v1/{path}", headers={**self.h, "Range": f"{off}-{off+999}"}, params=params); r.raise_for_status()
            chunk = r.json(); out += chunk
            if len(chunk) < 1000: return out
            off += 1000
    def post(self, path, body, prefer="return=representation"):
        r = requests.post(f"{URL}/rest/v1/{path}", headers={**self.h, "Prefer": prefer}, json=body)
        if r.status_code >= 300: raise RuntimeError(f"{path}: {r.status_code} {r.text[:300]}")
        return r.json() if r.text else None
    def patch(self, path, params, body):
        r = requests.patch(f"{URL}/rest/v1/{path}", headers=self.h, params=params, json=body)
        if r.status_code >= 300: raise RuntimeError(f"{path}: {r.status_code} {r.text[:300]}")
    def delete(self, path, params):
        r = requests.delete(f"{URL}/rest/v1/{path}", headers=self.h, params=params)
        if r.status_code >= 300: raise RuntimeError(f"{path}: {r.status_code} {r.text[:300]}")

# ── main ─────────────────────────────────────────────────────────────
def main():
    path = sys.argv[1]; apply = "--apply" in sys.argv
    api = Api()
    locs = api.get("locations", {"select": "id,name,currency,is_active"})
    loc_by_name = {norm(l["name"]): l for l in locs}
    def loc_for(sheet):
        k = norm(sheet)
        return loc_by_name.get(k) or next((l for n, l in loc_by_name.items() if n.replace(" ", "") == k.replace(" ", "")), None)

    db = api.get("products", {"select": "id,location_id,category,title,source_sheet,source_row,starts_at,ends_at,duration_minutes,itinerary,availability_raw,status,rate_raw", "source_sheet": "not.is.null"})
    by_key = {(sq(p["source_sheet"]).upper(), p["source_row"]): p for p in db}
    by_title = defaultdict(list)
    for p in db: by_title[(sq(p["source_sheet"]).upper(), norm(p["title"]))].append(p)

    rows = extract(path)
    print(f"extracted {len(rows)} rows from visible tabs: {Counter(r['category'] for r in rows)}")
    matched, shifted, renamed, new, unknown_loc = [], [], [], [], []
    seen = set()
    for r in rows:
        loc = loc_for(r["sheet"])
        if not loc: unknown_loc.append(r); continue
        r["location"] = loc
        key = (r["sheet"].upper(), r["row"])
        cand = by_key.get(key)
        if cand and norm(cand["title"]) == norm(r["title"]):
            matched.append((r, cand)); seen.add(cand["id"]); continue
        tl = [p for p in by_title.get((r["sheet"].upper(), norm(r["title"])), []) if p["id"] not in seen and p["category"] == r["category"]] \
             or [p for p in by_title.get((r["sheet"].upper(), norm(r["title"])), []) if p["id"] not in seen]
        if tl:
            best = min(tl, key=lambda p: abs((p["source_row"] or 0) - r["row"]))
            shifted.append((r, best)); seen.add(best["id"]); continue
        if cand and cand["id"] not in seen and difflib.SequenceMatcher(None, norm(cand["title"]), norm(r["title"])).ratio() >= (0.6 if cand["category"] == r["category"] else 0.8):
            renamed.append((r, cand)); seen.add(cand["id"]); continue
        new.append(r)
    # second pass over what is left: renamed titles, and transport the first import filed under the vehicle name only
    fixups = []
    still_new = []
    for r in new:
        pool = [p for p in db if p["id"] not in seen and sq(p["source_sheet"]).upper() == r["sheet"].upper()]
        best, score = None, 0
        for p in pool:
            sc = difflib.SequenceMatcher(None, norm(p["title"]), norm(r["title"])).ratio()
            near = p["source_row"] is None or p["source_row"] >= 500000 or abs(p["source_row"] - r["row"]) <= 6
            if "vehicle" in r and near and norm(p["title"]) in (norm(r["vehicle"]), norm(r.get("route") or "")):
                sc = 0.99 + (0.005 if sq(p.get("rate_raw") or "") == sq(r.get("rate") or "") else 0)
            if sc > score: best, score = p, sc
        if best and score >= 0.85:
            seen.add(best["id"]); renamed.append((r, best))
            if "vehicle" in r and best["category"] != "transport":
                fixups.append((best, dict(title=r["title"][:200], category="transport", source_row=r["row"]), r))
            continue
        still_new.append(r)
    new = still_new
    gone = [p for p in db if p["id"] not in seen]
    mismatched = [(r, p) for r, p in matched + shifted + renamed if r["category"] != p["category"] and not any(f[0]["id"] == p["id"] for f in fixups)]
    print(f"  category differs from the sheet section: {len(mismatched)} (logged as exceptions) · transport rows to re-file: {len(fixups)}")
    print(f"matched in place {len(matched)} · row moved {len(shifted)} · renamed {len(renamed)} · NEW {len(new)} · in DB but not on the sheet {len(gone)} · unknown tab {len(unknown_loc)}")
    print("  new by category:", Counter(r["category"] for r in new))
    print("  new by sheet:", Counter(r["sheet"] for r in new))

    # ── time proposals for matched non-transport products ──
    proposals = []
    for r, p in matched + shifted + renamed:
        if r["category"] == "transport": continue
        pr = propose_times(r.get("itinerary"), r.get("daytime"), p)
        if not pr: continue
        start, end, dur, src, src_text, note = pr
        cur_s = (p["starts_at"] or "")[:5] or None; cur_e = (p["ends_at"] or "")[:5] or None
        if start == cur_s and (end == cur_e or end is None): continue
        proposals.append(dict(product_id=p["id"], location_id=p["location_id"], current_starts_at=cur_s, current_ends_at=cur_e,
                              current_duration_minutes=p["duration_minutes"], proposed_starts_at=start, proposed_ends_at=end,
                              proposed_duration_minutes=dur, source=src, source_text=src_text, note=note, _title=p["title"], _sheet=r["sheet"]))
    print(f"time proposals: {len(proposals)} · by source {Counter(x['source'] for x in proposals)} · with a finish {sum(1 for x in proposals if x['proposed_ends_at'])}")

    # ── new products ──
    new_rows, exceptions, extras = [], [], []
    for r in new:
        loc = r["location"]; ccy = loc["currency"]
        active_txt = r["active"].lower(); colour = LEGEND.get(r["fill"], "")
        status = "active"; active = True; remarks = r.get("remarks") or None
        if "paused" in active_txt or colour == "paused": status, active = "paused", False
        if "remove" in active_txt or colour == "remove": status, active = "paused", False; remarks = ("Sheet says Remove. " + (remarks or "")).strip()
        if colour == "signature" and active: status = "signature"
        if colour == "pending_update" and active: status = "pending_update"
        rate_usd, local, why = parse_rate(r["rate"], ccy)
        base = dict(location_id=loc["id"], category=r["category"], title=r["title"][:200], source_sheet=r["sheet"], source_row=r["row"],
                    status=status, active_on_ground=active, rate_usd=rate_usd, rate_raw=r["rate"] or None,
                    local_amount=local, local_currency=ccy, remarks=remarks, availability_raw=r["daytime"] or None)
        extra = dict(transport=None, date=None)
        if "vehicle" in r:
            base.update(dict(days_of_week=days_of_week(r["daytime"], "transport"), brief_description=(r["brief"][:95] or None),
                             long_description=r["long"] or None, duration_minutes=duration_of(r["duration"]), capacity_raw=r["minmax"] or None,
                             bookable_on_website=False))
            times = times_in(r["daytime"]); base["starts_at"] = times[0] if times else None
            extra["transport"] = dict(vehicle_type=r["vehicle"] or None, route_raw=r["route"] or None, pickup_point=r["pickup"] or None,
                                      dropoff_point=r["dropoff"] or None, departure_times=times)
        else:
            brief, long_ = split_desc(r["desc"]); ntk = split_ntk(r["need_to_know"]); mn, mx = parse_minmax(r["minmax"])
            pr = propose_times(r["itinerary"], r["daytime"], None)
            start, end, dur = (pr[0], pr[1], pr[2]) if pr else (None, None, duration_of(r["daytime"]))
            base.update(dict(days_of_week=days_of_week(r["daytime"], r["category"]), starts_at=start, ends_at=end, duration_minutes=dur,
                             brief_description=brief, long_description=long_, min_guests=mn, max_guests_per_day=mx, capacity_raw=r["minmax"] or None,
                             bookable_on_website=r["online"].lower() in ("true", "yes"), travel_insurance_required=r["insurance"].lower() == "yes",
                             photo_album_url=r["photos"] if r["photos"].lower().startswith("http") else None,
                             itinerary=r["itinerary"] or None, gross_service_value=r["gsv"] or None, **ntk))
            if r["category"] == "one_time_event":
                d, last = event_dates(r["daytime"])
                if d: base["expires_on"] = (last or d).isoformat(); extra["date"] = d.isoformat()
                else: exceptions.append((r, "one_time_event_date", "couldn't read the event date", r["daytime"]))
            if not base["days_of_week"] and r["category"] != "one_time_event":
                exceptions.append((r, "days_of_week", "couldn't read which days it runs", r["daytime"]))
        if why: exceptions.append((r, "rate", why, r["rate"]))
        new_rows.append(base); extras.append(extra)
    gone_ex = [(p, "missing_from_sheet", "Not on the flow chart any more. Pause it here, or add it back to the sheet.", f"was row {p['source_row']} of {sq(p['source_sheet'])}") for p in gone]
    ren_ex = [(p, "title", f"The flow chart now calls this \"{r['title'][:120]}\". Rename it on the product page if that is right.", r["title"][:200]) for r, p in renamed if norm(r["title"]) != norm(p["title"]) and "vehicle" not in r]
    cat_ex = [(p, "category", f"Flow chart section says {r['category']}, database says {p['category']}. Change it on the product page if the sheet is right.", None) for r, p in mismatched]
    print(f"new products to insert: {len(new_rows)} · exceptions {len(exceptions)} (+{len(gone_ex)} missing-from-sheet, +{len(cat_ex)} category, +{len(ren_ex)} renamed)")
    for r in new[:60]: print(f"   + {r['sheet']:15} r{r['row']:<4} {r['category']:16} {r['title'][:60]}")
    if gone: print("in DB but no longer on the sheet (left untouched):"); [print(f"   - {sq(p['source_sheet']):15} r{str(p['source_row']):<6} {p['category']:16} {p['title'][:60]}") for p in gone[:40]]
    if renamed: print("renamed on the sheet (row kept, title NOT changed):"); [print(f"   ~ {r['sheet']:15} r{r['row']:<4} '{p['title'][:40]}' -> '{r['title'][:40]}'") for r, p in renamed[:20]]
    print("sample proposals:")
    for x in proposals[:12]: print(f"   {x['_sheet']:14} {x['_title'][:38]:38} {x['current_starts_at'] or '--:--'}-{x['current_ends_at'] or '--:--'} -> {x['proposed_starts_at']}-{x['proposed_ends_at'] or '--:--'} [{x['source']}] {x['note'] or ''}")

    movers = [(p["id"], r["row"], r["sheet"]) for r, p in shifted + renamed if p["source_row"] != r["row"]] + [(p["id"], patch["source_row"], r["sheet"]) for p, patch, r in fixups if p["source_row"] != patch["source_row"]]
    mover_ids = {m[0] for m in movers}
    occupied = {(sq(p["source_sheet"]).upper(), p["source_row"]): p for p in db if p["id"] not in mover_ids}
    clashes = [(pid, row, sheet, occupied[(sheet.upper(), row)]) for pid, row, sheet in movers if (sheet.upper(), row) in occupied]
    print(f"row renumbering: {len(movers)} movers · {len(clashes)} would land on a row another product still holds")
    for pid, row, sheet, o in clashes[:20]: print(f"   clash {sheet:15} r{row:<4} held by '{o['title'][:40]}' ({o['category']}, matched in place?) · mover {pid[:8]}")
    out = dict(movers=[dict(id=pid, row=row, sheet=sheet) for pid, row, sheet in movers],
               new=[{k: v for k, v in x.items() if not k.startswith('_')} for x in new_rows], proposals=[{k: v for k, v in x.items() if not k.startswith('_')} for x in proposals], gone=[p['id'] for p in gone])
    json.dump(out, open(os.path.join(os.path.dirname(__file__), "data", "repull_preview.json"), "w"), indent=1, default=str)
    if not apply: print("\nDRY RUN — nothing written. Re-run with --apply."); return

    # ── apply ──
    api.delete("import_runs", {"source": "eq.flowchart_xlsx_repull", "finished_at": "is.null"})   # leftovers from an interrupted attempt
    run = api.post("import_runs", dict(source="flowchart_xlsx_repull", notes=f"Re-pull {os.path.basename(path)}: times from ITINERARY column queued for approval; new experiences since 23 Aug added"))[0]
    # rows moved on the sheet: (source_sheet, source_row) is unique, so park every mover out of the way first
    if "--skip-renumber" not in sys.argv:
        for p in gone:   # no longer on the sheet: give up the row number so a mover can take it
            if p["source_row"] is not None: api.patch("products", {"id": f"eq.{p['id']}"}, {"source_row": None})
        for i, (pid, _, _) in enumerate(movers):
            api.patch("products", {"id": f"eq.{pid}"}, {"source_row": 500000 + i})   # unique parking spot per mover
        for pid, row, _ in movers:
            api.patch("products", {"id": f"eq.{pid}"}, {"source_row": row})
    for p, patch, r in fixups:
        api.patch("products", {"id": f"eq.{p['id']}"}, {k: v for k, v in patch.items() if k != "source_row"})
        td = dict(product_id=p["id"], vehicle_type=r["vehicle"] or None, route_raw=r["route"] or None, pickup_point=r["pickup"] or None, dropoff_point=r["dropoff"] or None, departure_times=times_in(r["daytime"]))
        requests.post(f"{URL}/rest/v1/transport_details", headers={**api.h, "Prefer": "resolution=merge-duplicates,return=minimal"}, json=td)
    for p, field, reason, raw in gone_ex + cat_ex + ren_ex:
        api.post("import_exceptions", dict(run_id=run["id"], location_id=p["location_id"], product_id=p["id"], source_sheet=p["source_sheet"], source_row=p["source_row"],
                                            field=field, reason=reason, raw_value=raw), prefer="return=minimal")
    inserted = 0
    for i, row in enumerate(new_rows):
        try:
            created = api.post("products", row)[0]
        except RuntimeError as e:
            print("  insert failed:", row["title"][:50], e); continue
        inserted += 1
        ex = extras[i]
        if ex["transport"]:
            api.post("transport_details", {**ex["transport"], "product_id": created["id"]}, prefer="return=minimal")
        elif ex["date"]:
            api.post("product_date_rules", dict(product_id=created["id"], kind="available", starts_on=ex["date"], note="one-time event date from flow chart (re-pull)"), prefer="return=minimal")
        row["_id"] = created["id"]
    for r, field, reason, raw in exceptions:
        pid = next((x.get("_id") for x in new_rows if x["source_sheet"] == r["sheet"] and x["source_row"] == r["row"]), None)
        api.post("import_exceptions", dict(run_id=run["id"], location_id=r["location"]["id"], product_id=pid, source_sheet=r["sheet"], source_row=r["row"],
                                            field=field, reason=reason, raw_value=(raw or "")[:500]), prefer="return=minimal")
    for i in range(0, len(proposals), 200):
        api.post("product_time_proposals", [{**{k: v for k, v in x.items() if not k.startswith('_')}, "run_id": run["id"]} for x in proposals[i:i+200]], prefer="return=minimal")
    api.patch("import_runs", {"id": f"eq.{run['id']}"}, dict(finished_at=dt.datetime.utcnow().isoformat() + "Z", products_imported=inserted, exceptions_count=len(exceptions)))
    api.patch("import_runs", {"id": f"eq.{run['id']}"}, dict(exceptions_count=len(exceptions) + len(gone_ex) + len(cat_ex) + len(ren_ex)))
    print(f"APPLIED: run {run['id']} · {inserted} new products · {len(proposals)} time proposals queued · {len(exceptions) + len(gone_ex) + len(cat_ex)} exceptions · {len(shifted)} row numbers updated · {len(fixups)} transport rows re-filed")

if __name__ == "__main__":
    main()
