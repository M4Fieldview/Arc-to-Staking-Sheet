// Renders the after-sync summary: what went where, and anything that couldn't be placed.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const attrText = (a) => Object.entries(a).filter(([k]) => k !== "HoleNo").map(([k, v]) => `${k}: ${v ?? "(blank)"}`).join(", ") || "(no attributes)";

export function renderReport(el, result, extraWarnings = []) {
  const { summary, noHole, unmatched, skippedRows } = result;
  const warn = [...extraWarnings];

  const noHoleTotal = noHole.reduce((s, x) => s + x.n, 0);
  if (noHoleTotal) {
    warn.push(`<strong>${noHoleTotal} staked feature${noHoleTotal === 1 ? " has" : "s have"} a blank HoleNo</strong>, so ${noHoleTotal === 1 ? "it isn't" : "they aren't"} counted on any hole:<ul>` +
      noHole.map((x) => `<li>${x.n} × ${esc(x.layer)} → ${esc(x.label)} (${esc(attrText(x.attrs))})</li>`).join("") + "</ul>");
  }
  const unmatchedTotal = unmatched.reduce((s, x) => s + x.n, 0);
  if (unmatchedTotal) {
    warn.push(`<strong>${unmatchedTotal} feature${unmatchedTotal === 1 ? "" : "s"} didn't match any column:</strong><ul>` +
      unmatched.map((x) => `<li>${x.n} × ${esc(x.layer)} (${esc(attrText(x.attrs))}, hole ${esc(x.attrs.HoleNo ?? "blank")})</li>`).join("") + "</ul>");
  }
  for (const s of summary) {
    if (s.skipped) warn.push(`Column ${esc(s.col)} (${esc(s.label)}) was skipped: ${esc(s.skipped)}.`);
    for (const [hole, n] of s.offSheet || []) warn.push(`${n} × ${esc(s.label)} on hole <strong>${esc(hole)}</strong>, which has no row on the sheet.`);
  }

  const rows = summary.filter((s) => !s.skipped).map((s) => {
    const holes = Object.entries(s.byHole).map(([h, n]) => `${esc(h.replace(/^HOLE\s*/i, "#"))}: ${n}`).join(" · ");
    const pct = s.design ? Math.round((s.staked / s.design) * 100) + "%" : "";
    return `<tr class="${s.staked ? "" : "muted"}"><td class="mono">${esc(s.sCol)}</td><td>${esc(s.label)}</td>` +
      `<td class="num">${s.staked}</td><td class="num">${s.design || ""}</td><td class="num">${pct}</td><td class="holes">${holes || "—"}</td></tr>`;
  }).join("");

  el.innerHTML =
    (warn.length ? `<div class="warn"><h3>Check these</h3>${warn.map((w) => `<div class="warn-item">${w}</div>`).join("")}</div>` : "") +
    `<table class="report"><thead><tr><th>S col</th><th>Material</th><th class="num">Staked</th><th class="num">Design</th><th class="num">%</th><th>By hole</th></tr></thead><tbody>${rows}</tbody></table>` +
    (skippedRows.length ? `<p class="note">Rows left alone (no matching HoleNo): ${skippedRows.map(esc).join(", ")}.</p>` : "");
}
