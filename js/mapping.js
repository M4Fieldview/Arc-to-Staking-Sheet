// Which ArcGIS layer + attribute filter feeds each sheet column, and how sheet rows map to HoleNo codes.
import { nextCol } from "./xlsx.js";

// Standard layout of the irrigation hole-summary template ("DESIGN TOTALS" tab).
// `col` is the D (design) column of each material; S = the next column, +/- the one after.
// Filters: field -> list of accepted values. `other: true` = every feature in that layer
// that no other column for the same layer claimed.
export const DEFAULT_MAPPING = [
  { col: "C",  label: 'Toro INF34-33 Sprinkler',           layer: "Toro Head",        filter: { HeadType: ["INF34"], Nozzle: ["33"] } },
  { col: "F",  label: 'Toro INF34-35 Sprinkler',           layer: "Toro Head",        filter: { HeadType: ["INF34"], Nozzle: ["35"] } },
  { col: "I",  label: 'Toro INF35-35 Sprinkler',           layer: "Toro Head",        filter: { HeadType: ["INF35"], Nozzle: ["35"] } },
  { col: "L",  label: 'Other Sprinklers',                  layer: "Toro Head",        other: true },
  { col: "O",  label: 'Toro 474-01 Quick Coupler',         layer: "Quick Coupler",    filter: {} },
  { col: "R",  label: 'Toro 1" Electric Valve',            layer: "Electric Valve",   filter: { Size: ['1"'] } },
  { col: "U",  label: '12" Mainline Valve',                layer: "Isolation Valve",  filter: { Size: ['12"'] } },
  { col: "X",  label: '10" Mainline Valve',                layer: "Isolation Valve",  filter: { Size: ['10"'] } },
  { col: "AA", label: '8" Mainline Valve',                 layer: "Isolation Valve",  filter: { Size: ['08"', '8"'] } },
  { col: "AD", label: '6" Mainline Valve',                 layer: "Isolation Valve",  filter: { Size: ['06"', '6"'] } },
  { col: "AG", label: '4" Mainline Valve',                 layer: "Isolation Valve",  filter: { Size: ['04"', '4"'] } },
  { col: "AJ", label: '3" Lateral Poly Valve',             layer: "Lateral Valve",    filter: { Size: ['3"'] } },
  { col: "AM", label: '3" RW Drain Valve',                 layer: "Drain Valve",      filter: { Size: ['3"'] } },
  { col: "AP", label: '2" Air Relief Valve',               layer: "Air Relief Valve", filter: {} },
  { col: "AS", label: 'Hunter I20 temp Irrigation',        layer: "Hunter Head",      filter: { HeadType: ["I-20-04 Rotor", "I-20-06 Rotor"] } },
  { col: "AV", label: '1.5" Electric Valve Temp Irrigation', layer: "Electric Valve", filter: { Size: ['1.5"'] } },
];

export const HOLE_FIELD = "HoleNo";
export const HOLE_CODES = [...Array.from({ length: 18 }, (_, i) => String(i + 1).padStart(2, "0")), "CH", "SG", "PG", "CG", "DR"];
const AREA_ALIASES = { "SHORT GAME": "SG", "CLUBHOUSE": "CH", "CLUB HOUSE": "CH", "DRIVING RANGE": "DR", "RANGE": "DR" };

