#!/usr/bin/env python3
"""
Final flow-chart sync (Oct 2026): one last read of the MAD MONKEY EXPERIENCE FLOW CHART before it is deleted.

Compares the live workbook with the tool and queues every difference for head office to approve in /approvals:
  * a changed field on an existing experience     -> sheet_sync_proposals, kind 'field'
  * on the sheet but not in the tool               -> kind 'new'      (approve = add it)
  * in the tool but no longer on the sheet         -> kind 'missing'  (approve = pause it, nothing is deleted)
  * start / finish times                           -> product_time_proposals (the editable times queue; the older
                                                      pending ones are marked superseded and re-proposed fresh)
Nothing on a product changes until someone approves it.

Which differences get queued. A field is queued only when its sheet cell has CHANGED since the copy the tool was
built from (the 21 Aug workbook for the first import, the 9 Sep workbook for experiences added then). When the
cell is the same as then, the tool's value stands: it is what the import read, or what head office fixed by hand.
Two exceptions, compared straight against the tool:
  * transport on the 21 tabs whose columns sit one to the right of Phnom Penh's: the first import read schedule,
    duration, capacity, pickup, drop-off and descriptions one column off ('import_fix');
  * experiences with no earlier copy to compare against ('no_baseline').

Usage:
  python3 tools/sheet_sync.py LIVE.xlsx                 # dry run: report + tools/data/sheet_sync_preview.json
  python3 tools/sheet_sync.py LIVE.xlsx --apply         # queue everything and archive the workbook in storage
Options: --aug FILE (21 Aug workbook), --sep FILE (9 Sep workbook), --no-archive (test runs)
Env: MM_ADMIN_EMAIL, MM_ADMIN_PASSWORD
"""
import sys, os, json, datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import requests
import import_flowchart as F
from import_flowchart import sq, norm

DL = os.path.expanduser("~/Downloads")
AUG_DEFAULT = os.path.join(DL, "MAD MONKEY EXPERIENCE FLOW CHART  2026.xlsx")
SEP_DEFAULT = os.path.join(DL, "MAD MONKEY EXPERIENCE FLOW CHART  2026 (1).xlsx")
SEP_IMPORT_DAY = "2026-09-09"
TODAY = dt.date.today()
SYM = {"USD": "$", "THB": "฿", "PHP": "₱", "VND": "₫", "IDR": "Rp", "KHR": "៛", "LAK": "₭"}
DAYN = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
CAT_LABEL = {"mm_tour": "Mad Monkey tour", "nightly_event": "Nightly event", "third_party_tour": "Third-party tour",
             "one_time_event": "One-time event", "transport": "Transport"}
STATUS_LABEL = {"active": "Active", "paused": "Paused", "signature": "Signature", "pending_update": "Pending update"}
TRANSPORT_FIX_GROUPS = {"days", "capacity", "description", "duration", "points"}   # read one column off on 21 tabs

# ── formatting ───────────────────────────────────────────────────────
def money(n, ccy):
    if n is None: return "no price"
    return f"{SYM.get(ccy, ccy + ' ')}{n:,.2f}" if ccy == "USD" else f"{SYM.get(ccy, ccy + ' ')}{n:,.0f}"
def days_txt(d): return "no days" if not d else "every day" if len(d) == 7 else " ".join(DAYN[x] for x in sorted(d))
def short(t, n=90):
    t = sq(t or "")
    return t if len(t) <= n else t[:n - 1].rsplit(" ", 1)[0] + "…"
def date_txt(d):
    if not d: return "none"
    x = dt.date.fromisoformat(str(d)[:10]); return f"{x.day} {x.strftime('%b %Y')}"
def mins_txt(m): return "none" if not m else f"{m // 60}h" if m % 60 == 0 else f"{m // 60}h {m % 60}m" if m > 60 else f"{m}m"

