// Step 4: shows what each material column will count, and lets the PM change it before syncing.
import { describe } from "./headers.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const BADGE = {
  ok: ["ok", "✓ Found"], saved: ["ok", "✓ Saved"], edited: ["ok", "✓ Your pick"],
  check: ["check", "⚠ Check"], none: ["none", "✗ Not counted"],
};
const SKIP_FIELDS = /^(HoleNo|Water_Type|CourseArea)$/i;

/** rows: review rows (changed in place when the PM edits one). onChange() runs after an edit. */
export function renderReview(el, rows, catalog, onChange) {
  const tally = { ok: 0, check: 0, none: 0 };
  for (const r of rows) tally[r.skip || !r.layer ? "none" : r.status === "check" ? "check" : "ok"]++;
  const parts = [`<strong>${tally.ok}</strong> found`];
  if (tally.check) parts.push(`<strong>${tally.check}</strong> to check`);
  if (tally.none) parts.push(`<strong>${tally.none}</strong> not counted (left blank on the staking tab)`);
  el.innerHTML =
    `<p class="note">${rows.length} material columns: ${parts.join(", ")}. Use <em>Change</em> to fix any column; your picks are saved in the sheet for next time.</p>` +
    `<table class="report review"><thead><tr><th>Col</th><th>Header on your sheet</th><th>Counts in the map</th><th></th><th></th></tr></thead><tbody>` +
    rows.map((r, i) => {
      const [cls, text] = BADGE[r.skip || !r.layer ? "none" : r.status] || BADGE.ok;
      return `<tr data-i="${i}"><td class="mono">${esc(r.col)}</td><td>${esc(r.header) || "<em>(blank)</em>"}</td>` +
        `<td>${esc(describe(r))}${r.note ? `<div class="note">${esc(r.note)}</div>` : ""}</td>` +
        `<td><span class="badge ${cls}">${text}</span></td><td><button class="secondary small" data-edit="${i}">Change</button></td></tr>`;
    }).join("") + "</tbody></table>";

  for (const btn of el.querySelectorAll("[data-edit]")) {
    btn.onclick = () => {
      const tr = btn.closest("tr");
      if (tr.nextElementSibling?.classList.contains("editor")) { tr.nextElementSibling.remove(); return; }
      el.querySelectorAll("tr.editor").forEach((x) => x.remove());
      tr.insertAdjacentElement("afterend", editor(rows, Number(btn.dataset.edit), catalog, () => { renderReview(el, rows, catalog, onChange); onChange(); }));
    };
  }
}

function editor(rows, i, catalog, done) {
  const r = rows[i];
  const tr = document.createElement("tr");
  tr.className = "editor";
  const layers = [...catalog].sort((a, b) => (b.isHead - a.isHead) || a.title.localeCompare(b.title));
  tr.innerHTML = `<td></td><td colspan="4"><div class="edit-grid">
      <label>Layer <select data-k="layer"><option value="">(not counted)</option>${layers.map((l) =>
        `<option${l.title === r.layer && !r.skip ? " selected" : ""}>${esc(l.title)}</option>`).join("")}</select></label>
      <div class="fields"></div>
      <label class="check"><input type="checkbox" data-k="other"${r.other ? " checked" : ""}> Only features no other column counts (like "Other Sprinklers")</label>
      <div class="row"><button class="small" data-k="apply">Use this</button><button class="secondary small" data-k="cancel">Cancel</button></div>
    </div></td>`;
  const q = (k) => tr.querySelector(`[data-k="${k}"]`);
  const drawFields = () => {
    const l = catalog.find((x) => x.title === q("layer").value);
    const box = tr.querySelector(".fields");
    if (!l) { box.innerHTML = ""; return; }
    const same = l.title === r.layer;
    box.innerHTML = l.fields.filter((f) => f.values && !SKIP_FIELDS.test(f.name)).map((f) => {
      const cur = same ? r.filter?.[f.name] : null;
      const multi = cur && cur.length > 1 ? `<option value="${esc(JSON.stringify(cur))}" selected>${esc(cur.join(" or "))}</option>` : "";
      return `<label>${esc(f.name)} <select data-field="${esc(f.name)}"><option value="">Any</option>${multi}${f.values.map((v) =>
        `<option value="${esc(JSON.stringify([v]))}"${cur && cur.length === 1 && cur[0] === v ? " selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`;
    }).join("") || `<span class="note">This layer has no dropdown fields, so every feature in it is counted.</span>`;
  };
  q("layer").onchange = drawFields;
  drawFields();
  q("cancel").onclick = () => tr.remove();
  q("apply").onclick = () => {
    const layer = q("layer").value || null;
    const filter = {};
    for (const s of tr.querySelectorAll("[data-field]")) if (s.value) filter[s.dataset.field] = JSON.parse(s.value);
    const other = !!layer && q("other").checked;
    rows[i] = { col: r.col, header: r.header, layer, filter: other ? {} : filter, other, skip: !layer, status: "edited", note: null };
    done();
  };
  return tr;
}