/** "HOLE 7 " -> "07", "SHORT GAME" -> "SG", "DR" -> "DR", "ADJ" -> null (not synced). */
export function areaToHole(label) {
  const t = String(label ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!t) return null;
  const m = /^(?:HOLE|H|#)\s*#?\s*(\d{1,2})$/.exec(t) || /^(\d{1,2})$/.exec(t);
  if (m) return String(Number(m[1])).padStart(2, "0");
  const code = AREA_ALIASES[t] || t;
  return HOLE_CODES.includes(code) ? code : null;
}

/**
 * Optional MAPPING tab in the workbook overrides the default. Layout (row 1 = headers):
 *   Column | Label | Layer | Filter
 *   C      | Toro INF34-33 | Toro Head | HeadType=INF34; Nozzle=33
 *   L      | Other Sprinklers | Toro Head | OTHER
 * Filter: blank or * = every feature in the layer; OTHER = whatever no other column claimed;
 * several values for one field are separated with |  (e.g. Size=08"|8").
 */
export async function readMappingTab(wb) {
  const sh = await wb.sheet("MAPPING");
  if (!sh) return null;
  const header = ["A", "B", "C", "D"].map((c) => sh.text(c + "1").toLowerCase());
  const idx = (name) => header.indexOf(name);
  if (idx("column") < 0 || idx("layer") < 0) throw new Error('The MAPPING tab needs header cells "Column" and "Layer" in row 1 (plus optional "Label" and "Filter").');
  const cols = ["A", "B", "C", "D"];
  const out = [];
  for (let r = 2; r <= sh.maxRow; r++) {
    const get = (name) => (idx(name) >= 0 ? sh.text(cols[idx(name)] + r) : "");
    const col = get("column").toUpperCase();
    const layer = get("layer");
    if (!col || !layer) continue;
    if (!/^[A-Z]{1,3}$/.test(col)) throw new Error(`MAPPING row ${r}: "${col}" is not a column letter.`);
    out.push({ col, label: get("label") || col, layer, ...parseFilter(get("filter"), r) });
  }
  if (!out.length) throw new Error("The MAPPING tab has no rows.");
  return out;
}

export function parseFilter(text, rowForErrors = "?") {
  const t = String(text ?? "").trim();
  if (!t || t === "*" || t.toUpperCase() === "ALL") return { filter: {} };
  if (t.toUpperCase() === "OTHER") return { other: true };
  const filter = {};
  for (const part of t.split(";").map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    if (eq < 1) throw new Error(`MAPPING row ${rowForErrors}: can't read filter "${part}" (expected Field=Value).`);
    filter[part.slice(0, eq).trim()] = part.slice(eq + 1).split("|").map((v) => v.trim());
  }
  return { filter };
}

/** Field names each layer must be grouped by (HoleNo + every field its filters use). */
export function fieldsByLayer(mapping) {
  const out = {};
  for (const m of mapping) {
    out[m.layer] ??= new Set([HOLE_FIELD]);
    for (const f of Object.keys(m.filter || {})) out[m.layer].add(f);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}

const norm = (v) => (v === null || v === undefined ? null : String(v).trim());

function matches(entry, attrsLower) {
  return Object.entries(entry.filter || {}).every(([field, values]) => {
    const v = norm(attrsLower[field.toLowerCase()]);
    return v !== null && values.some((x) => x.toLowerCase() === v.toLowerCase());
  });
}

/**
 * rowsByLayer: { layerTitle: [ {<grouped attributes>, n: count}, ... ] }
 * Returns counts[col][holeCode] plus everything that could not be placed.
 */
export function tally(mapping, rowsByLayer) {
  const counts = {};
  const placed = [];     // every group that was counted: { layer, col, label, hole, attrs, n }
  const noHole = [];     // matched a column, but HoleNo blank
  const unmatched = [];  // in a mapped layer, but no column claimed it
  for (const [layer, rows] of Object.entries(rowsByLayer)) {
    const entries = mapping.filter((m) => m.layer === layer);
    const specific = entries.filter((m) => !m.other);
    const other = entries.find((m) => m.other);
    for (const row of rows) {
      const lower = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]));
      const n = Number(row.n ?? lower.n ?? 0);
      const entry = specific.find((m) => matches(m, lower)) || other;
      const attrs = Object.fromEntries(Object.entries(row).filter(([k]) => k.toLowerCase() !== "n"));
      if (!entry) { unmatched.push({ layer, attrs, n }); continue; }
      const hole = norm(lower[HOLE_FIELD.toLowerCase()]);
      if (!hole) { noHole.push({ layer, col: entry.col, label: entry.label, attrs, n }); continue; }
      counts[entry.col] ??= {};
      counts[entry.col][hole.toUpperCase()] = (counts[entry.col][hole.toUpperCase()] || 0) + n;
      placed.push({ layer, col: entry.col, label: entry.label, hole: hole.toUpperCase(), attrs, n });
    }
  }
  return { counts, placed, noHole, unmatched };
}