# ── field groups: (key, label, applies(category), raw cells, parse) ──
def status_of(r):
    t = (r.get("active") or "").lower(); colour = F.LEGEND.get(r.get("fill") or "", "")
    status, active = "active", True
    if "paused" in t or colour == "paused": status, active = "paused", False
    if "remove" in t or colour == "remove": status, active = "paused", False
    if colour == "signature" and active: status = "signature"
    if colour == "pending_update" and active: status = "pending_update"
    return {"status": status, "active_on_ground": active}

def g_rate(r, loc, fx):
    usd, local, why = F.parse_rate(r["rate"], loc["currency"])
    if usd is None and local is not None and fx: usd = round(local / fx, 2)
    if usd is None: return None, why or "couldn't read the price"
    if local is None and loc["currency"] != "USD" and fx: local = round(usd * fx, 2)
    return {"rate_usd": usd, "local_amount": local, "local_currency": loc["currency"], "rate_raw": r["rate"] or None,
            "fx_rate_used": fx if loc["currency"] != "USD" else 1}, None
def g_days(r, loc, fx):
    d = F.days_of_week(r["daytime"], r["category"])
    if not d: return None, "couldn't read which days it runs"
    return {"days_of_week": d, "availability_raw": r["daytime"] or None}, None
def g_expiry(r, loc, fx):
    first, last = F.event_dates(r["daytime"])
    if not first: return None, "couldn't read the event date"
    return {"expires_on": (last or first).isoformat()}, None
def g_capacity(r, loc, fx):
    if "vehicle" in r: return {"capacity_raw": r["minmax"] or None}, None
    mn, mx = F.parse_minmax(r["minmax"])
    if mn is None and mx is None and sq(r["minmax"]): return None, "couldn't read the guest numbers"
    return {"min_guests": mn, "max_guests_per_day": mx, "capacity_raw": r["minmax"] or None}, None
def g_description(r, loc, fx):
    if "vehicle" in r:
        return {"brief_description": short(r["brief"], 95) or None, "long_description": r["long"] or None}, None
    b, l = F.split_desc(r["desc"])
    return {"brief_description": b, "long_description": l}, None
NTK_KEYS = ["meeting_point", "inclusions", "exclusions", "things_to_bring", "cancellation_policy"]
def g_ntk(r, loc, fx):
    n = F.split_ntk(r["need_to_know"]); return {k: n.get(k) or None for k in NTK_KEYS}, None
def g_online(r, loc, fx): return {"bookable_on_website": r["online"].lower() in ("true", "yes")}, None
def g_status(r, loc, fx): return status_of(r), None
def g_insurance(r, loc, fx): return {"travel_insurance_required": r["insurance"].lower() == "yes"}, None
def g_photos(r, loc, fx): return {"photo_album_url": r["photos"] if r["photos"].lower().startswith("http") else None}, None
def g_itinerary(r, loc, fx): return {"itinerary": r["itinerary"] or None}, None
def g_duration(r, loc, fx):
    m = F.duration_of(r["duration"])
    if not m: return None, "couldn't read the duration"
    return {"duration_minutes": m}, None
def g_points(r, loc, fx):
    return {"transport_details": {"pickup_point": r["pickup"] or None, "dropoff_point": r["dropoff"] or None,
                                  "departure_times": F.times_in(r["daytime"])}}, None

