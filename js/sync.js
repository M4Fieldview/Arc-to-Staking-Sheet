// The sheet side of a sync, kept free of ArcGIS calls so it can be tested with saved counts.
import { openWorkbook } from "./xlsx.js";
import { DEFAULT_MAPPING, readMappingTab, findLayout, tally, writeStaked } from "./mapping.js";

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
  const { counts, placed, noHole, unmatched } = tally(ctx.mapping, rowsByLayer);
  const summary = writeStaked(ctx.sheet, ctx.layout, ctx.mapping, counts);
  // Staked features in a column the design doesn't call for at all: usually a collection mistake
  // (e.g. a wrong nozzle sending heads to "Other Sprinklers").
  const noDesignCols = new Set(summary.filter((s) => !s.skipped && s.staked > 0 && !s.design).map((s) => s.col));
  const noDesign = placed.filter((p) => noDesignCols.has(p.col));
  // Bring the saved +/- and TOTAL results up to date (Protected View doesn't recalculate).
  const recalc = ctx.sheet.recalc();
  return { summary, noHole, unmatched, noDesign, recalc, skippedRows: ctx.layout.rows.filter((r) => !r.hole).map((r) => r.label) };
}

export function outputName(originalName) {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return originalName.replace(/\.xlsx$/i, "") + ` - staked ${stamp}.xlsx`;
}
