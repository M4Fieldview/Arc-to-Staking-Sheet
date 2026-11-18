// Works out what each material column counts by reading its header ("Toro FLX34-34", "RB 752-36",
// '8" Mainline Valve') and matching it against the dropdown lists of the chosen web map's layers.
// There's no master list of head/nozzle combos: the map's own HeadType/Nozzle/Size dropdowns are the list.
import { nextCol } from "./xlsx.js";

// Words in a header that name a brand. A header without one gets its brand from whichever
// head layer has the head type in its dropdown (702 is only in Rain Bird's list).
const BRANDS = [
  { key: "TORO", re: /\bTORO\b/ },
  { key: "RAINBIRD", re: /\bRAIN\s*BIRD\b|\bRB\b/ },
  { key: "HUNTER", re: /\bHUNTER\b/ },
];
// Header wording -> the layer name used in our web maps.
const SYNONYMS = [
  [/\bMAIN\s*LINE\b(?=.*\bVALVE)|\bISO\b|\bGATE\b(?=.*\bVALVE)/g, "ISOLATION"],
  [/\bQCV?\b/g, "QUICK COUPLER"],
  [/\bARV\b/g, "AIR RELIEF VALVE"],
  [/\bRCV\b|\bREMOTE CONTROL\b|\bSOLENOID\b/g, "ELECTRIC"],
];
const NOT_A_HEAD_LAYER = /\bEXISTING\b/;

const up = (s) => String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
const compact = (s) => up(s).replace(/[^A-Z0-9.]/g, "");
const singular = (w) => (w.length > 3 && w.endsWith("S") && !w.endsWith("SS") ? w.slice(0, -1) : w);
const words = (s) => up(s).split(/[^A-Z0-9]+/).filter(Boolean).map(singular);

