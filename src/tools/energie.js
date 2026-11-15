// Capacités d'accueil des postes sources pour raccorder des énergies renouvelables (Caparéseau, RTE + GRD) — sans clé.
import { z } from "zod";
import { getJson, getText } from "../http.js";

const BASE = "https://www.capareseau.fr";
const SOURCE = { nom: "Caparéseau (RTE, Enedis et gestionnaires de réseau de distribution)", url: BASE };
// Codes région INSEE utilisés par Caparéseau (Corse non couverte).
const REGIONS = ["11", "24", "27", "28", "32", "44", "52", "53", "75", "76", "84", "93"];
const TTL_MS = 6 * 60 * 60 * 1000;

let cache = null;

/** "92.73  k€/MW" → 92.73 ; "" → undefined */
const num = (v) => {
  if (v == null) return undefined;
  const s = String(v).replace(/\s/g, "").replace(/k€\/MW|%|MW/gi, "").replace(",", ".");
  if (s === "" || s === "_") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};
const txt = (v) => {
  const s = (v ?? "").toString().trim();
  return s === "" || s === "_" ? undefined : s;
};

function formatPoste(p) {
  const v = p.values ?? {};
  const gestionnaires = [...new Set([p.grd1?.name, p.grd2?.name, p.grdHTB?.name].filter(Boolean))];
  return {
    code: p.code,
    nom: p.name,
    region: p.territory_name,
    latitude: Number(p.Y),
    longitude: Number(p.X),
    gestionnaires: gestionnaires.length ? gestionnaires : ["RTE"],
    en_projet: p.project === "1",
    mise_a_jour: txt(p.updated),
    capacite_reservee_mw: num(v.INFO_CR),
    capacite_restant_a_affecter_mw: num(v.INFO_NA),
    capacite_disponible_rte_mw: num(v.RTE_CDR),
    capacite_disponible_grd_mw: num(v.GRD1_CDR),
    file_attente_mw: num(v.INFO_FAS3R),
    en_service_mw: num(v.INFO_ESS3R),
    taux_remplissage_pct: num(v.INFO_TX),
    quote_part_keur_par_mw: num(v.INFO_QP),
    travaux_rte: txt(v.RTE_TVX),
    travaux_grd: txt(v.GRD1_TVX),
  };
}

export async function chargerPostes() {
  if (cache && cache.expires > Date.now()) return cache.postes;
  const parRegion = await Promise.all(
    REGIONS.map(async (reg) => {
      const html = await getText(`${BASE}/region/${reg}`);
      const path = html.match(/regionPostUrl = '([^']+)'/)?.[1];
      if (!path) return [];
      return getJson(BASE + path);
    }),
  );
  const vus = new Set();
  const postes = [];
  for (const p of parRegion.flat()) {
    if (!p.code || vus.has(p.code)) continue;
    vus.add(p.code);
    const f = formatPoste(p);
    if (Number.isFinite(f.latitude) && Number.isFinite(f.longitude)) postes.push(f);
  }
  if (!postes.length) throw new Error("Caparéseau n'a renvoyé aucun poste (structure du site modifiée ?).");
  cache = { postes, expires: Date.now() + TTL_MS };
  return postes;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export const tools = [
  {
    name: "energie_postes_sources",
    title: "Capacité de raccordement EnR à proximité",
    description:
      "Trouve les postes sources électriques les plus proches d'un point (ou par nom) et leur capacité d'accueil pour raccorder un projet solaire, éolien ou de stockage : capacité disponible (MW), file d'attente, taux de remplissage, quote-part S3REnR (k€/MW), travaux prévus. Données Caparéseau, France métropolitaine hors Corse.",
    input: {
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      nom: z.string().optional().describe("Nom ou code du poste, ex. « Trets »"),
      rayon_km: z.number().min(1).max(200).default(30),
      capacite_min_mw: z.number().min(0).optional().describe("Ne garder que les postes ayant au moins cette capacité disponible"),
      limite: z.number().int().min(1).max(50).default(10),
    },
    async run({ latitude, longitude, nom, rayon_km, capacite_min_mw, limite }) {
      const postes = await chargerPostes();
      let liste;
      if (latitude != null && longitude != null) {
        liste = postes
          .map((p) => ({ ...p, distance_km: Math.round(distanceKm(latitude, longitude, p.latitude, p.longitude) * 10) / 10 }))
          .filter((p) => p.distance_km <= rayon_km)
          .sort((a, b) => a.distance_km - b.distance_km);
      } else if (nom) {
        const n = nom.toLowerCase();
        liste = postes.filter((p) => p.nom.toLowerCase().includes(n) || p.code.toLowerCase() === n);
      } else {
        throw new Error("Indiquez latitude + longitude (voir adresse_geocoder) ou un nom de poste.");
      }
      if (capacite_min_mw != null) {
        liste = liste.filter((p) => Math.max(p.capacite_disponible_rte_mw ?? 0, p.capacite_disponible_grd_mw ?? 0, p.capacite_restant_a_affecter_mw ?? 0) >= capacite_min_mw);
      }
      return {
        source: SOURCE,
        postes_charges: postes.length,
        total: liste.length,
        resultats: liste.slice(0, limite),
        lecture:
          "capacite_restant_a_affecter_mw = capacité réservée au S3REnR encore disponible ; capacite_disponible_* = capacité technique sans travaux. La quote-part est la contribution due par MW raccordé.",
      };
    },
  },
];
