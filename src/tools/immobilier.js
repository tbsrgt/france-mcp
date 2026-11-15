// Cadastre (API Carto IGN) et ventes immobilières DVF (DGFiP, fichiers géolocalisés Etalab) — sans clé.
import { z } from "zod";
import { buildUrl, getJson, getText, csvToObjects, HttpError } from "../http.js";

const CARTO = "https://apicarto.ign.fr/api/cadastre";
const DVF = "https://files.data.gouv.fr/geo-dvf/latest/csv";
const SOURCE_CADASTRE = { nom: "Cadastre (IGN API Carto, PCI Express)", url: "https://apicarto.ign.fr" };
const SOURCE_DVF = { nom: "Demandes de valeurs foncières géolocalisées (DGFiP, Etalab)", url: "https://explore.data.gouv.fr/fr/immobilier" };

// Années publiées : DVF couvre les 5 dernières années, mises à jour deux fois par an.
const DVF_FIRST_YEAR = 2021;
const currentYear = () => new Date().getFullYear();

const codeInsee = z.string().regex(/^(\d{5}|2[AB]\d{3})$/, "Code INSEE à 5 caractères, ex. 13005");

function formatParcelle(f, avecGeometrie) {
  const p = f.properties;
  const out = {
    id: p.idu,
    code_insee: p.code_insee,
    commune: p.nom_com,
    arrondissement: p.code_arr !== "000" ? p.code_arr : undefined,
    section: p.section,
    numero: p.numero,
    feuille: p.feuille,
    surface_m2: p.contenance,
  };
  if (avecGeometrie) out.geometrie = f.geometry;
  return out;
}

const departementDe = (insee) => (insee.startsWith("97") ? insee.slice(0, 3) : insee.slice(0, 2));

const num = (v) => {
  if (v === "" || v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Télécharge les lignes DVF d'une commune pour une année (tableau vide si le fichier n'existe pas). */
export async function lignesDvf(insee, annee) {
  try {
    const text = await getText(`${DVF}/${annee}/communes/${departementDe(insee)}/${insee}.csv`, { timeoutMs: 45000 });
    return csvToObjects(text);
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 403)) return [];
    throw err;
  }
}

/** Regroupe les lignes DVF par mutation (une vente = plusieurs lignes : lots, locaux, parcelles). */
export function regrouperMutations(lignes) {
  const map = new Map();
  for (const l of lignes) {
    let m = map.get(l.id_mutation);
    if (!m) {
      m = {
        id: l.id_mutation,
        date: l.date_mutation,
        nature: l.nature_mutation,
        valeur_fonciere: num(l.valeur_fonciere),
        adresse: [l.adresse_numero, l.adresse_suffixe, l.adresse_nom_voie].filter(Boolean).join(" ") || undefined,
        code_postal: l.code_postal || undefined,
        commune: l.nom_commune,
        code_insee: l.code_commune,
        parcelles: new Set(),
        locaux: [],
        surface_terrain_m2: 0,
        latitude: num(l.latitude),
        longitude: num(l.longitude),
      };
      map.set(l.id_mutation, m);
    }
    if (l.id_parcelle) m.parcelles.add(l.id_parcelle);
    if (l.type_local) {
      m.locaux.push({
        type: l.type_local,
        surface_bati_m2: num(l.surface_reelle_bati),
        pieces: num(l.nombre_pieces_principales),
      });
    }
    m.surface_terrain_m2 += num(l.surface_terrain) ?? 0;
  }
  return [...map.values()].map((m) => {
    const habitations = m.locaux.filter((x) => x.type === "Maison" || x.type === "Appartement");
    const unique = habitations.length === 1 && m.nature === "Vente" ? habitations[0] : null;
    return {
      ...m,
      parcelles: [...m.parcelles],
      surface_terrain_m2: m.surface_terrain_m2 || undefined,
      prix_m2: unique?.surface_bati_m2 && m.valeur_fonciere ? Math.round(m.valeur_fonciere / unique.surface_bati_m2) : undefined,
      type_principal: unique?.type ?? (habitations.length > 1 ? "Plusieurs logements" : m.locaux[0]?.type ?? "Terrain / autre"),
    };
  });
}

const mediane = (xs) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

async function mutationsCommune(insee, depuis, jusqua) {
  const annees = [];
  for (let a = Math.max(depuis, DVF_FIRST_YEAR); a <= Math.min(jusqua, currentYear()); a++) annees.push(a);
  const lots = await Promise.all(annees.map((a) => lignesDvf(insee, a)));
  return { annees, mutations: regrouperMutations(lots.flat()) };
}

