/**
 * MAD MONKEY RATE SYNC — 2027 RATE OFFER TA → Experience Database
 * Tailored to the real sheet layout, 24 Aug 2026.
 *
 * PASTE: Extensions → Apps Script → replace everything in Code.gs with this file.
 * THEN:
 *   1. Project Settings (gear) → Script Properties → Add property:
 *        MM_SHARED_SECRET = <the secret Charlie gives you>
 *   2. Editor toolbar: choose `setup` in the function dropdown → Run (once).
 *      Approve the permissions dialog.
 *   3. Reload the spreadsheet → "Mad Monkey Sync" menu appears.
 *   4. Fill the USD column on the new _SYNC_BREAKFAST tab (once), then
 *      Mad Monkey Sync → Push rates now.
 *
 * WHAT IT READS
 *   Accommodation: straight from "BASE RATE PER SEASONALITY" — the three
 *   season blocks (LEAN / MID / HIGH), USD columns only, room types
 *   "Lowest Dorm" and "Lowest Private". Blank/zero rates are skipped
 *   (e.g. Siargao has no private). If a column is INSERTED in that tab the
 *   geometry below must be updated — tell Charlie before restructuring.
 *   Breakfast: from the small _SYNC_BREAKFAST tab this script creates,
 *   because "BREAKFAST RATE FROM CAM" is free text in local currencies and
 *   the tool quotes USD only. Type the USD per-person rate per location once.
 *
 * AFTER SETUP, AUTOMATICALLY
 *   - edits to the base-rate tab or _SYNC_BREAKFAST push within ~5 min (debounced)
 *   - a nightly ~02:00 heartbeat push always runs (silence = alarm server-side)
 *   - every push writes its result into _SYNC_STATUS
 */

var ENDPOINT = "https://avftyexxqyykppzmrjxn.supabase.co/functions/v1/rate-sync";
// Auth is the HMAC signature only — the endpoint no longer requires a JWT
// (the long anon key kept getting mangled by copy-paste).

var BASE_TAB = "BASE RATE PER SEASONALITY";   // matched with trim, trailing space ok
var BF_TAB = "_SYNC_BREAKFAST";
var STATUS_TAB = "_SYNC_STATUS";

// Property codes in the sheet -> location names in the Experience Database
var CODE_MAP = {
  SGO: "Siargao", NCP: "Nacpan", PLO: "Panglao", DGT: "Dumaguete",
  SQR: "Siquijor", MNL: "Manila", PP: "Phnom Penh", SR: "Siem Reap",
  KR: "Koh Rong", KSD: "Koh Sdach", BKK: "Bangkok", PAI: "Pai",
  CGM: "Chiang Mai", PKT: "Phuket", LP: "Luang Prabang", VV: "Vang Vieng",
  KL: "Kuta Lombok", GLT: "Gili Trawangan", NL: "Nusa Lembongan",
  ULU: "Uluwatu", HOI: "Hoi An", HAN: "Hanoi",
};

// Season blocks in the base-rate tab: [propertyCol, usdDormCol, usdPrivateCol]
// A=1 D=4 E=5 | G=7 J=10 K=11 | M=13 P=16 Q=17   (data starts row 4)
var BLOCKS = { lean: [1, 4, 5], mid: [7, 10, 11], high: [13, 16, 17] };
var DATA_START_ROW = 4;

/* ── one-time setup ─────────────────────────────────────────────────── */

function setup() {
  if (!PropertiesService.getScriptProperties().getProperty("MM_SHARED_SECRET")) {
    throw new Error("Add the MM_SHARED_SECRET script property first (Project Settings → Script Properties), then run setup again.");
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!findSheet_(ss, BASE_TAB)) throw new Error('Tab "' + BASE_TAB + '" not found — is this the right spreadsheet?');

  var bf = findSheet_(ss, BF_TAB);
  if (!bf) {
    bf = ss.insertSheet(BF_TAB);
    bf.getRange(1, 1, 1, 2).setValues([["location", "rate_usd_pp"]]).setFontWeight("bold");
    bf.setFrozenRows(1);
    var names = Object.keys(CODE_MAP).map(function (k) { return [CODE_MAP[k], ""]; });
    names.push(["Kampot", ""]);   // not in the base-rate tab, listed for completeness
    bf.getRange(2, 1, names.length, 2).setValues(names);
    bf.autoResizeColumns(1, 2);
  }
  ensureStatusTab_(ss);

  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("onEditHandler").forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger("flushIfDirty").timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger("nightlyPush").timeBased().atHour(2).everyDays(1).create();

  ss.toast("Installed. Fill the USD column on " + BF_TAB + ", then Mad Monkey Sync → Push rates now.", "Mad Monkey", 10);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu("Mad Monkey Sync")
    .addItem("Push rates now", "manualPush")
    .addToUi();
}

/* ── triggers ───────────────────────────────────────────────────────── */

function onEditHandler(e) {
  var name = e.range.getSheet().getName().trim();
  if (name !== BASE_TAB.trim() && name !== BF_TAB) return;
  PropertiesService.getScriptProperties().setProperty("dirtySince", String(Date.now()));
}