/** The material columns of the design tab: every D/S pair that has a material name above it. */
export function readColumns(sheet, layout) {
  const out = [];
  for (let c = 1; c <= 200; c++) {
    const col = colName(c);
    if (sheet.text(col + layout.headerRow).toUpperCase() !== "D") continue;
    if (sheet.text(nextCol(col) + layout.headerRow).toUpperCase() !== "S") continue;
    let header = "";
    for (let r = layout.headerRow - 1; r >= 1 && !header; r--) header = sheet.text(col + r);
    header = header.replace(/\s+/g, " ").trim();
    if (header) out.push({ col, header });   // spare columns with no material name are ignored
  }
  return out;
}
function colName(n) { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

/**
 * schemas = { layerTitle: { fields: [{ name, domain? }] } } (the layer JSON from ArcGIS).
 * Returns the layers with their dropdown lists and the fields that matter here.
 */
export function buildCatalog(schemas) {
  return Object.entries(schemas).map(([title, s]) => {
    const fields = (s.fields || []).map((f) => ({
      name: f.name,
      values: f.domain?.type === "codedValue" ? f.domain.codedValues.map((v) => String(v.code)) : null,
    }));
    const find = (re) => fields.find((f) => re.test(f.name));
    const headField = find(/^head_?type$/i);
    const T = up(title);
    return {
      title, fields,
      headField, nozzleField: find(/^nozzle$/i),
      sizeField: fields.find((f) => /size/i.test(f.name) && f.values) || find(/^size$/i),
      isHead: !!headField && /\bHEAD\b/.test(T) && !NOT_A_HEAD_LAYER.test(T),
      brand: BRANDS.find((b) => compact(T).includes(b.key))?.key || null,
      words: words(title),
    };
  });
}

// "INF34" -> {core:"INF34"}; "I-20-06 Rotor" -> "I2006"; "702 Block" -> "702" + block.
function headCore(v) {
  const U = up(v);
  return { core: compact(U.replace(/\b(ROTOR|SPRAY|BLOCK|HEAD)\b/g, "")).replace(/\./g, ""), block: /\bBLOCK\b/.test(U) };
}

// Possible (model, nozzle) readings of a header: "INF 35-35" -> INF35 / 35, "702-32" -> 702 / 32,
// "I20" -> I20 / none. Tokens next to each other are also tried joined ("INF 35-35").
function headReadings(H) {
  const toks = H.split(" ").filter(Boolean);
  const pieces = new Set();
  for (let i = 0; i < toks.length; i++) { pieces.add(toks[i]); if (i + 1 < toks.length) pieces.add(toks[i] + toks[i + 1]); }
  const out = [];
  for (const p of pieces) {
    const t = p.replace(/[^A-Z0-9-]/g, "");
    if (!/\d/.test(t)) continue;
    out.push({ model: t.replace(/-/g, ""), nozzle: null, raw: t });
    const parts = t.split("-");
    for (let i = 1; i < parts.length; i++) {
      const nozzle = parts.slice(i).join("");
      if (/^\d{2,4}$/.test(nozzle)) out.push({ model: parts.slice(0, i).join(""), nozzle, raw: t });
    }
  }
  return out.filter((r) => r.model.length >= 2 && /\d/.test(r.model));
}

function matchHead(H, catalog) {
  const brand = BRANDS.find((b) => b.re.test(H))?.key || null;
  const block = /\bBLOCK\b/.test(H);
  const Hn = H.replace(/\bRAIN\s*BIRD\b|\bRB\b|\bTORO\b|\bHUNTER\b/g, " ").replace(/\s+/g, " ").trim();
  const readings = headReadings(Hn);
  let layers = catalog.filter((l) => l.isHead);
  const branded = brand ? layers.filter((l) => l.brand === brand) : [];
  if (brand && branded.length) layers = branded;

  const hits = [];   // { layer, values, nozzle, score, model }
  for (const l of layers) {
    const vals = (l.headField.values || []);
    for (const r of readings) {
      // Older layers keep the nozzle inside the head type ("752-20 F") and have no Nozzle field.
      if (!l.nozzleField && r.nozzle) {
        const v = vals.filter((x) => compact(x).replace(/\./g, "").startsWith(r.model + r.nozzle));
        if (v.length) hits.push({ layer: l, values: v, nozzle: null, score: 3, model: r.model });
        continue;
      }
      const exact = vals.filter((x) => { const h = headCore(x); return h.core === r.model && h.block === block; });
      if (exact.length) {
        let score = r.nozzle ? 3 : 2;
        let nozzleNote = null;
        if (r.nozzle && l.nozzleField?.values && !l.nozzleField.values.includes(r.nozzle)) { score = 2.5; nozzleNote = r.nozzle; }
        if (r.nozzle && !l.nozzleField) score = 1.5;
        hits.push({ layer: l, values: exact, nozzle: r.nozzle, score, model: r.model, nozzleNote });
        continue;
      }
      // A family: "I20" covers I-20-04 and I-20-06.
      if (!r.nozzle && r.model.length >= 3) {
        const fam = vals.filter((x) => { const h = headCore(x); return h.core.startsWith(r.model) && /^\d/.test(h.core.slice(r.model.length)) && h.block === block; });
        if (fam.length) hits.push({ layer: l, values: fam, nozzle: null, score: 1, model: r.model, family: true });
      }
    }
  }
  if (!hits.length) {
    if (brand && branded.length && readings.length)
      return { status: "check", note: `couldn't find "${readings[0].raw}" in the ${branded.map((l) => l.title).join(" / ")} head type list` };
    return null;
  }
  const top = Math.max(...hits.map((h) => h.score));
  let best = hits.filter((h) => h.score === top);
  const longest = Math.max(...best.map((h) => h.model.length));
  best = best.filter((h) => h.model.length === longest);
  const byLayer = [...new Set(best.map((h) => h.layer))];
  if (byLayer.length > 1) {
    return { status: "check", note: `"${best[0].model}" is a head type in more than one layer (${byLayer.map((l) => l.title).join(", ")}); add the brand to the header or pick one` };
  }
  const h = best[0];
  const l = h.layer;
  const filter = { [l.headField.name]: [...new Set(best.flatMap((b) => b.values))] };
  if (h.nozzle && l.nozzleField) filter[l.nozzleField.name] = [h.nozzle];
  const notes = [];
  if (!brand) notes.push(`brand worked out from the head type (${h.model} is a ${l.title.replace(/\s*Head$/i, "")} head)`);
  if (h.family) notes.push(`counts every ${filter[l.headField.name].join(" / ")}`);
  let status = "ok";
  if (h.nozzleNote) { status = "check"; notes.push(`nozzle ${h.nozzleNote} isn't in the ${l.title} nozzle list`); }
  if (h.nozzle && !l.nozzleField) { status = "check"; notes.push(`${l.title} has no Nozzle field, so the nozzle can't be checked`); }
  return { layer: l.title, filter, status, note: notes.join("; ") || null, isHead: true };
}

// '8" Mainline Valve' -> 8; '1.5 electric valve' -> 1.5 (a bare number only if it's in the layer's size list).
function sizeValues(H, field) {
  const fmt = (n) => { const s = String(n); return [s + '"', (n < 10 ? "0" + s.replace(/^0(?=\.)/, "") : s) + '"', s.replace(/^0(?=\.)/, "") + '"']; };
  const num = (v) => parseFloat(String(v).replace(/[^0-9.]/g, ""));
  const quoted = /(\d*\.?\d+)\s*(?:"|''|”|IN\b|INCH)/.exec(H);
  let n = quoted ? Number(quoted[1]) : null;
  if (n === null && field?.values) {
    for (const m of H.matchAll(/(?:^| )(\d*\.?\d+)(?= |$)/g)) {
      if (field.values.some((v) => num(v) === Number(m[1]))) { n = Number(m[1]); break; }
    }
  }
  if (n === null) return { n: null };
  if (!field?.values) return { n, values: null };
  const inList = field.values.filter((v) => num(v) === n);
  return { n, values: [...new Set([...inList, ...fmt(n)])], inList: inList.length > 0 };
}

function matchEquipment(H, catalog) {
  let S = H;
  for (const [re, rep] of SYNONYMS) S = S.replace(re, rep);
  const have = new Set(words(S));
  const fits = catalog.filter((l) => !l.isHead && l.words.length && l.words.every((w) => have.has(w)));
  if (!fits.length) return null;
  const most = Math.max(...fits.map((l) => l.words.length));
  const best = fits.filter((l) => l.words.length === most);
  if (best.length > 1) return { status: "check", note: `could be ${best.map((l) => l.title).join(" or ")}` };
  const l = best[0];
  const filter = {};
  const notes = [];
  let status = "ok";
  const size = sizeValues(H, l.sizeField);
  if (size.n !== null && l.sizeField?.values) {
    filter[l.sizeField.name] = size.values;
    if (!size.inList) { status = "check"; notes.push(`${size.n}" isn't in the ${l.title} size list`); }
  } else if (size.n !== null) {
    notes.push(`${l.title} has no size list, so every size is counted`);
  }
  return { layer: l.title, filter, status, note: notes.join("; ") || null };
}

/**
 * Matches every column. Returns [{ col, header, layer, filter | other, status, note }] where
 * status is "ok", "check" (counted, but worth a look) or "none" (not counted until the PM picks a layer).
 */
export function matchColumns(columns, catalog) {
  const out = columns.map(({ col, header }) => {
    const H = up(header).replace(/[“”]/g, '"');
    if (!H) return { col, header, status: "none", note: "no header" };
    if (/\bOTHER\b/.test(H)) return { col, header, pendingOther: true, H };
    const head = matchHead(H, catalog);
    const m = head?.layer ? head : matchEquipment(H, catalog) || head;
    if (!m) return { col, header, status: "none", note: "couldn't tell what this column counts" };
    if (!m.layer) return { col, header, status: "none", note: m.note };
    return { col, header, ...m };
  });
  // "Other Sprinklers": whatever no other column claimed, in the brand's head layer, or in the
  // head layer the other head columns use.
  for (const o of out.filter((x) => x.pendingOther)) {
    const brand = BRANDS.find((b) => b.re.test(o.H))?.key;
    let layer = brand ? catalog.find((l) => l.isHead && l.brand === brand)?.title : null;
    let note = null;
    if (!layer) {
      const used = out.filter((x) => x.isHead && x.layer).map((x) => x.layer);
      const tally = {};
      for (const t of used) tally[t] = (tally[t] || 0) + 1;
      const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
      layer = ranked[0]?.[0] || null;
      if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
        layer = null;
        note = `the sheet has as many ${ranked[0][0]} columns as ${ranked[1][0]} columns; add the brand to the header or pick one`;
      }
    }
    delete o.pendingOther; delete o.H;
    if (!layer) Object.assign(o, { status: "none", note: note || "couldn't tell which head layer this is for" });
    else Object.assign(o, { layer, other: true, status: "ok", note: brand ? null : `the sheet's other head columns are ${layer}` });
  }
  return out;
}

/** Plain-language description of what a mapping row counts. */
export function describe(m) {
  if (!m.layer || m.skip) return "Not counted";
  if (m.other) return `${m.layer}: every feature no other column counts`;
  const parts = Object.entries(m.filter || {}).map(([f, v]) => `${f} ${v.join(" or ")}`);
  return `${m.layer}${parts.length ? ": " + parts.join(", ") : ": every feature"}`;
}
