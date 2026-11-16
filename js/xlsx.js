// Minimal .xlsx reader/patcher.
// Only the cells we write are changed. Everything else in the workbook (styles, merged
// cells, formulas, other tabs) stays byte-for-byte as the PM made it. Requires global JSZip.

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

export function colToNum(col) {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
export function numToCol(n) {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
export function nextCol(col, by = 1) { return numToCol(colToNum(col) + by); }
function splitRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return { col: m[1], row: Number(m[2]) };
}

const parseXml = (text) => new DOMParser().parseFromString(text, "application/xml");
// Browsers keep the original <?xml ...?> line when serializing a parsed document. Only add one if it's missing.
const serialize = (doc) => {
  const s = new XMLSerializer().serializeToString(doc);
  return s.startsWith("<?xml") ? s : XML_DECL + s;
};
const children = (el, local) => [...el.children].filter((c) => c.localName === local);

export async function openWorkbook(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const read = async (p) => parseXml(await zip.file(p).async("string"));
  const wbDoc = await read("xl/workbook.xml");
  const relsDoc = await read("xl/_rels/workbook.xml.rels");
  const rels = {};
  for (const r of relsDoc.getElementsByTagName("Relationship")) rels[r.getAttribute("Id")] = r.getAttribute("Target");
  const sheets = [...wbDoc.getElementsByTagNameNS(NS, "sheet")].map((s) => {
    let target = rels[s.getAttributeNS(RNS, "id")];
    target = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
    return { name: s.getAttribute("name"), path: target };
  });
  let shared = [];
  if (zip.file("xl/sharedStrings.xml")) {
    const ss = await read("xl/sharedStrings.xml");
    shared = [...ss.getElementsByTagNameNS(NS, "si")].map((si) =>
      [...si.getElementsByTagNameNS(NS, "t")].map((t) => t.textContent).join(""));
  }
  return new Workbook(zip, wbDoc, sheets, shared);
}

class Workbook {
  constructor(zip, wbDoc, sheetList, shared) {
    this.zip = zip; this.wbDoc = wbDoc; this.sheetList = sheetList; this.shared = shared;
    this.loaded = new Map();
  }
  get sheetNames() { return this.sheetList.map((s) => s.name); }

  async sheet(name) {
    const info = this.sheetList.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (!info) return null;
    if (!this.loaded.has(info.path)) {
      const doc = parseXml(await this.zip.file(info.path).async("string"));
      this.loaded.set(info.path, new Sheet(this, info.name, info.path, doc));
    }
    return this.loaded.get(info.path);
  }

  /** Returns a Blob of the patched workbook. Excel recalculates every formula when it's opened. */
  async toBlob() {
    for (const sh of this.loaded.values()) {
      if (sh.dirty) this.zip.file(sh.path, serialize(sh.doc), { createFolders: false });
    }
    const root = this.wbDoc.documentElement;
    let calcPr = children(root, "calcPr")[0];
    if (!calcPr) {
      calcPr = this.wbDoc.createElementNS(NS, "calcPr");
      const after = ["oleSize", "customWorkbookViews", "pivotCaches", "smartTagPr", "smartTagTypes",
        "webPublishing", "fileRecoveryPr", "webPublishObjects", "extLst"];
      const before = [...root.children].find((c) => after.includes(c.localName));
      root.insertBefore(calcPr, before || null);
    }
    calcPr.setAttribute("fullCalcOnLoad", "1");
    this.zip.file("xl/workbook.xml", serialize(this.wbDoc), { createFolders: false });
    return this.zip.generateAsync({
      type: "blob", compression: "DEFLATE",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }
}

class Sheet {
  constructor(wb, name, path, doc) {
    this.wb = wb; this.name = name; this.path = path; this.doc = doc; this.dirty = false;
    this.sheetData = doc.getElementsByTagNameNS(NS, "sheetData")[0];
  }

  get maxRow() {
    const rows = children(this.sheetData, "row");
    return rows.length ? Number(rows[rows.length - 1].getAttribute("r")) : 0;
  }

  _row(r, create) {
    for (const row of children(this.sheetData, "row")) {
      const n = Number(row.getAttribute("r"));
      if (n === r) return row;
      if (n > r) {
        if (!create) return null;
        const el = this.doc.createElementNS(NS, "row");
        el.setAttribute("r", String(r));
        this.sheetData.insertBefore(el, row);
        return el;
      }
    }
    if (!create) return null;
    const el = this.doc.createElementNS(NS, "row");
    el.setAttribute("r", String(r));
    this.sheetData.appendChild(el);
    return el;
  }

  _cell(ref, create) {
    const { col, row } = splitRef(ref);
    const rowEl = this._row(row, create);
    if (!rowEl) return null;
    const target = colToNum(col);
    for (const c of children(rowEl, "c")) {
      const n = colToNum(splitRef(c.getAttribute("r")).col);
      if (n === target) return c;
      if (n > target) {
        if (!create) return null;
        const el = this.doc.createElementNS(NS, "c");
        el.setAttribute("r", ref);
        rowEl.insertBefore(el, c);
        rowEl.removeAttribute("spans");
        return el;
      }
    }
    if (!create) return null;
    const el = this.doc.createElementNS(NS, "c");
    el.setAttribute("r", ref);
    rowEl.appendChild(el);
    rowEl.removeAttribute("spans");
    return el;
  }

  /** Cell value as shown (shared/inline strings resolved, cached formula results). */
  value(ref) {
    const c = this._cell(ref, false);
    if (!c) return null;
    const t = c.getAttribute("t");
    const v = children(c, "v")[0];
    if (t === "s") return v ? this.wb.shared[Number(v.textContent)] : null;
    if (t === "inlineStr") return [...c.getElementsByTagNameNS(NS, "t")].map((x) => x.textContent).join("");
    if (!v) return null;
    if (t === "str" || t === "e") return v.textContent;
    if (t === "b") return v.textContent === "1";
    const n = Number(v.textContent);
    return Number.isNaN(n) ? v.textContent : n;
  }

  text(ref) {
    const v = this.value(ref);
    return v === null || v === undefined ? "" : String(v).trim();
  }

  hasFormula(ref) {
    const c = this._cell(ref, false);
    return !!(c && children(c, "f").length);
  }

  /** Writes a number, keeping the cell's style (or borrowing styleFromRef's style for a brand-new cell). */
  setNumber(ref, num, styleFromRef) {
    const existed = !!this._cell(ref, false);
    const c = this._cell(ref, true);
    if (!existed && styleFromRef) {
      const s = this._cell(styleFromRef, false)?.getAttribute("s");
      if (s) c.setAttribute("s", s);
    }
    c.removeAttribute("t");
    while (c.firstChild) c.removeChild(c.firstChild);
    const v = this.doc.createElementNS(NS, "v");
    v.textContent = String(num);
    c.appendChild(v);
    this.dirty = true;
  }
}
