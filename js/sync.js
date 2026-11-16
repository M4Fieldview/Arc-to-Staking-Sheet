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
  const { counts, noHole, unmatched } = tally(ctx.mapping, rowsByLayer);
  const summary = writeStaked(ctx.sheet, ctx.layout, ctx.mapping, counts);
  return { summary, noHole, unmatched, skippedRows: ctx.layout.rows.filter((r) => !r.hole).map((r) => r.label) };
}

export function outputName(originalName) {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return originalName.replace(/\.xlsx$/i, "") + ` - staked ${stamp}.xlsx`;
}
