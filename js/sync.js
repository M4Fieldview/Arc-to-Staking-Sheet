// The sheet side of a sync, kept free of ArcGIS calls so it can be tested with saved counts.
import { openWorkbook } from "./xlsx.js";
import { DEFAULT_MAPPING, readMappingTab, findLayout, tally, writeStaked, classifyColumn } from "./mapping.js";

export const DESIGN_TAB = "DESIGN TOTALS";

/** Opens the PM's workbook and works out its layout and mapping. */
export async function prepareWorkbook(arrayBuffer) {
  const wb = await openWorkbook(arrayBuffer);
  const sheet = (await wb.sheet(DESIGN_TAB)) || (await wb.sheet(wb.sheetNames[0]));
  const layout = findLayout(sheet);
  const custom = await readMappingTab(wb);
  return {
    wb, sheet, layout,
    mapping: custom || DEFAULT_MAPPING,
    mappingSource: custom ? "MAPPING tab in this workbook" : "standard template mapping",
  };
}

/** Puts the counts into the S columns. rowsByLayer = { layerTitle: [{HoleNo, ..., n}] } */
export function applyCounts(ctx, rowsByLayer) {
  const { sheet, layout, mapping } = ctx;
  const { counts, placed, noHole: allNoHole, unmatched } = tally(mapping, rowsByLayer);
  const kinds = {};
  for (const m of mapping) kinds[m.col] ??= classifyColumn(sheet, layout, m.col).kind;

  // In a column billed in total, the hole doesn't matter: blank-HoleNo features still count.
  const noHoleCounts = {};
  const noHole = [];
  for (const x of allNoHole) {
    if (kinds[x.col] === "total") noHoleCounts[x.col] = (noHoleCounts[x.col] || 0) + x.n;
    else noHole.push(x);
  }
  const summary = writeStaked(sheet, layout, mapping, counts, noHoleCounts);

  // Staked features in a column the design doesn't call for at all: usually a collection mistake
  // (e.g. a wrong nozzle sending heads to "Other Sprinklers").
  const noDesign = placed.filter((p) => kinds[p.col] === "none");

  // In a column billed by hole: staked on a hole whose design is blank or 0. Usually a wrong HoleNo
  // or a wrong head/nozzle.
  const rowOf = Object.fromEntries(layout.rows.filter((a) => a.hole).map((a) => [a.hole, a]));
  const wrongHole = placed.filter((p) => {
    if (kinds[p.col] !== "hole" || !rowOf[p.hole]) return false;
    const d = sheet.value(p.col + rowOf[p.hole].row);
    return !(typeof d === "number" && d > 0);
  }).map((p) => ({ ...p, area: rowOf[p.hole].label }));

  // Bring the saved +/- and TOTAL results up to date (Protected View doesn't recalculate).
  const recalc = sheet.recalc();
  return { summary, noHole, unmatched, noDesign, wrongHole, recalc, skippedRows: layout.rows.filter((r) => !r.hole).map((r) => r.label) };
}

export function outputName(originalName) {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return originalName.replace(/\.xlsx$/i, "") + ` - staked ${stamp}.xlsx`;
}
