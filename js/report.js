// Renders the after-sync summary: what went where, and anything that couldn't be placed.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const idText = (o) => !o || !o.total ? "" :
  `: <strong>${o.field}${o.total === 1 ? "" : "s"} ${o.ids.join(", ")}${o.total > o.ids.length ? ` +${o.total - o.ids.length} more` : ""}</strong>`;
const attrText = (a) => Object.entries(a).filter(([k]) => k !== "HoleNo").map(([k, v]) => `${k} ${v === null || v === undefined || String(v).trim() === "" ? "blank" : v}`).join(", ") || "no attributes";

export function renderReport(el, result, extraWarnings = []) {
  const { summary, noHole, unmatched, skippedRows } = result;
  const warn = [...extraWarnings];

  const plural = (n, one, many) => (n === 1 ? one : many);
  const counted = noHole.filter((x) => x.countedIn);
  const dropped = noHole.filter((x) => !x.countedIn);
  const countedTotal = counted.reduce((s, x) => s + x.n, 0);
  if (countedTotal) {
    warn.push(`<strong>${countedTotal} staked feature${plural(countedTotal, " has", "s have")} a blank HoleNo</strong>, so ${plural(countedTotal, "it was", "they were")} counted in the <strong>${esc(counted[0].countedIn)}</strong> row instead of on a hole. ` +
      `Fill in the HoleNo in Field Maps and re-run to move ${plural(countedTotal, "it", "them")} to the right hole:<ul>` +
      counted.map((x) => `<li>${x.n} × ${esc(x.layer)} under <em>${esc(x.label)}</em> (${esc(attrText(x.attrs))})${idText(x.oids)}</li>`).join("") + "</ul>");
  }
  const droppedTotal = dropped.reduce((s, x) => s + x.n, 0);
  if (droppedTotal) {
    warn.push(`<strong>${droppedTotal} staked feature${plural(droppedTotal, " has", "s have")} a blank HoleNo</strong> and ${plural(droppedTotal, "was", "were")} <strong>not added to the sheet</strong> (the sheet has no ADJ row to hold ${plural(droppedTotal, "it", "them")}). ` +
      `Fill in the HoleNo in Field Maps and re-run:<ul>` +
      dropped.map((x) => `<li>${x.n} × ${esc(x.layer)} under <em>${esc(x.label)}</em> (${esc(attrText(x.attrs))})${idText(x.oids)}</li>`).join("") + "</ul>");
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
  for (const x of unmatched.filter((u) => u.couldBe)) {
    warn.push(`<strong>${x.n} × ${esc(x.layer)} (${esc(attrText(x.attrs))}) ${x.n === 1 ? "isn't" : "aren't"} on the sheet:</strong> ` +
      `no ${esc(x.couldBe.fields.join(" or "))} was entered, so the tool can't tell whether ${x.n === 1 ? "it goes" : "they go"} under ` +
      `${x.couldBe.labels.map((l) => `<em>${esc(l)}</em>`).join(" or ")}. Fill in the ${esc(x.couldBe.fields.join(" and "))} in Field Maps and re-run${idText(x.oids)}`);
  }
  const plainUnmatched = unmatched.filter((u) => !u.couldBe);
  const unmatchedTotal = plainUnmatched.reduce((s, x) => s + x.n, 0);
  if (unmatchedTotal) {
    warn.push(`<strong>${unmatchedTotal} feature${unmatchedTotal === 1 ? "" : "s"} didn't match any column:</strong><ul>` +
      plainUnmatched.map((x) => `<li>${x.n} × ${esc(x.layer)} on hole ${esc(x.attrs.HoleNo ?? "blank")} (${esc(attrText(x.attrs))})${idText(x.oids)}</li>`).join("") + "</ul>");
  }
  for (const full of result.guesses || []) {
    // The spelled-out "Clubhouse" value going to a clubhouse row isn't a guess.
    const codes = full.codes.filter((c) => c !== "CLUBHOUSE");
    if (!codes.length) continue;
    const g = { ...full, codes, n: full.n - (full.byCode?.CLUBHOUSE || 0) };
    warn.push(`<strong>${esc(g.label)}</strong> got the ${g.n} feature${g.n === 1 ? "" : "s"} with HoleNo <strong>${g.codes.map(esc).join(" and ")}</strong>. ` +
      `That's a best guess: the sheet has no row named for ${g.codes.length === 1 ? "that code" : "those codes"}, and ${esc(g.label)} is the only row it could be.`);
  }
  for (const a of result.ambiguous || []) {
    warn.push(`<strong>${a.n} feature${a.n === 1 ? "" : "s"} with HoleNo ${esc(a.code)} ${a.n === 1 ? "isn't" : "aren't"} on the sheet:</strong> ` +
      `${esc(a.code)} could mean ${a.labels.map((l) => `<em>${esc(l)}</em>`).join(" or ")}, and the tool doesn't guess when more than one row fits. ` +
      `They're listed below as having no row; change their HoleNo in Field Maps or add the counts by hand.`);
  }
  for (const b of result.blankAccepted || []) {
    warn.push(`<strong>${b.n} under <em>${esc(b.label)}</em> had no ${esc(b.field)} entered.</strong> They were counted there because it's the sheet's only column for that head type.`);
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
    (skippedRows.length ? `<p class="note">Features with a blank HoleNo are counted in the ADJ (or Contingency) row's S cells, which are refilled on every sync, so make any by-hand staked adjustments there after your final sync. Other rows without a hole number (${skippedRows.filter((r) => !/^(ADJ|CONTINGENC)/i.test(r)).map(esc).join(", ") || "none"}) are left alone.</p>` : "");
}
