import { restoreSession, signIn, signOut, parseItemId, loadWebMap, groupedCounts, getUser, searchWebMaps, itemPageUrl } from "./arcgis.js";
import { fieldsByLayer } from "./mapping.js";
import { prepareWorkbook, applyCounts, outputName } from "./sync.js";
import { renderReport } from "./report.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const state = {
  session: null, user: null,
  fileBytes: null, fileName: null,
  webmap: null,                       // { id, title }
  scope: "org", searchTouched: false, searchSeq: 0, nextStart: -1,
  downloadUrl: null,
};

function setStatus(id, html, isErr = false) {
  $(id).innerHTML = html;
  $(id).classList.toggle("err", isErr);
}
function refresh() {
  $("step-signin").classList.toggle("done", !!state.session);
  $("step-file").classList.toggle("done", !!state.fileBytes);
  $("step-map").classList.toggle("disabled", !state.session);
  $("step-map").classList.toggle("done", !!state.webmap);
  $("btn-signin").hidden = !!state.session;
  $("btn-signout").hidden = !state.session;
  $("btn-sync").disabled = !(state.session && state.fileBytes && state.webmap);
  $("btn-sync").title = !state.fileBytes ? "Upload your sheet first" : !state.webmap ? "Pick a web map first" : "";
}

// ---------------- 1. Sign in ----------------
async function onSignedIn() {
  setStatus("signin-status", `Signed in as <strong>${esc(state.session.username)}</strong>.`);
  try { state.user = await getUser(state.session); } catch { state.user = { username: state.session.username }; }
  refresh();
  prefillSearch();
  runSearch();
}

if (!window.APP_CONFIG.clientId) {
  $("btn-signin").disabled = true;
  setStatus("signin-status", "Sign-in isn't set up yet: config.js needs the ArcGIS app's client ID.", true);
} else {
  state.session = restoreSession();
  if (state.session) onSignedIn();
}
$("btn-signin").onclick = async () => {
  try {
    setStatus("signin-status", "Waiting for the ArcGIS sign-in window…");
    state.session = await signIn();
    await onSignedIn();
  } catch (e) {
    setStatus("signin-status", `Sign-in didn't finish: ${esc(e.message)}. If no window appeared, allow pop-ups for this site and try again.`, true);
  }
  refresh();
};
$("btn-signout").onclick = () => {
  signOut();
  Object.assign(state, { session: null, user: null, webmap: null });
  $("map-list").innerHTML = "";
  $("selected").hidden = true;
  setStatus("signin-status", "Signed out.");
  refresh();
};

// ---------------- 2. Workbook (browse or drag & drop) ----------------
async function handleFile(f) {
  state.fileBytes = null;
  $("dropzone").classList.remove("has-file");
  $("dz-main").innerHTML = "Drag your sheet here, or <u>click to browse</u>";
  if (!f) { refresh(); return; }
  if (!/\.xlsx$/i.test(f.name)) {
    setStatus("file-status", `"${esc(f.name)}" isn't an .xlsx file. Save it as an Excel Workbook (.xlsx) and try again.`, true);
    refresh(); return;
  }
  try {
    const bytes = await f.arrayBuffer();
    const ctx = await prepareWorkbook(bytes);
    const holes = ctx.layout.rows.filter((r) => r.hole).length;
    state.fileBytes = bytes; state.fileName = f.name;
    $("dropzone").classList.add("has-file");
    $("dz-main").innerHTML = `📄 ${esc(f.name)} <u>(change)</u>`;
    setStatus("file-status", `Found tab <strong>${esc(ctx.sheet.name)}</strong> with ${holes} hole/area rows and ${ctx.mapping.length} material columns (using the ${ctx.mappingSource}).`);
    prefillSearch();
  } catch (e) {
    setStatus("file-status", `Couldn't read that sheet: ${esc(e.message)}`, true);
  }
  refresh();
}
$("file").onchange = (ev) => handleFile(ev.target.files[0]);

const dz = $("dropzone");
["dragenter", "dragover"].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add("over"); }));
["dragleave", "dragend"].forEach((t) => dz.addEventListener(t, () => dz.classList.remove("over")));
dz.addEventListener("drop", (e) => {
  e.preventDefault();
  dz.classList.remove("over");
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
});
// A file dropped anywhere else on the page shouldn't make the browser open it.
["dragover", "drop"].forEach((t) => window.addEventListener(t, (e) => { if (!dz.contains(e.target)) e.preventDefault(); }));

// ---------------- 3. Web map picker ----------------
/** Uses the project number from the file name ("2603 Kettle Forge ...") as a starting search. */
function prefillSearch() {
  if (state.searchTouched || !state.fileName || !state.session) return;
  const m = /^\s*(\d{3,6})\b/.exec(state.fileName);
  if (m && $("map-search").value !== m[1]) {
    $("map-search").value = m[1];
    runSearch();
  }
}

