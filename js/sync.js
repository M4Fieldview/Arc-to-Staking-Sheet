// The sheet side of a sync, kept free of ArcGIS calls so it can be tested with saved counts.
import { openWorkbook, numToCol } from "./xlsx.js";
import { readMappingTab, mappingTable, findLayout, tally, writeStaked, classifyColumn, BLANK, AREA_GUESSES } from "./mapping.js";
import { readColumns, matchColumns } from "./headers.js";

export const DESIGN_TAB = "DESIGN TOTALS";
export const STAKING_TAB = "STAKING TOTALS";

/**
 * Opens the PM's workbook and works out its layout and mapping.
 * The design tab is read but never changed. Staked counts go on the STAKING TOTALS tab. Sheets made
 * before that tab existed get one: a copy of the design tab with its D and S numbers blanked (the PM
 * copies design numbers over hole by hole as work progresses). It takes the place of a blank
 * "INSTALLED TOTALS" tab if there is one.
 */
export async function prepareWorkbook(arrayBuffer) {
  const wb = await openWorkbook(arrayBuffer);
  const design = (await wb.sheet(DESIGN_TAB)) || (await wb.sheet(wb.sheetNames[0]));
  const layout = findLayout(design);
  let staking = await wb.sheet(STAKING_TAB);
  let created = null;
  if (!staking) {
    const legacyName = wb.sheetNames.find((n) => /^INSTALLED TOTALS/i.test(n.trim()));
    const legacy = legacyName ? await wb.sheet(legacyName) : null;
    const replace = legacy && legacy.typedNumberCount() === 0 ? legacyName : null;
    staking = await wb.addSheetCopy(design.name, STAKING_TAB, { replace });
    for (let c = 1; c <= 200; c++) {
      const col = numToCol(c);
      if (!/^[DS]$/i.test(staking.text(col + layout.headerRow))) continue;
      for (const a of layout.rows) staking.clearValue(col + a.row);
    }
    created = { replaced: replace };
  }
  const stakingLayout = findLayout(staking);
  let saved = null, savedError = null;
  try { saved = await readMappingTab(wb); } catch (e) { savedError = e.message; }
  return { wb, design, layout, staking, stakingLayout, created, columns: readColumns(design, layout), saved, savedError, mapping: [] };
}

