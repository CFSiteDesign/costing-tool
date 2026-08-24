/**
 * MAD MONKEY RATE SYNC — 2027 RATE OFFER TA → Experience Database
 * ================================================================
 * Paste this whole file into the sheet: Extensions → Apps Script → Code.gs
 * (replace anything already there), then:
 *
 *   1. Project Settings (gear icon) → Script Properties → Add property:
 *        Property: MM_SHARED_SECRET     Value: <Charlie gives you this>
 *   2. Back in the editor, pick the function `setup` in the toolbar dropdown
 *      and press ▶ Run. Approve the permissions dialog (it needs to read this
 *      spreadsheet and call an external URL). Run it ONCE only.
 *   3. Reload the spreadsheet. A "Mad Monkey Sync" menu appears — use
 *      "Push rates now" for the first test.
 *
 * What it does after that, automatically:
 *   - any edit to the _SYNC tabs marks the sheet "dirty"
 *   - every 5 minutes, if dirty, it pushes a snapshot (debounce — no
 *     email-per-keystroke problem)
 *   - every night ~02:00 it pushes regardless (the heartbeat: a healthy day
 *     always produces a run, so silence = alarm on the receiving side)
 *   - results are written into the _SYNC_STATUS tab, so the sheet shows its
 *     own sync health
 *
 * The script reads ONLY the two projection tabs below — never Hayley's
 * working tabs. Those tabs hold formulas pointing at her real tabs, so she
 * can restructure her sheet freely without breaking the feed.
 *
 *   _SYNC_RATES      columns: location | room_type | season | rate_usd | valid_from | valid_to
 *                    (season must be lean / mid / high; valid_from/to optional ISO dates)
 *   _SYNC_BREAKFAST  columns: location | rate_usd_pp
 *
 * `setup` creates both tabs (plus _SYNC_STATUS) with headers if they don't
 * exist yet.
 */

var ENDPOINT = "https://avftyexxqyykppzmrjxn.supabase.co/functions/v1/rate-sync";
var ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2ZnR5ZXh4cXl5a3Bwem1yanhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0OTgyNzAsImV4cCI6MjEwMzA3NDI3MH0.jmXCijjRJU3I6xtylc4mlFEWlGFhtyeUIiYT799zeQc";
var RATES_TAB = "_SYNC_RATES";
var BF_TAB = "_SYNC_BREAKFAST";
var STATUS_TAB = "_SYNC_STATUS";

/* ── one-time setup ─────────────────────────────────────────────────── */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureTab_(ss, RATES_TAB, ["location", "room_type", "season", "rate_usd", "valid_from", "valid_to"]);
  ensureTab_(ss, BF_TAB, ["location", "rate_usd_pp"]);
  ensureTab_(ss, STATUS_TAB, ["last_push_at", "trigger", "status", "read", "imported", "rejected", "message"]);

  // wipe any triggers this script installed before, then install fresh
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("onEditHandler").forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger("flushIfDirty").timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger("nightlyPush").timeBased().atHour(2).everyDays(1).create();

  if (!PropertiesService.getScriptProperties().getProperty("MM_SHARED_SECRET")) {
    throw new Error("Add the MM_SHARED_SECRET script property first (Project Settings → Script Properties), then run setup again.");
  }
  SpreadsheetApp.getActiveSpreadsheet().toast("Rate sync installed. Use Mad Monkey Sync → Push rates now to test.", "Mad Monkey", 8);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu("Mad Monkey Sync")
    .addItem("Push rates now", "manualPush")
    .addToUi();
}

/* ── triggers ───────────────────────────────────────────────────────── */

function onEditHandler(e) {
  var name = e.range.getSheet().getName();
  if (name !== RATES_TAB && name !== BF_TAB) return;   // ignore edits elsewhere
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
    r.ok ? ("Pushed: " + r.summary) : ("FAILED: " + r.summary), "Mad Monkey Sync", 8);
}

/* ── the push ───────────────────────────────────────────────────────── */

function pushSnapshot_(trigger) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var payload = {
    trigger: trigger,
    rates: readTab_(ss, RATES_TAB, ["location", "room_type", "season", "rate", "valid_from", "valid_to"]),
    breakfast: readTab_(ss, BF_TAB, ["location", "rate_pp"]),
  };
  var body = JSON.stringify(payload);
  var secret = PropertiesService.getScriptProperties().getProperty("MM_SHARED_SECRET");
  if (!secret) return writeStatus_(trigger, "failed", null, "MM_SHARED_SECRET script property is missing");

  var sig = Utilities.computeHmacSha256Signature(body, secret)
    .map(function (b) { return ("0" + (b & 0xFF).toString(16)).slice(-2); }).join("");

  try {
    var resp = UrlFetchApp.fetch(ENDPOINT, {
      method: "post",
      contentType: "application/json",
      payload: body,
      headers: { "Authorization": "Bearer " + ANON_KEY, "x-mm-signature": sig },
      muteHttpExceptions: true,
    });
    var code = resp.getResponseCode();
    var data = {};
    try { data = JSON.parse(resp.getContentText()); } catch (err) {}
    if (code >= 200 && code < 300 && (data.status === "success" || data.status === "partial")) {
      return writeStatus_(trigger, data.status, data, "");
    }
    return writeStatus_(trigger, data.status || ("http " + code), data, data.error || resp.getContentText().slice(0, 300));
  } catch (err) {
    return writeStatus_(trigger, "failed", null, String(err).slice(0, 300));
  }
}

/* ── helpers ────────────────────────────────────────────────────────── */

function readTab_(ss, name, keys) {
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, keys.length).getValues();
  var out = [];
  values.forEach(function (row) {
    if (row.every(function (c) { return c === "" || c === null; })) return;  // skip blank rows
    var o = {};
    keys.forEach(function (k, i) {
      var v = row[i];
      if (v instanceof Date) v = Utilities.formatDate(v, "UTC", "yyyy-MM-dd");
      o[k] = String(v).trim();
    });
    out.push(o);
  });
  return out;
}

function writeStatus_(trigger, status, data, message) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(STATUS_TAB) || ensureTab_(ss, STATUS_TAB,
    ["last_push_at", "trigger", "status", "read", "imported", "rejected", "message"]);
  sh.insertRowAfter(1);
  sh.getRange(2, 1, 1, 7).setValues([[
    new Date(), trigger, status,
    data && data.read != null ? data.read : "",
    data && data.imported != null ? data.imported : "",
    data && data.rejected != null ? data.rejected : "",
    message || "",
  ]]);
  if (sh.getLastRow() > 31) sh.deleteRows(32, sh.getLastRow() - 31);   // keep 30 runs
  var ok = status === "success" || status === "partial";
  return { ok: ok, summary: status + (message ? " — " + message : "") +
    (data && data.imported != null ? " (" + data.imported + " rates)" : "") };
}

function ensureTab_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}
