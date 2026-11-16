// Renders the after-sync summary: what went where, and anything that couldn't be placed.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const idText = (o) => !o || !o.total ? "" :
  `: <strong>${o.field}${o.total === 1 ? "" : "s"} ${o.ids.join(", ")}${o.total > o.ids.length ? ` +${o.total - o.ids.length} more` : ""}</strong>`;
const attrText = (a) => Object.entries(a).filter(([k]) => k !== "HoleNo").map(([k, v]) => `${k} ${v ?? "blank"}`).join(", ") || "no attributes";

export function renderReport(el, result, extraWarnings = []) {
  const { summary, noHole, unmatched, skippedRows } = result;
  const warn = [...extraWarnings];

  const noHoleTotal = noHole.reduce((s, x) => s + x.n, 0);
  if (noHoleTotal) {
    warn.push(`<strong>${noHoleTotal} staked feature${noHoleTotal === 1 ? " has" : "s have"} a blank HoleNo</strong> and ${noHoleTotal === 1 ? "was" : "were"} <strong>not added to the sheet</strong>. ` +
      `Fill in the HoleNo in Field Maps and re-run:<ul>` +
      noHole.map((x) => `<li>${x.n} × ${esc(x.layer)} (${esc(attrText(x.attrs))})${idText(x.oids)}. Once ${x.n === 1 ? "it has a hole, it" : "they have a hole, they"} will count under <em>${esc(x.label)}</em>.</li>`).join("") + "</ul>");
  }
  const byCol = {};
  for (const x of result.noDesign || []) (byCol[x.col] ??= []).push(x);
  for (const list of Object.values(byCol)) {
    const total = list.reduce((s, x) => s + x.n, 0);
    warn.push(`<strong>${total} feature${total === 1 ? " was" : "s were"} counted under <em>${esc(list[0].label)}</em>, but the sheet has no design quantity for that column.</strong> ` +
      `This usually means a head type or nozzle was entered wrong in the field. These are on the sheet, so check them:<ul>` +
      list.map((x) => `<li>${x.n} × ${esc(x.layer)} on hole ${esc(x.hole)} (${esc(attrText(x.attrs))})${idText(x.oids)}</li>`).join("") + "</ul>");
  }
  const wrongByCol = {};
  for (const x of result.wrongHole || []) (wrongByCol[x.col] ??= []).push(x);
  for (const list of Object.values(wrongByCol)) {
    const total = list.reduce((s, x) => s + x.n, 0);
    warn.push(`<strong>${total} ${esc(list[0].label)} ${total === 1 ? "was" : "were"} staked on ${list.length === 1 ? "a hole" : "holes"} where the design calls for none.</strong> ` +
      `Check for a wrong HoleNo or a wrong head type/nozzle. These are on the sheet:<ul>` +
      list.map((x) => `<li>${x.n} on ${esc(x.area)} (${esc(attrText(x.attrs))})${idText(x.oids)}</li>`).join("") + "</ul>");
  }
  const unmatchedTotal = unmatched.reduce((s, x) => s + x.n, 0);
  if (unmatchedTotal) {
    warn.push(`<strong>${unmatchedTotal} feature${unmatchedTotal === 1 ? "" : "s"} didn't match any column:</strong><ul>` +
      unmatched.map((x) => `<li>${x.n} × ${esc(x.layer)} on hole ${esc(x.attrs.HoleNo ?? "blank")} (${esc(attrText(x.attrs))})${idText(x.oids)}</li>`).join("") + "</ul>");
  }
  for (const s of summary) {
    if (s.skipped) warn.push(`Column ${esc(s.col)} (${esc(s.label)}) was skipped: ${esc(s.skipped)}.`);
    for (const [hole, n] of s.offSheet || []) warn.push(`${n} × ${esc(s.label)} on hole <strong>${esc(hole)}</strong>, which has no row on the sheet.`);
  }

  const rows = summary.filter((s) => !s.skipped).map((s) => {
    const holes = Object.entries(s.byHole).map(([h, n]) => `${esc(h.replace(/^HOLE\s*/i, "#"))}: ${n}`).join(" · ");
    const pct = s.design ? Math.round((s.staked / s.design) * 100) + "%" : "";
    const tag = s.kind === "total" ? ` <span class="tag" title="Design quantity is a single total (e.g. in ADJ), so hole numbers aren't checked">billed in total</span>` : "";
    return `<tr class="${s.staked ? "" : "muted"}"><td class="mono">${esc(s.sCol)}</td><td>${esc(s.label)}${tag}</td>` +
      `<td class="num">${s.staked}</td><td class="num">${s.design || ""}</td><td class="num">${pct}</td><td class="holes">${holes || "—"}</td></tr>`;
  }).join("");

  el.innerHTML =
    (warn.length ? `<div class="warn"><h3>Check these</h3>${warn.map((w) => `<div class="warn-item">${w}</div>`).join("")}</div>` : "") +
    `<table class="report"><thead><tr><th>S col</th><th>Material</th><th class="num">Staked</th><th class="num">Design</th><th class="num">%</th><th>By hole</th></tr></thead><tbody>${rows}</tbody></table>` +
    (skippedRows.length ? `<p class="note">Rows without a hole number (${skippedRows.map(esc).join(", ")}) are left alone, except that in “billed in total” columns, features with a blank HoleNo are counted in the row that holds the design total.</p>` : "");
}