const sameText = (a, b) => String(a ?? "").replace(/\s+/g, " ").trim().toLowerCase() === String(b ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * What each material column counts: the choice saved in the MAPPING tab by the last sync (if the
 * header hasn't changed and the layer is in this map), otherwise worked out from the header.
 * Returns review rows: { col, header, layer, filter | other, skip, status, note }.
 */
export function resolveMapping(ctx, catalog) {
  const titles = new Set(catalog.map((l) => l.title));
  return matchColumns(ctx.columns, catalog).map((m) => {
    const s = ctx.saved?.find((x) => x.col === m.col);
    if (!s || !sameText(s.label, m.header) || (!s.skip && !titles.has(s.layer))) return m;
    return { col: m.col, header: m.header, layer: s.skip ? null : s.layer, filter: s.filter || {}, other: !!s.other, skip: !!s.skip,
      status: "saved", note: "as chosen at the last sync" };
  });
}

/** The review rows that count something, in the shape the sheet code uses. */
export function toMapping(rows) {
  return rows.filter((r) => r.layer && !r.skip).map((r) => ({ col: r.col, label: r.header || r.col, layer: r.layer, filter: r.filter || {}, other: !!r.other }));
}

/** Saves the review rows in the hidden MAPPING tab so the next sync starts from them. */
export function saveMapping(ctx, rows) {
  return ctx.wb.writeTable("MAPPING", mappingTable(rows.map((r) => ({ ...r, label: r.header }))));
}

/** Puts the counts into the S columns of the staking tab. rowsByLayer = { layerTitle: [{HoleNo, ..., n}] } */
export function applyCounts(ctx, rowsByLayer) {
  const { design, layout, staking, stakingLayout, mapping } = ctx;
  const { counts, placed, noHole: allNoHole, unmatched } = tally(mapping, rowsByLayer);
  const guesses = guessAreaRows([layout, stakingLayout], counts, placed);
  const kinds = {};
  for (const m of mapping) kinds[m.col] ??= classifyColumn(design, layout, m.col).kind;

  // Blank-HoleNo features are counted in the ADJ row so the TOTAL matches what was staked.
  const noHoleCounts = {};
  for (const x of allNoHole) noHoleCounts[x.col] = (noHoleCounts[x.col] || 0) + x.n;
  const summary = writeStaked(staking, stakingLayout, mapping, counts, noHoleCounts, { sheet: design, layout });
  // Flag them, except in billed-in-total columns where the hole doesn't matter. `countedIn` says
  // which row they went to (null = no row to put them in, so they're not on the sheet).
  const where = Object.fromEntries(summary.map((s) => [s.col, s.noHoleLabel ?? null]));
  const noHole = allNoHole
    .map((x) => ({ ...x, countedIn: where[x.col] ?? null }))
    .filter((x) => kinds[x.col] !== "total" || !x.countedIn);

  // Staked features in a column the design doesn't call for at all: usually a collection mistake
  // (e.g. a wrong nozzle sending heads to "Other Sprinklers").
  const noDesign = placed.filter((p) => kinds[p.col] === "none");

  // In a column billed by hole: staked on a hole whose design is blank or 0. Usually a wrong HoleNo
  // or a wrong head/nozzle. Checked against the full design tab.
  const rowOf = Object.fromEntries(layout.rows.filter((a) => a.hole).map((a) => [a.hole, a]));
  const wrongHole = placed.filter((p) => {
    if (kinds[p.col] !== "hole" || !rowOf[p.hole]) return false;
    const d = design.value(p.col + rowOf[p.hole].row);
    return !(typeof d === "number" && d > 0);
  }).map((p) => ({ ...p, area: rowOf[p.hole].label }));

  // Unmatched because a field is blank and more than one column could take them (e.g. INF35 with no
  // nozzle, on a sheet with INF35-34 and INF35-35 columns): say which columns.
  const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";
  for (const x of unmatched) {
    const blanks = new Set();
    const could = mapping.filter((m) => m.layer === x.layer && !m.other && Object.entries(m.filter || {}).every(([f, vals]) => {
      if (isBlank(x.attrs[f])) { blanks.add(f); return true; }
      return vals.some((v) => v.toLowerCase() === String(x.attrs[f]).trim().toLowerCase());
    }));
    if (could.length > 1 && blanks.size) x.couldBe = { fields: [...blanks], labels: could.map((m) => m.label) };
  }

  // Features counted even though a field was blank (e.g. no nozzle, on the sheet's only column for that head type).
  const blankAccepted = {};
  for (const x of [...placed, ...allNoHole]) {
    const m = mapping.find((e) => e.col === x.col);
    for (const [f, vals] of Object.entries(m?.filter || {})) {
      const v = x.attrs[f];
      if (!vals.includes(BLANK) || (v !== null && v !== undefined && String(v).trim() !== "")) continue;
      const k = x.col + "|" + f;
      (blankAccepted[k] ??= { col: x.col, label: x.label, field: f, n: 0 }).n += x.n;
    }
  }

  // Bring the saved +/- and TOTAL results up to date (Protected View doesn't recalculate).
  const recalc = staking.recalc();
  return { summary, noHole, unmatched, noDesign, wrongHole, recalc, guesses, blankAccepted: Object.values(blankAccepted), skippedRows: stakingLayout.rows.filter((r) => !r.hole).map((r) => r.label) };
}

/**
 * Process of elimination for rows like "PRACTICE AREA": once every row with a clear code is matched,
 * the HoleNo codes the map uses that have no row go to the one row whose kind of area allows them
 * (AREA_GUESSES). If two rows could take a code, nobody gets it and it stays flagged as off the sheet.
 * Changes the layouts, counts and placed list in place. Returns [{ label, codes, n }].
 */
function guessAreaRows(layouts, counts, placed) {
  const [main] = layouts;
  const known = new Set(main.rows.map((a) => a.hole).filter(Boolean));
  const used = new Set(placed.map((p) => p.hole));
  const leftover = [...used].filter((c) => !known.has(c));
  const open = main.rows.filter((a) => !a.hole && a.row !== main.adjRow)
    .map((a) => ({ a, codes: AREA_GUESSES.find((g) => g.re.test(a.label))?.codes || [] }))
    .filter((x) => x.codes.length);
  const take = new Map();   // label -> codes
  for (const code of leftover) {
    const homes = open.filter((x) => x.codes.includes(code));
    if (homes.length !== 1) continue;
    const label = homes[0].a.label;
    take.set(label, [...(take.get(label) || []), code]);
  }
  const out = [];
  for (const [label, codes] of take) {
    codes.sort();
    const key = codes[0];
    for (const lay of layouts) {
      const row = lay.rows.find((a) => a.label === label && !a.hole);
      if (row) row.hole = key;
    }
    let n = 0;
    for (const p of placed) if (codes.includes(p.hole)) { n += p.n; p.hole = key; }
    for (const col of Object.keys(counts)) {
      for (const c of codes) {
        if (c === key || !counts[col][c]) continue;
        counts[col][key] = (counts[col][key] || 0) + counts[col][c];
        delete counts[col][c];
      }
    }
    out.push({ label, codes, n });
  }
  return out;
}

export function outputName(originalName) {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return originalName.replace(/\.xlsx$/i, "").replace(/ - staked \d{4}-\d{2}-\d{2}$/, "") + ` - staked ${stamp}.xlsx`;
}