function fmtDate(ms) {
  return ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
}

async function runSearch({ append = false } = {}) {
  if (!state.session || !state.user?.orgId) return;
  const seq = ++state.searchSeq;
  const list = $("map-list");
  if (!append) list.innerHTML = `<li class="msg">Searching…</li>`;
  if (state.scope === "favorites" && !state.user.favGroupId) {
    list.innerHTML = `<li class="msg">No favorites found for your account.</li>`; return;
  }
  try {
    const { items, nextStart } = await searchWebMaps(state.session, state.user, {
      text: $("map-search").value, scope: state.scope, stakingOnly: $("staking-only").checked,
      start: append ? state.nextStart : 1,
    });
    if (seq !== state.searchSeq) return;          // a newer search already started
    if (!append) list.innerHTML = "";
    for (const it of items) {
      const li = document.createElement("li");
      li.dataset.id = it.id;
      li.classList.toggle("chosen", state.webmap?.id === it.id);
      li.innerHTML = `<div><div class="map-title">${esc(it.title)}</div>` +
        `<div class="map-meta">${esc(it.owner)} · updated ${fmtDate(it.modified)}</div></div>` +
        `<a href="${itemPageUrl(it.id)}" target="_blank" rel="noopener" title="Open in ArcGIS Online">Open ↗</a>`;
      li.onclick = (e) => { if (e.target.tagName !== "A") chooseMap(it); };
      list.appendChild(li);
    }
    if (!list.children.length) {
      const hint = $("staking-only").checked ? " Try unchecking “Staking maps only”." : "";
      list.innerHTML = `<li class="msg">No web maps found.${hint}</li>`;
    }
    state.nextStart = nextStart;
    $("load-more").hidden = !(nextStart > 0);
  } catch (e) {
    if (seq === state.searchSeq) list.innerHTML = `<li class="msg">Search failed: ${esc(e.message)}</li>`;
  }
}

function chooseMap(it) {
  state.webmap = { id: it.id, title: it.title };
  for (const li of $("map-list").children) li.classList.toggle("chosen", li.dataset.id === it.id);
  $("selected").hidden = false;
  $("selected").innerHTML = `Selected: <strong>${esc(it.title)}</strong>`;
  setStatus("map-status", "");
  refresh();
}

let searchTimer;
$("map-search").addEventListener("input", () => {
  state.searchTouched = true;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(), 300);
});
$("staking-only").onchange = () => runSearch();
$("load-more").onclick = () => runSearch({ append: true });
for (const tab of document.querySelectorAll(".picker-tabs .tab")) {
  tab.onclick = () => {
    state.scope = tab.dataset.scope;
    document.querySelectorAll(".picker-tabs .tab").forEach((t) => t.classList.toggle("active", t === tab));
    runSearch();
  };
}
$("btn-use-link").onclick = async () => {
  const id = parseItemId($("webmap").value);
  if (!id) { setStatus("map-status", "That doesn't look like a web map link or item ID.", true); return; }
  try {
    const wm = await loadWebMap(state.session, id);
    chooseMap({ id, title: wm.title });
  } catch (e) {
    setStatus("map-status", `Couldn't open that web map: ${esc(e.message)}`, true);
  }
};

// ---------------- 4. Sync ----------------
$("btn-sync").onclick = async () => {
  $("btn-sync").disabled = true;
  try {
    setStatus("map-status", "Reading the web map…");
    const wm = await loadWebMap(state.session, state.webmap.id);
    const ctx = await prepareWorkbook(state.fileBytes);   // fresh copy every run
    const needed = fieldsByLayer(ctx.mapping);
    const warnings = [];
    const rowsByLayer = {};
    let done = 0;
    await Promise.all(Object.entries(needed).map(async ([layer, fields]) => {
      const url = wm.layers[layer];
      if (!url) { warnings.push(`The web map has no layer named <strong>${esc(layer)}</strong>, so its columns were left alone.`); return; }
      try {
        rowsByLayer[layer] = await groupedCounts(state.session, url, fields);
      } catch (e) {
        warnings.push(`Couldn't count <strong>${esc(layer)}</strong>: ${esc(e.message)}.`);
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
    setStatus("map-status", `Done: ${esc(name)}`);
    $("step-result").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    const expired = /token|498|499|not authorized/i.test(e.message);
    setStatus("map-status", expired ? "Your ArcGIS sign-in expired or doesn't have access to that map. Sign out, sign in again, and retry." : `Something went wrong: ${esc(e.message)}`, true);
  } finally {
    refresh();
  }
};

refresh();