/** Finds the header row ("Area" / D / S) and the area rows on the sheet. */
export function findLayout(sheet) {
  let headerRow = null, areaCol = null;
  for (let r = 1; r <= Math.min(sheet.maxRow, 40) && !headerRow; r++) {
    for (const c of ["A", "B", "C"]) {
      if (sheet.text(c + r).toLowerCase() === "area") { headerRow = r; areaCol = c; break; }
    }
  }
  if (!headerRow) throw new Error(`Couldn't find the "Area" header cell on tab "${sheet.name}".`);
  const rows = [];
  for (let r = headerRow + 1; r <= sheet.maxRow; r++) {
    const label = sheet.text(areaCol + r);
    if (label.toUpperCase().startsWith("TOTAL")) break;
    if (!label) continue;
    rows.push({ row: r, label, hole: areaToHole(label) });
  }
  // The ADJ (adjustments) row: where features with a blank HoleNo are counted.
  const adjRow = rows.find((a) => !a.hole && /^ADJ/i.test(a.label))?.row ?? null;
  return { headerRow, areaCol, rows, adjRow };
}

/**
 * Writes the S column for every mapped material. Returns a per-column summary.
 * A cell gets the count when something was staked there. Empty cells stay empty when nothing
 * was staked; a cell that already held a number is reset to 0 so a re-sync never leaves a stale value.
 * Features with a blank HoleNo are counted in the ADJ row's S cell, which the tool owns (it's
 * rewritten every sync). Without an ADJ row, a billed-in-total column uses the row holding its
 * design total; otherwise they're left off. Other rows without a hole code are never touched.
 *
 * Column kinds (read from the D column):
 *   "hole"  - design quantities on individual hole rows (billed by hole)
 *   "total" - no hole row has a quantity; the design sits in a non-hole row such as ADJ (billed in total)
 *   "none"  - no design quantity anywhere
 */
export function classifyColumn(sheet, layout, dCol) {
  let holeQty = 0, otherQty = 0, totalRow = null;
  for (const a of layout.rows) {
    const d = sheet.value(dCol + a.row);
    if (typeof d !== "number" || d === 0) continue;
    if (a.hole) holeQty += d;
    else { otherQty += d; totalRow ??= a.row; }
  }
  if (holeQty) return { kind: "hole" };
  if (otherQty) return { kind: "total", totalRow };
  return { kind: "none" };
}

export function writeStaked(sheet, layout, mapping, counts, noHoleCounts = {}) {
  const summary = [];
  const seenCols = new Set();
  for (const m of mapping) {
    if (seenCols.has(m.col)) continue;   // two mapping rows feeding one column: counts already combined
    seenCols.add(m.col);
    const sCol = nextCol(m.col);
    const hD = sheet.text(m.col + layout.headerRow).toUpperCase();
    const hS = sheet.text(sCol + layout.headerRow).toUpperCase();
    if (hD !== "D" || hS !== "S") {
      summary.push({ ...m, sCol, skipped: `header row shows "${hD}"/"${hS}" instead of D/S` });
      continue;
    }
    let staked = 0, design = 0;
    const byHole = {};
    const colCounts = counts[m.col] || {};
    const { kind, totalRow } = classifyColumn(sheet, layout, m.col);
    const unholed = noHoleCounts[m.col] || 0;
    const noHoleRow = layout.adjRow ?? (kind === "total" ? totalRow : null);
    const noHoleLabel = noHoleRow ? layout.rows.find((a) => a.row === noHoleRow).label : null;
    if (noHoleRow) {
      const current = sheet.value(sCol + noHoleRow);
      if (unholed > 0 || (current !== null && current !== "")) {
        sheet.setNumber(sCol + noHoleRow, unholed, m.col + noHoleRow);
      }
      if (unholed) { byHole[`${noHoleLabel} (no HoleNo)`] = unholed; staked += unholed; }
    }
    for (const a of layout.rows) {
      const d = sheet.value(m.col + a.row);
      if (typeof d === "number") design += d;
      if (!a.hole) continue;
      const n = colCounts[a.hole] || 0;
      const current = sheet.value(sCol + a.row);
      if (n > 0 || (current !== null && current !== "")) {
        sheet.setNumber(sCol + a.row, n, m.col + a.row);
        if (n) byHole[a.label] = n;
        staked += n;
      }
    }
    const onSheet = new Set(layout.rows.map((a) => a.hole).filter(Boolean));
    const offSheet = Object.entries(colCounts).filter(([h]) => !onSheet.has(h));
    summary.push({ ...m, sCol, staked, design, byHole, offSheet, kind, unholed, noHoleLabel });
  }
  return summary;
}

export function labelsFor(mapping) {
  return mapping.map((m) => ({ col: m.col, s: nextCol(m.col), label: m.label }));
}
