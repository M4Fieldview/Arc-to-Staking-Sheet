// The sheet side of a sync, kept free of ArcGIS calls so it can be tested with saved counts.
import { openWorkbook, numToCol } from "./xlsx.js";
import { DEFAULT_MAPPING, readMappingTab, findLayout, tally, writeStaked, classifyColumn } from "./mapping.js";

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
  const custom = await readMappingTab(wb);
  return {
    wb, design, layout, staking, stakingLayout, created,
    mapping: custom || DEFAULT_MAPPING,
    mappingSource: custom ? "MAPPING tab in this workbook" : "standard template mapping",
  };
}

/** Puts the counts into the S columns of the staking tab. rowsByLayer = { layerTitle: [{HoleNo, ..., n}] } */
export function applyCounts(ctx, rowsByLayer) {
  const { design, layout, staking, stakingLayout, mapping } = ctx;
  const { counts, placed, noHole: allNoHole, unmatched } = tally(mapping, rowsByLayer);
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

  // Bring the saved +/- and TOTAL results up to date (Protected View doesn't recalculate).
  const recalc = staking.recalc();
  return { summary, noHole, unmatched, noDesign, wrongHole, recalc, skippedRows: stakingLayout.rows.filter((r) => !r.hole).map((r) => r.label) };
}

export function outputName(originalName) {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return originalName.replace(/\.xlsx$/i, "").replace(/ - staked \d{4}-\d{2}-\d{2}$/, "") + ` - staked ${stamp}.xlsx`;
}