function flushIfDirty() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty("dirtySince")) return;
  if (pushSnapshot_("edit").ok) props.deleteProperty("dirtySince");
}

function nightlyPush() { pushSnapshot_("nightly"); }

function manualPush() {
  var r = pushSnapshot_("manual");
  SpreadsheetApp.getActiveSpreadsheet().toast(
    r.ok ? "Pushed: " + r.summary : "FAILED: " + r.summary, "Mad Monkey Sync", 8);
}

/* ── build the payload from the real tabs ───────────────────────────── */

function readRates_(ss, notes) {
  var sh = findSheet_(ss, BASE_TAB);
  var lastRow = DATA_START_ROW;
  while (String(sh.getRange(lastRow + 1, 1).getValue()).trim() !== "" && lastRow < 200) lastRow++;
  var grid = sh.getRange(1, 1, lastRow, 20).getValues();

  var rows = [], unknown = {};
  Object.keys(BLOCKS).forEach(function (season) {
    var cols = BLOCKS[season];
    for (var r = DATA_START_ROW - 1; r < lastRow; r++) {
      var code = String(grid[r][cols[0] - 1]).trim().toUpperCase();
      if (!code) continue;
      var loc = CODE_MAP[code];
      if (!loc) { unknown[code] = true; continue; }
      [["Lowest Dorm", cols[1]], ["Lowest Private", cols[2]]].forEach(function (rt) {
        var v = grid[r][rt[1] - 1];
        var n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
        if (isFinite(n) && n > 0) {
          rows.push({ location: loc, room_type: rt[0], season: season, rate: String(Math.round(n * 100) / 100) });
        }
      });
    }
  });
  var uk = Object.keys(unknown);
  if (uk.length) notes.push("unknown property codes skipped: " + uk.join(", "));
  return rows;
}

function readBreakfast_(ss) {
  var sh = findSheet_(ss, BF_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  var out = [];
  values.forEach(function (row) {
    var loc = String(row[0]).trim();
    var v = row[1];
    var n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,\s]/g, ""));
    if (loc && isFinite(n) && n >= 0) out.push({ location: loc, rate_pp: String(n) });
  });
  return out;
}

/* ── the push ───────────────────────────────────────────────────────── */

function pushSnapshot_(trigger) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var notes = [];
  var payload = { trigger: trigger, rates: readRates_(ss, notes), breakfast: readBreakfast_(ss) };
  var body = JSON.stringify(payload);
  var secret = PropertiesService.getScriptProperties().getProperty("MM_SHARED_SECRET");
  if (!secret) return writeStatus_(trigger, "failed", null, "MM_SHARED_SECRET script property is missing");

  var sig = Utilities.computeHmacSha256Signature(body, secret)
    .map(function (b) { return ("0" + (b & 0xFF).toString(16)).slice(-2); }).join("");

  try {
    var resp = UrlFetchApp.fetch(ENDPOINT, {
      method: "post", contentType: "application/json", payload: body,
      headers: { "x-mm-signature": sig },
      muteHttpExceptions: true,
    });
    var code = resp.getResponseCode();
    var data = {};
    try { data = JSON.parse(resp.getContentText()); } catch (err) {}
    var msg = notes.join("; ") + (data.error ? (notes.length ? "; " : "") + data.error : "");
    if (code >= 200 && code < 300 && (data.status === "success" || data.status === "partial")) {
      return writeStatus_(trigger, data.status, data, msg);
    }
    return writeStatus_(trigger, data.status || ("http " + code), data, msg || resp.getContentText().slice(0, 300));
  } catch (err) {
    return writeStatus_(trigger, "failed", null, String(err).slice(0, 300));
  }
}

/* ── helpers ────────────────────────────────────────────────────────── */

function findSheet_(ss, name) {
  var target = name.trim().toLowerCase();
  return ss.getSheets().filter(function (s) { return s.getName().trim().toLowerCase() === target; })[0] || null;
}

function ensureStatusTab_(ss) {
  var sh = findSheet_(ss, STATUS_TAB);
  if (!sh) {
    sh = ss.insertSheet(STATUS_TAB);
    sh.getRange(1, 1, 1, 7).setValues([["last_push_at", "trigger", "status", "read", "imported", "rejected", "message"]]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}

function writeStatus_(trigger, status, data, message) {
  var sh = ensureStatusTab_(SpreadsheetApp.getActiveSpreadsheet());
  sh.insertRowAfter(1);
  sh.getRange(2, 1, 1, 7).setValues([[
    new Date(), trigger, status,
    data && data.read != null ? data.read : "",
    data && data.imported != null ? data.imported : "",
    data && data.rejected != null ? data.rejected : "",
    message || "",
  ]]);
  if (sh.getLastRow() > 31) sh.deleteRows(32, sh.getLastRow() - 31);
  var ok = status === "success" || status === "partial";
  return { ok: ok, summary: status + (message ? " — " + message : "") +
    (data && data.imported != null ? " (" + data.imported + " rates)" : "") };
}
