// Client HTTP partagé : délai maximum, nouvelles tentatives sur 429/5xx, petit cache mémoire.
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
export const USER_AGENT = `france-mcp/${pkg.version} (+https://github.com/tbsrgt/france-mcp)`;

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map();

export class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} sur ${new URL(url).host}${body ? ` : ${body.slice(0, 200)}` : ""}`);
    this.status = status;
    this.url = url;
  }
}

/** Construit une URL avec ses paramètres (ignore undefined, null et chaînes vides). */
export function buildUrl(base, params = {}) {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Requête HTTP. `as` vaut "json" (défaut) ou "text".
 * Les GET sont mis en cache 5 minutes (désactivable avec cache: false).
 */
export async function request(url, { as = "json", method = "GET", headers = {}, body, cache: useCache = true, timeoutMs = 20000, retries = 3 } = {}) {
  const key = method === "GET" && useCache ? `${as}:${url}` : null;
  if (key) {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        body,
        headers: { "User-Agent": USER_AGENT, Accept: as === "json" ? "application/json" : "*/*", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new HttpError(res.status, url, await res.text().catch(() => ""));
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ""));
      const value = as === "json" ? await res.json() : await res.text();
      if (key) {
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
        cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
      }
      return value;
    } catch (err) {
      if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
      lastError = err;
      // coupure réseau (« fetch failed », réinitialisation, délai) : attente croissante 1 s, 2 s, 4 s
      if (attempt < retries) await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastError;
}

export const getJson = (url, opts) => request(url, { ...opts, as: "json" });
export const getText = (url, opts) => request(url, { ...opts, as: "text" });

/** Analyse un CSV (séparateur au choix, guillemets, BOM) en tableau de lignes. */
export function parseCsv(text, sep = ",") {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

/** CSV avec en-tête → tableau d'objets. */
export function csvToObjects(text, sep = ",") {
  const [head, ...rows] = parseCsv(text, sep);
  if (!head) return [];
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ""])));
}