TOUR = lambda c: c != "transport"
TX_ONLY = {"duration", "points"}
TOUR_ONLY = {"need_to_know", "online", "insurance", "photos", "itinerary"}
GROUPS = [
    # key, label, applies, raw cells (what the sheet said), parse, keys that decide whether it differs
    ("rate", "Price", lambda c: True, lambda r: (r["rate"],), g_rate, ["rate_usd"]),
    ("days", "Days", lambda c: c != "one_time_event", lambda r: (r["daytime"],), g_days, ["days_of_week"]),
    ("expiry", "Event date", lambda c: c == "one_time_event", lambda r: (r["daytime"],), g_expiry, ["expires_on"]),
    ("capacity", "Guest numbers", lambda c: True, lambda r: (r["minmax"],), g_capacity, None),
    ("description", "Description", lambda c: True, lambda r: (r["brief"], r["long"]) if "vehicle" in r else (r["desc"],), g_description, None),
    ("need_to_know", "Need to know", TOUR, lambda r: (r["need_to_know"],), g_ntk, None),
    ("online", "On the website", TOUR, lambda r: (r["online"].lower(),), g_online, None),
    ("status", "Status", lambda c: True, lambda r: (r["active"].lower(), r["fill"]), g_status, None),
    ("insurance", "Travel insurance", TOUR, lambda r: (r["insurance"].lower(),), g_insurance, None),
    ("photos", "Photo album", TOUR, lambda r: (r["photos"],), g_photos, None),
    ("itinerary", "Itinerary text", TOUR, lambda r: (r["itinerary"],), g_itinerary, None),
    ("duration", "Duration", lambda c: c == "transport", lambda r: (r["duration"],), g_duration, None),
    ("points", "Pickup, drop-off, departures", lambda c: c == "transport", lambda r: (r["pickup"], r["dropoff"], r["daytime"]), g_points, None),
]

def same(a, b):
    """Loose equality for comparing a parsed sheet value with the tool's value."""
    if isinstance(a, dict) or isinstance(b, dict):
        a, b = a or {}, b or {}
        return all(same(a.get(k), b.get(k)) for k in set(a) | set(b))
    if a in ("", None) and b in ("", None): return True
    if isinstance(a, list) or isinstance(b, list): return sorted(a or []) == sorted(b or [])
    if isinstance(a, bool) or isinstance(b, bool): return bool(a) == bool(b)
    try: return abs(float(a) - float(b)) < 0.005
    except (TypeError, ValueError): pass
    return sq(str(a)) == sq(str(b))

def describe(key, vals, ccy):
    if vals is None: return ""
    if key == "rate":
        usd, loc = vals.get("rate_usd"), vals.get("local_amount")
        return money(usd, "USD") + (f" ({money(loc, ccy)})" if ccy != "USD" and loc is not None else "")
    if key == "days": return days_txt(vals.get("days_of_week"))
    if key == "expiry": return date_txt(vals.get("expires_on"))
    if key == "capacity":
        if "min_guests" not in vals: return short(vals.get("capacity_raw"), 60) or "none"
        mn, mx = vals.get("min_guests"), vals.get("max_guests_per_day")
        return " · ".join(x for x in [f"min {mn}" if mn else "", f"max {mx}" if mx else ""] if x) or "none"
    if key == "description": return short(vals.get("brief_description"), 95) or "none"
    if key == "need_to_know":
        parts = [f"{k.replace('_', ' ').capitalize()}: {short(v, 50)}" for k, v in vals.items() if v]
        return "; ".join(parts) or "none"
    if key == "online": return "Listed" if vals.get("bookable_on_website") else "Not listed"
    if key == "status": return STATUS_LABEL.get(vals.get("status"), vals.get("status") or "")
    if key == "insurance": return "Required" if vals.get("travel_insurance_required") else "Not required"
    if key == "photos": return vals.get("photo_album_url") or "none"
    if key == "itinerary": return short(vals.get("itinerary"), 90) or "none"
    if key == "duration": return mins_txt(vals.get("duration_minutes"))
    if key == "points":
        t = vals.get("transport_details") or {}
        bits = [f"Pickup: {short(t.get('pickup_point'), 40)}" if t.get("pickup_point") else "",
                f"Drop-off: {short(t.get('dropoff_point'), 40)}" if t.get("dropoff_point") else "",
                f"Departs {', '.join(F.fmt12(x) for x in t.get('departure_times') or [])}" if t.get("departure_times") else ""]
        return " · ".join(b for b in bits if b) or "none"
    return ""

