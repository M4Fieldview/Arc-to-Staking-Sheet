import { restoreSession, signIn, signOut, parseItemId, loadWebMap, groupedCounts } from "./arcgis.js";
import { fieldsByLayer } from "./mapping.js";
import { prepareWorkbook, applyCounts, outputName } from "./sync.js";
import { renderReport } from "./report.js";

const $ = (id) => document.getElementById(id);
const state = { session: null, fileBytes: null, fileName: null, downloadUrl: null };

function setStatus(id, html, isErr = false) {
  $(id).innerHTML = html;
  $(id).classList.toggle("err", isErr);
}
function refresh() {
  $("step-signin").classList.toggle("done", !!state.session);
  $("step-file").classList.toggle("done", !!state.fileBytes);
  $("step-map").classList.toggle("disabled", !(state.session && state.fileBytes));
  $("btn-signin").hidden = !!state.session;
  $("btn-signout").hidden = !state.session;
}

// ---- 1. Sign in ----
if (!window.APP_CONFIG.clientId) {
  $("btn-signin").disabled = true;
  setStatus("signin-status", "Sign-in isn't set up yet: config.js needs the ArcGIS app's client ID.", true);
} else {
  state.session = restoreSession();
  if (state.session) setStatus("signin-status", `Signed in as <strong>${state.session.username}</strong>.`);
}
$("btn-signin").onclick = async () => {
  try {
    setStatus("signin-status", "Waiting for the ArcGIS sign-in window…");
    state.session = await signIn();
    setStatus("signin-status", `Signed in as <strong>${state.session.username}</strong>.`);
  } catch (e) {
    setStatus("signin-status", `Sign-in didn't finish: ${e.message}. If no window appeared, allow pop-ups for this site and try again.`, true);
  }
  refresh();
};
$("btn-signout").onclick = () => {
  signOut(); state.session = null;
  setStatus("signin-status", "Signed out.");
  refresh();
};

// ---- 2. Workbook ----
$("file").onchange = async (ev) => {
  const f = ev.target.files[0];
  state.fileBytes = null;
  if (!f) { refresh(); return; }
  try {
    const bytes = await f.arrayBuffer();
    const ctx = await prepareWorkbook(bytes);
    const holes = ctx.layout.rows.filter((r) => r.hole).length;
    state.fileBytes = bytes; state.fileName = f.name;
    setStatus("file-status", `Found tab <strong>${ctx.sheet.name}</strong> with ${holes} hole/area rows and ${ctx.mapping.length} material columns (using the ${ctx.mappingSource}).`);
  } catch (e) {
    setStatus("file-status", `Couldn't read that sheet: ${e.message}`, true);
  }
  refresh();
};

// ---- 3. Sync ----
$("btn-sync").onclick = async () => {
  const id = parseItemId($("webmap").value);
  if (!id) { setStatus("map-status", "That doesn't look like a web map link or item ID.", true); return; }
  $("btn-sync").disabled = true;
  try {
    setStatus("map-status", "Reading the web map…");
    const wm = await loadWebMap(state.session, id);
    const ctx = await prepareWorkbook(state.fileBytes);   // fresh copy every run
    const needed = fieldsByLayer(ctx.mapping);
    const warnings = [];
    const rowsByLayer = {};
    let done = 0;
    await Promise.all(Object.entries(needed).map(async ([layer, fields]) => {
      const url = wm.layers[layer];
      if (!url) { warnings.push(`The web map has no layer named <strong>${layer}</strong>, so its columns were left alone.`); return; }
      try {
        rowsByLayer[layer] = await groupedCounts(state.session, url, fields);
      } catch (e) {
        warnings.push(`Couldn't count <strong>${layer}</strong>: ${e.message}.`);
      }
      setStatus("map-status", `Counting staked features… ${++done}/${Object.keys(needed).length} layers`);
    }));
    const result = applyCounts(ctx, rowsByLayer);
    const blob = await ctx.wb.toBlob();
    if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
    state.downloadUrl = URL.createObjectURL(blob);
    const name = outputName(state.fileName);
    $("download").href = state.downloadUrl;
    $("download").download = name;
    $("result-note").textContent = `From "${wm.title}" · ${new Date().toLocaleString()}`;
    renderReport($("report"), result, warnings);
    $("step-result").hidden = false;
    setStatus("map-status", `Done: ${name}`);
    $("step-map").classList.add("done");
    $("step-result").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    const expired = /token|498|499|not authorized/i.test(e.message);
    setStatus("map-status", expired ? "Your ArcGIS sign-in expired or doesn't have access to that map. Sign out, sign in again, and retry." : `Something went wrong: ${e.message}`, true);
  } finally {
    $("btn-sync").disabled = false;
  }
};

refresh();