export const tools = [
  {
    name: "cadastre_parcelle",
    title: "Trouver une parcelle cadastrale",
    description:
      "Renvoie la ou les parcelles cadastrales soit à partir d'un point GPS, soit à partir de la commune, de la section et du numéro. Donne l'identifiant (à réutiliser dans dvf_ventes), la surface et, sur demande, le contour GeoJSON.",
    input: {
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      code_insee: codeInsee.optional(),
      section: z.string().regex(/^[0-9A-Z]{1,2}$/i).optional().describe("Section cadastrale, ex. AB"),
      numero: z.string().regex(/^\d{1,4}$/).optional().describe("Numéro de parcelle, ex. 12 ou 0012"),
      avec_geometrie: z.boolean().default(false),
    },
    async run({ latitude, longitude, code_insee, section, numero, avec_geometrie }) {
      let url;
      if (latitude != null && longitude != null) {
        url = buildUrl(`${CARTO}/parcelle`, { geom: JSON.stringify({ type: "Point", coordinates: [longitude, latitude] }) });
      } else if (code_insee) {
        url = buildUrl(`${CARTO}/parcelle`, {
          code_insee,
          section: section?.toUpperCase().padStart(2, "0"),
          numero: numero?.padStart(4, "0"),
          _limit: 50,
        });
      } else {
        throw new Error("Indiquez latitude + longitude, ou code_insee (+ section et numéro).");
      }
      const data = await getJson(url);
      return {
        source: SOURCE_CADASTRE,
        total: data.totalFeatures ?? data.features.length,
        resultats: data.features.map((f) => formatParcelle(f, avec_geometrie)),
      };
    },
  },
  {
    name: "dvf_ventes",
    title: "Ventes immobilières (DVF)",
    description:
      "Liste les ventes immobilières réelles enregistrées par les notaires et la DGFiP dans une commune (5 dernières années) : date, prix, adresse, type de bien, surface, prix au m². Filtres : parcelle, type de bien, rue, prix. Paris, Lyon et Marseille : utiliser le code INSEE d'arrondissement (75101…, 69381…, 13201…).",
    input: {
      code_insee: codeInsee,
      id_parcelle: z.string().regex(/^\d{5}[0-9A-Z]{3}[0-9A-Z]{2}\d{4}$/i).optional().describe("Identifiant de parcelle à 14 caractères (voir cadastre_parcelle)"),
      type_bien: z.enum(["Maison", "Appartement", "Local industriel. commercial ou assimilé", "Dépendance", "Terrain / autre"]).optional(),
      rue: z.string().optional().describe("Filtre texte sur le nom de la voie"),
      depuis: z.number().int().min(DVF_FIRST_YEAR).default(DVF_FIRST_YEAR),
      jusqua: z.number().int().optional(),
      prix_min: z.number().optional(),
      prix_max: z.number().optional(),
      limite: z.number().int().min(1).max(200).default(30),
    },
    async run({ code_insee, id_parcelle, type_bien, rue, depuis, jusqua, prix_min, prix_max, limite }) {
      const { annees, mutations } = await mutationsCommune(code_insee, depuis, jusqua ?? currentYear());
      const rueN = rue?.toLowerCase();
      const filtrees = mutations
        .filter((m) => !id_parcelle || m.parcelles.includes(id_parcelle.toUpperCase()))
        .filter((m) => !type_bien || m.type_principal === type_bien || m.locaux.some((l) => l.type === type_bien))
        .filter((m) => !rueN || m.adresse?.toLowerCase().includes(rueN))
        .filter((m) => prix_min == null || (m.valeur_fonciere ?? 0) >= prix_min)
        .filter((m) => prix_max == null || (m.valeur_fonciere ?? Infinity) <= prix_max)
        .sort((a, b) => b.date.localeCompare(a.date));
      return {
        source: SOURCE_DVF,
        annees_couvertes: annees,
        total: filtrees.length,
        resultats: filtrees.slice(0, limite),
      };
    },
  },
  {
    name: "dvf_statistiques",
    title: "Prix immobiliers d'une commune",
    description:
      "Prix médian au m² des maisons et des appartements d'une commune, année par année, calculé sur les ventes DVF d'un seul logement. Renvoie aussi le nombre de ventes et le prix médian.",
    input: {
      code_insee: codeInsee,
      depuis: z.number().int().min(DVF_FIRST_YEAR).default(DVF_FIRST_YEAR),
    },
    async run({ code_insee, depuis }) {
      const { annees, mutations } = await mutationsCommune(code_insee, depuis, currentYear());
      const stats = {};
      for (const type of ["Maison", "Appartement"]) {
        stats[type] = {};
        for (const a of annees) {
          const ventes = mutations.filter((m) => m.type_principal === type && m.prix_m2 && m.date.startsWith(String(a)));
          if (!ventes.length) continue;
          stats[type][a] = {
            ventes: ventes.length,
            prix_m2_median: mediane(ventes.map((v) => v.prix_m2)),
            prix_median: mediane(ventes.map((v) => v.valeur_fonciere)),
          };
        }
      }
      return {
        source: SOURCE_DVF,
        code_insee,
        commune: mutations[0]?.commune,
        methode: "Ventes d'un seul logement (maison ou appartement), prix au m² = valeur foncière / surface réelle bâtie.",
        statistiques: stats,
      };
    },
  },
];
