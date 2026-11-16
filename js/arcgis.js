// ArcGIS sign-in (OAuth popup via Esri's arcgis-rest-js) and the few REST calls the tool needs.
// Requires global `arcgisRest` and window.APP_CONFIG (config.js).
import { HOLE_FIELD } from "./mapping.js";

const cfg = () => window.APP_CONFIG;
const SESSION_KEY = "arc-to-staking-sheet-session";
export const redirectUri = () => new URL("oauth-callback.html", window.location.href).href;

export function restoreSession() {
  try {
    const s = sessionStorage.getItem(SESSION_KEY);
    if (!s) return null;
    const session = arcgisRest.ArcGISIdentityManager.deserialize(s);
    return session.tokenExpires && new Date(session.tokenExpires) < new Date() ? null : session;
  } catch { return null; }
}

export async function signIn() {
  const { clientId, portal } = cfg();
  const session = await arcgisRest.ArcGISIdentityManager.beginOAuth2({
    clientId, portal, redirectUri: redirectUri(), popup: true, pkce: true,
  });
  try { sessionStorage.setItem(SESSION_KEY, session.serialize()); } catch { /* private window */ }
  return session;
}

export function signOut() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

const req = (session, url, params = {}) =>
  arcgisRest.request(url, { authentication: session, httpMethod: "GET", params: { f: "json", ...params } });

/** Accepts a web map item URL, a Map Viewer URL, or a bare 32-character item ID. */
export function parseItemId(text) {
  const m = /(?:[?&#]|^)(?:id|webmap)=([0-9a-f]{32})/i.exec(text) || /\b([0-9a-f]{32})\b/i.exec(text);
  return m ? m[1].toLowerCase() : null;
}

export async function loadWebMap(session, itemId) {
  const base = `${cfg().portal}/content/items/${itemId}`;
  const item = await req(session, base);
  if (item.type !== "Web Map") throw new Error(`That item is a "${item.type}", not a web map.`);
  const data = await req(session, `${base}/data`);
  const layers = {};
  const walk = (list) => {
    for (const l of list || []) {
      if (l.layerType === "ArcGISFeatureLayer" && l.url) layers[l.title] = l.url;
      walk(l.layers);
    }
  };
  walk(data.operationalLayers);
  return { title: item.title, layers };
}

/**
 * Count of features grouped by HoleNo + the given fields: one small query per layer.
 * Returns [{<field>: value, ..., n}] with the field names as the mapping wrote them.
 */
export async function groupedCounts(session, layerUrl, fields) {
  const info = await req(session, layerUrl);
  const actual = {};
  for (const f of info.fields || []) actual[f.name.toLowerCase()] = f.name;
  const missing = fields.filter((f) => !actual[f.toLowerCase()]);
  if (missing.length) {
    const err = new Error(`layer "${info.name}" has no ${missing.join(", ")} field` +
      (missing.includes(HOLE_FIELD) ? " (run Standardize_HoleNo on this web map)" : ""));
    err.missingFields = missing;
    throw err;
  }
  const oid = info.objectIdField || (info.fields.find((f) => f.type === "esriFieldTypeOID") || {}).name || "OBJECTID";
  const res = await req(session, `${layerUrl}/query`, {
    where: "1=1",
    groupByFieldsForStatistics: fields.map((f) => actual[f.toLowerCase()]).join(","),
    outStatistics: JSON.stringify([{ statisticType: "count", onStatisticField: oid, outStatisticFieldName: "n" }]),
    returnGeometry: false,
  });
  if (res.error) throw new Error(res.error.message || "query failed");
  return (res.features || []).map((ft) => {
    const lower = Object.fromEntries(Object.entries(ft.attributes).map(([k, v]) => [k.toLowerCase(), v]));
    const row = { n: Number(lower.n ?? 0) };
    for (const f of fields) row[f] = lower[f.toLowerCase()] ?? null;
    return row;
  });
}