def sheet_text(key, r):
    lab = {"rate": "RATE", "days": "DAY, TIME & DURATION", "expiry": "DAY, TIME & DURATION", "capacity": "MIN QTY OF GUEST",
           "need_to_know": "NEED TO KNOW", "online": "BOOKABLE ONLINE", "insurance": "TRAVEL INSURANCE", "photos": "LINK TO PHOTOS",
           "itinerary": "ITINERARY", "duration": "DURATION"}
    if key == "description":
        return f"SHORT DESCRIPTION:\n{r['brief']}\n\nLONG DESCRIPTION:\n{r['long']}" if "vehicle" in r else f"BRIEF DESCRIPTION:\n{r['desc']}"
    if key == "status":
        return f"ACTIVE ON THE GROUND: {r['active'] or '(blank)'}\nRow colour: {F.LEGEND.get(r['fill'] or '', 'none')}"
    if key == "points":
        return f"PICK-UP: {r['pickup']}\nDROP-OFF: {r['dropoff']}\nDAY, TIME & DURATION: {r['daytime']}"
    return f"{lab.get(key, key.upper())}:\n{GROUP_RAW[key](r)[0]}"
GROUP_RAW = {g[0]: g[3] for g in GROUPS}
DESCRIBABLE = {g[0] for g in GROUPS}

# ── main ─────────────────────────────────────────────────────────────
def main():
    args = sys.argv[1:]
    if not args or args[0].startswith("--"): print(__doc__); sys.exit(1)
    live_path = args[0]; apply = "--apply" in args
    opt = lambda k, d: args[args.index(k) + 1] if k in args else d
    aug_path, sep_path = opt("--aug", AUG_DEFAULT), opt("--sep", SEP_DEFAULT)

    api = F.Api()
    locs = api.get("locations", {"select": "id,name,currency,is_active"})
    loc_by_name = {norm(l["name"]): l for l in locs}
    loc_by_id = {l["id"]: l for l in locs}
    def loc_for(sheet):
        k = norm(sheet)
        return loc_by_name.get(k) or next((l for n, l in loc_by_name.items() if n.replace(" ", "") == k.replace(" ", "")), None)
    fxr = api.get("fx_rates", {"select": "code,units_per_usd,manual_override"})
    fx_of = {x["code"]: float(x["manual_override"] or x["units_per_usd"]) for x in fxr if (x["manual_override"] or x["units_per_usd"])}
    fx_of["USD"] = 1.0
    cols = ("id,location_id,category,title,source_sheet,source_row,created_at,starts_at,ends_at,duration_minutes,status,active_on_ground,"
            "rate_usd,local_amount,local_currency,fx_rate_used,rate_raw,days_of_week,availability_raw,expires_on,min_guests,max_guests_per_day,capacity_raw,"
            "brief_description,long_description,meeting_point,inclusions,exclusions,things_to_bring,cancellation_policy,"
            "bookable_on_website,travel_insurance_required,photo_album_url,itinerary")
    db = api.get("products", {"select": cols, "source_sheet": "not.is.null"})
    td = {t["product_id"]: t for t in api.get("transport_details", {"select": "product_id,pickup_point,dropoff_point,departure_times"})}

    print(f"reading live workbook {os.path.basename(live_path)}")
    live = F.extract(live_path); live_warn = list(F.HEADER_WARNINGS)
    print(f"  {len(live)} rows · {Counter(r['category'] for r in live)}")
    print(f"reading baselines: {os.path.basename(aug_path)} (21 Aug) and {os.path.basename(sep_path)} (9 Sep)")
    aug = F.extract(aug_path); sep = F.extract(sep_path)
    aug_by_title = defaultdict(list)
    for r in aug: aug_by_title[(r["sheet"].upper(), norm(r["title"]))].append(r)
    sep_by_key = {(r["sheet"].upper(), r["row"]): r for r in sep}
    sep_by_title = defaultdict(list)
    for r in sep: sep_by_title[(r["sheet"].upper(), norm(r["title"]))].append(r)

    def pick(cands, p):
        if not cands: return None
        same_cat = [c for c in cands if c["category"] == p["category"]] or cands
        return min(same_cat, key=lambda c: abs(c["row"] - (p["source_row"] or 0)))
    def baseline_for(p):
        k = (sq(p["source_sheet"]).upper(), norm(p["title"]))
        if (p["created_at"] or "")[:10] == SEP_IMPORT_DAY:
            r = sep_by_key.get((k[0], p["source_row"]))
            return (r if r and norm(r["title"]) == k[1] else pick(sep_by_title.get(k), p)), "9 Sep"
        r = pick(aug_by_title.get(k), p)
        if r: return r, "21 Aug"
        r = sep_by_key.get((k[0], p["source_row"]))
        return (r if r and norm(r["title"]) == k[1] else pick(sep_by_title.get(k), p)), "9 Sep"

    m = F.match_rows(live, db, loc_for)
    print(f"matched {len(m['matched']) + len(m['shifted']) + len(m['renamed'])} · new {len(m['new'])} · gone {len(m['gone'])} · renamed {len(m['renamed'])} · unknown tab {len(m['unknown_loc'])}")
    if m["unknown_loc"]: print("  tabs with no hostel:", Counter(r["sheet"] for r in m["unknown_loc"]))

    proposals, standing, unreadable, no_base = [], Counter(), Counter(), 0
    fixes = {}     # transport the first import read one column off: one proposal per product
    for r, p in m["matched"] + m["shifted"] + m["renamed"]:
        loc = loc_by_id[p["location_id"]]; ccy = loc["currency"]; fx = fx_of.get(ccy)
        base, base_from = baseline_for(p)
        if base is None: no_base += 1
        cur_all = {**p, "transport_details": {k: (td.get(p["id"]) or {}).get(k) for k in ("pickup_point", "dropoff_point", "departure_times")}}
        if cur_all["transport_details"]["departure_times"]:
            cur_all["transport_details"]["departure_times"] = [t[:5] for t in cur_all["transport_details"]["departure_times"]]
        for key, label, applies, rawf, parse, cmp_keys in GROUPS:
            if not applies(p["category"]) or not applies(r["category"]): continue
            if (key in TX_ONLY and "vehicle" not in r) or (key in TOUR_ONLY and "vehicle" in r): continue
            fix = p["category"] == "transport" and r.get("shifted") and key in TRANSPORT_FIX_GROUPS
            raw_now = tuple(sq(x) for x in rawf(r))
            raw_then = tuple(sq(x) for x in rawf(base)) if base and ("vehicle" in base) == ("vehicle" in r) else None
            if not fix and raw_then is not None and raw_now == raw_then:
                vals, _ = parse(r, loc, fx)
                if vals is not None and not same({k: vals[k] for k in (cmp_keys or vals)}, {k: cur_all.get(k) for k in (cmp_keys or vals)}):
                    standing[key] += 1      # sheet unchanged since the tool was built: the tool's value stands
                continue
            basis = "import_fix" if fix else ("sheet_changed" if raw_then is not None else "no_baseline")
            vals, why = parse(r, loc, fx)
            if fix:
                if vals is None:   # the right column can't be read either: at least store the right text
                    if key == "days" and sq(r["daytime"]) != sq(p.get("availability_raw") or ""): vals = {"availability_raw": r["daytime"] or None}
                    else: unreadable[key] += 1; continue
                cur = {k: cur_all.get(k) for k in vals}
                if same(vals, cur): continue
                acc = fixes.setdefault(p["id"], dict(p=p, r=r, loc=loc, current={}, patch={}, now=[], new=[]))
                acc["current"].update(cur); acc["patch"].update(vals)
                acc["now"].append(f"{label}: {describe(key, cur, ccy) if key in DESCRIBABLE else short(cur.get('availability_raw'), 60) or 'none'}")
                acc["new"].append(f"{label}: {describe(key, vals, ccy) if key in DESCRIBABLE and not (key == 'days' and 'days_of_week' not in vals) else short(vals.get('availability_raw'), 60)}")
                continue
            if vals is None:
                if key == "rate" and sq(r["rate"]):      # a price we can't read still gets a row; head office types it in
                    unreadable[key] += 1
                    proposals.append(dict(kind="field", product_id=p["id"], location_id=p["location_id"], field=key, label=label,
                                          current={"rate_usd": p["rate_usd"], "local_amount": p["local_amount"]}, patch=None,
                                          current_text=describe(key, p, ccy), proposed_text="Couldn't read it: type the price",
                                          sheet_text=sheet_text(key, r), previous_sheet_text=sheet_text(key, base) if base else None,
                                          basis=basis, note=why, source_sheet=r["sheet"], source_row=r["row"], _title=p["title"]))
                else: unreadable[key] += 1
                continue
            keys = cmp_keys or list(vals)
            cur = {k: cur_all.get(k) for k in vals}
            if same({k: vals[k] for k in keys}, {k: cur_all.get(k) for k in keys}): continue
            proposals.append(dict(kind="field", product_id=p["id"], location_id=p["location_id"], field=key, label=label,
                                  current=cur, patch=vals, current_text=describe(key, cur, ccy), proposed_text=describe(key, vals, ccy),
                                  sheet_text=sheet_text(key, r), previous_sheet_text=sheet_text(key, base) if base and raw_then is not None and not fix else None,
                                  basis=basis, note=("The first import read this from the wrong column." if fix else None),
                                  source_sheet=r["sheet"], source_row=r["row"], _title=p["title"]))
    for pid, a in fixes.items():
        r = a["r"]
        proposals.append(dict(kind="field", product_id=pid, location_id=a["p"]["location_id"], field="transport_fix",
                              label="Transport details", current=a["current"], patch=a["patch"],
                              current_text="\n".join(a["now"]), proposed_text="\n".join(a["new"]),
                              sheet_text=f"DAY, TIME & DURATION: {r['daytime']}\nDURATION: {r['duration']}\nMIN QTY OF GUEST: {r['minmax']}\n"
                                         f"PICK-UP: {r['pickup']}\nDROP-OFF: {r['dropoff']}\n\nSHORT DESCRIPTION:\n{r['brief']}\n\nLONG DESCRIPTION:\n{r['long']}",
                              previous_sheet_text=None, basis="import_fix",
                              note="The first import read these from the column next door on this tab. This puts the sheet's own values in.",
                              source_sheet=r["sheet"], source_row=r["row"], _title=a["p"]["title"]))
    # renames and category moves
    for r, p in m["renamed"]:
        if norm(r["title"]) != norm(p["title"]) and "vehicle" not in r:
            proposals.append(dict(kind="field", product_id=p["id"], location_id=p["location_id"], field="title", label="Name",
                                  current={"title": p["title"]}, patch={"title": r["title"][:200]}, current_text=p["title"], proposed_text=r["title"][:200],
                                  sheet_text=f"TITLE:\n{r['title']}", previous_sheet_text=None, basis="sheet_changed", note=None,
                                  source_sheet=r["sheet"], source_row=r["row"], _title=p["title"]))
    for r, p in m["mismatched"]:
        proposals.append(dict(kind="field", product_id=p["id"], location_id=p["location_id"], field="category", label="Category",
                              current={"category": p["category"]}, patch={"category": r["category"]},
                              current_text=CAT_LABEL[p["category"]], proposed_text=CAT_LABEL[r["category"]],
                              sheet_text=f"Filed on the sheet under {CAT_LABEL[r['category']]}" + (f"\nDAY, TIME & DURATION: {r['daytime']}" if r.get("daytime") else ""),
                              previous_sheet_text=None, basis="section", note=None, source_sheet=r["sheet"], source_row=r["row"], _title=p["title"]))
    # new experiences
    for r in m["new"]:
        base_, extra, exc = F.new_product_payload(r)
        loc = r["location"]; ccy = loc["currency"]
        bits = [CAT_LABEL[r["category"]], money(base_.get("rate_usd"), "USD") if base_.get("rate_usd") is not None else "price to check",
                days_txt(base_.get("days_of_week")) if r["category"] not in ("one_time_event", "transport") else (date_txt(base_.get("expires_on")) if r["category"] == "one_time_event" else ""),
                f"{F.fmt12(base_['starts_at'])}" + (f" to {F.fmt12(base_['ends_at'])}" if base_.get("ends_at") else "") if base_.get("starts_at") else "",
                STATUS_LABEL.get(base_.get("status"), "")]
        proposals.append(dict(kind="new", product_id=None, location_id=loc["id"], field=None, label="New on the sheet",
                              current=None, patch=None, payload=dict(product=base_, **extra), current_text="Not in the tool",
                              proposed_text=" · ".join(b for b in bits if b), sheet_text=f"TITLE: {r['title']}\nRATE: {r.get('rate')}\nDAY, TIME & DURATION: {r.get('daytime')}",
                              previous_sheet_text=None, basis="sheet_changed", note="; ".join(e[2] for e in exc) or None,
                              source_sheet=r["sheet"], source_row=r["row"], _title=r["title"]))
    # gone from the sheet
    for p in m["gone"]:
        if p["status"] == "paused": continue
        if p["category"] == "one_time_event" and p["expires_on"] and p["expires_on"] < TODAY.isoformat(): continue
        proposals.append(dict(kind="missing", product_id=p["id"], location_id=p["location_id"], field="status", label="Not on the sheet any more",
                              current={"status": p["status"], "active_on_ground": p["active_on_ground"]}, patch={"status": "paused", "active_on_ground": False},
                              current_text=STATUS_LABEL.get(p["status"], p["status"]), proposed_text="Paused (stays in the database)",
                              sheet_text=f"Was row {p['source_row']} of {sq(p['source_sheet'])}; not on the sheet now.", previous_sheet_text=None,
                              basis="sheet_changed", note=None, source_sheet=sq(p["source_sheet"]), source_row=p["source_row"], _title=p["title"]))

    # times (same rules as the 9 Sep queue, recomputed from the live sheet)
    times = []
    for r, p in m["matched"] + m["shifted"] + m["renamed"]:
        if r["category"] == "transport": continue
        pr = F.propose_times(r.get("itinerary"), r.get("daytime"), p)
        if not pr: continue
        start, end, dur, src, src_text, note = pr
        cur_s = (p["starts_at"] or "")[:5] or None; cur_e = (p["ends_at"] or "")[:5] or None
        if start == cur_s and (end == cur_e or end is None): continue
        times.append(dict(product_id=p["id"], location_id=p["location_id"], current_starts_at=cur_s, current_ends_at=cur_e,
                          current_duration_minutes=p["duration_minutes"], proposed_starts_at=start, proposed_ends_at=end,
                          proposed_duration_minutes=dur, source=src, source_text=src_text, note=note))

    # anything head office already rejected stays rejected: a re-run never brings the same change back
    rejected = api.get("sheet_sync_proposals", {"select": "product_id,location_id,kind,field,patch,payload", "status": "eq.rejected"})
    seen_no = {(x["product_id"], x["field"], json.dumps(x["patch"], sort_keys=True)) for x in rejected if x["kind"] != "new"}
    seen_no_new = {(x["location_id"], norm((x.get("payload") or {}).get("product", {}).get("title", ""))) for x in rejected if x["kind"] == "new"}
    before = len(proposals)
    proposals = [x for x in proposals if not (
        (x["kind"] != "new" and (x["product_id"], x["field"], json.dumps(x["patch"], sort_keys=True)) in seen_no) or
        (x["kind"] == "new" and (x["location_id"], norm(x["_title"])) in seen_no_new))]
    if before != len(proposals): print(f"left out {before - len(proposals)} already rejected by head office")

    # ── report ──
    kinds = Counter(x["kind"] for x in proposals)
    print("\n=== QUEUE ===")
    print(f"changed fields {kinds['field']} · new {kinds['new']} · gone from sheet {kinds['missing']} · times {len(times)}")
    print("  fields by type:", dict(Counter(x["field"] for x in proposals if x["kind"] == "field").most_common()))
    print("  fields by reason:", dict(Counter(x["basis"] for x in proposals if x["kind"] == "field")))
    print("  by hostel:", dict(Counter(loc_by_id[x["location_id"]]["name"] for x in proposals).most_common()))
    print(f"not queued, sheet unchanged so the tool's value stands: {dict(standing)} · unreadable: {dict(unreadable)} · no earlier copy found for {no_base} products")
    if live_warn: print("header notes:", *live_warn[:10], sep="\n  ")
    for k in ("field", "new", "missing"):
        sample = [x for x in proposals if x["kind"] == k][:14]
        if sample: print(f"\nsample {k}:")
        for x in sample:
            print(f"  {loc_by_id[x['location_id']]['name'][:12]:12} {x['_title'][:34]:34} {x['label'][:16]:16} {short(x['current_text'], 32):32} -> {short(x['proposed_text'], 40)} [{x['basis']}]")
    out = dict(live=os.path.basename(live_path), generated_at=dt.datetime.utcnow().isoformat() + "Z",
               counts=dict(fields=kinds["field"], new=kinds["new"], missing=kinds["missing"], times=len(times)),
               standing=standing, proposals=[{k: v for k, v in x.items() if not k.startswith("_")} for x in proposals], times=times)
    os.makedirs(os.path.join(os.path.dirname(__file__), "data"), exist_ok=True)
    json.dump(out, open(os.path.join(os.path.dirname(__file__), "data", "sheet_sync_preview.json"), "w"), indent=1, default=str)
    if not apply: print("\nDRY RUN: nothing written. Re-run with --apply."); return

    # ── apply: queue only; nothing on a product changes here ──
    run = api.post("import_runs", dict(source="flowchart_final_sync", notes=f"Final sync from {os.path.basename(live_path)}: every difference queued for approval"))[0]
    # archive the workbook and what was read from it, since the sheet is being deleted
    stamp = dt.datetime.utcnow().strftime("%Y%m%d-%H%M")
    for name, body, ctype in ([] if "--no-archive" in args else [(f"{stamp}/flow-chart.xlsx", open(live_path, "rb").read(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                              (f"{stamp}/rows.json", json.dumps(live, default=str, ensure_ascii=False).encode(), "application/json")]):
        rr = requests.post(f"{F.URL}/storage/v1/object/flowchart-archive/{name}", headers={**{k: v for k, v in api.h.items() if k != "Content-Type"}, "Content-Type": ctype, "x-upsert": "true"}, data=body)
        print(f"archived {name}: {rr.status_code}{'' if rr.ok else ' ' + rr.text[:200]}")
    # older open items this run replaces
    api.patch("product_time_proposals", {"status": "eq.pending"}, {"status": "superseded"})
    api.patch("sheet_sync_proposals", {"status": "eq.pending"}, {"status": "superseded"})   # a re-run replaces whatever is still waiting
    for f in ("missing_from_sheet", "title", "category"):
        api.patch("import_exceptions", {"status": "eq.open", "field": f"eq.{f}"}, {"status": "dismissed", "payload": {"superseded_by_run": run["id"]}})
    rows = [{**{k: v for k, v in x.items() if not k.startswith("_")}, "run_id": run["id"]} for x in proposals]
    for x in rows: x.setdefault("payload", None)
    for i in range(0, len(rows), 200): api.post("sheet_sync_proposals", rows[i:i + 200], prefer="return=minimal")
    for i in range(0, len(times), 200): api.post("product_time_proposals", [{**t, "run_id": run["id"]} for t in times[i:i + 200]], prefer="return=minimal")
    api.patch("import_runs", {"id": f"eq.{run['id']}"}, dict(finished_at=dt.datetime.utcnow().isoformat() + "Z", products_imported=0, exceptions_count=len(rows) + len(times)))
    print(f"\nQUEUED: run {run['id']} · {len(rows)} sheet changes · {len(times)} time proposals. Nothing on a product has changed.")

if __name__ == "__main__":
    main()
