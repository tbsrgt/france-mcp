// Adresses (Base Adresse Nationale, Géoplateforme IGN) et découpage administratif (API Géo) — sans clé.
import { z } from "zod";
import { buildUrl, getJson } from "../http.js";

const BAN = "https://data.geopf.fr/geocodage";
const GEO = "https://geo.api.gouv.fr";
const SOURCE_BAN = { nom: "Base Adresse Nationale (IGN Géoplateforme)", url: "https://adresse.data.gouv.fr" };
const SOURCE_GEO = { nom: "API Géo (INSEE, découpage administratif)", url: "https://geo.api.gouv.fr" };

const COMMUNE_FIELDS = "nom,code,codesPostaux,population,surface,centre,codeDepartement,departement,codeRegion,region,codeEpci,epci,siren";

function formatAdresse(f) {
  const p = f.properties;
  return {
    adresse: p.label,
    score: Math.round(p.score * 1000) / 1000,
    type: p.type,
    numero: p.housenumber,
    voie: p.street ?? p.name,
    code_postal: p.postcode,
    commune: p.city,
    code_insee: p.citycode,
    contexte: p.context,
    longitude: f.geometry.coordinates[0],
    latitude: f.geometry.coordinates[1],
    id_ban: p.id,
  };
}

export function formatCommune(c) {
  return {
    code_insee: c.code,
    nom: c.nom,
    codes_postaux: c.codesPostaux,
    population: c.population,
    surface_km2: c.surface != null ? Math.round(c.surface) / 100 : undefined,
    departement: c.departement ? { code: c.departement.code, nom: c.departement.nom } : c.codeDepartement,
    region: c.region ? { code: c.region.code, nom: c.region.nom } : c.codeRegion,
    epci: c.epci ? { siren: c.epci.code, nom: c.epci.nom } : c.codeEpci,
    siren: c.siren,
    centre: c.centre ? { longitude: c.centre.coordinates[0], latitude: c.centre.coordinates[1] } : undefined,
  };
}

export const tools = [
  {
    name: "adresse_geocoder",
    title: "Géocoder une adresse",
    description:
      "Transforme une adresse française en coordonnées GPS et code INSEE, depuis la Base Adresse Nationale. Gère les fautes de frappe. Utile avant les outils cadastre, DVF ou Caparéseau.",
    input: {
      adresse: z.string().min(3).describe("Adresse libre, ex. « 8 bd du Port Amiens »"),
      code_postal: z.string().regex(/^\d{5}$/).optional(),
      limite: z.number().int().min(1).max(20).default(5),
    },
    async run({ adresse, code_postal, limite }) {
      const data = await getJson(buildUrl(`${BAN}/search`, { q: adresse, postcode: code_postal, limit: limite }));
      return { source: SOURCE_BAN, resultats: data.features.map(formatAdresse) };
    },
  },
  {
    name: "adresse_inverse",
    title: "Adresse la plus proche d'un point GPS",
    description: "Géocodage inverse : renvoie l'adresse postale la plus proche de coordonnées GPS (France).",
    input: {
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      limite: z.number().int().min(1).max(10).default(1),
    },
    async run({ latitude, longitude, limite }) {
      const data = await getJson(buildUrl(`${BAN}/reverse`, { lat: latitude, lon: longitude, limit: limite }));
      return { source: SOURCE_BAN, resultats: data.features.map(formatAdresse) };
    },
  },
  {
    name: "communes_rechercher",
    title: "Rechercher une commune",
    description:
      "Trouve des communes françaises par nom, code postal, code INSEE ou coordonnées GPS. Renvoie code INSEE, population, surface, département, région, intercommunalité (EPCI).",
    input: {
      nom: z.string().optional().describe("Nom (recherche approchée)"),
      code_postal: z.string().regex(/^\d{5}$/).optional(),
      code_insee: z.string().regex(/^(\d{5}|2[AB]\d{3})$/).optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      departement: z.string().optional().describe("Restreindre à un département, ex. 13"),
      limite: z.number().int().min(1).max(50).default(10),
    },
    async run({ nom, code_postal, code_insee, latitude, longitude, departement, limite }) {
      if (code_insee) {
        const c = await getJson(buildUrl(`${GEO}/communes/${code_insee}`, { fields: COMMUNE_FIELDS }));
        return { source: SOURCE_GEO, resultats: [formatCommune(c)] };
      }
      if (!nom && !code_postal && (latitude == null || longitude == null)) {
        throw new Error("Indiquez au moins un nom, un code postal, un code INSEE ou un couple latitude/longitude.");
      }
      const data = await getJson(
        buildUrl(`${GEO}/communes`, {
          nom,
          codePostal: code_postal,
          lat: latitude,
          lon: longitude,
          codeDepartement: departement,
          fields: COMMUNE_FIELDS,
          boost: "population",
          limit: limite,
        }),
      );
      return { source: SOURCE_GEO, resultats: data.slice(0, limite).map(formatCommune) };
    },
  },
  {
    name: "territoire_lister",
    title: "Lister régions, départements ou communes d'un département",
    description: "Liste les régions, les départements (éventuellement d'une région) ou les communes d'un département, avec leurs codes officiels.",
    input: {
      niveau: z.enum(["regions", "departements", "communes"]),
      parent: z.string().optional().describe("Code région (pour departements) ou code département (pour communes)"),
    },
    async run({ niveau, parent }) {
      let url;
      if (niveau === "regions") url = `${GEO}/regions`;
      else if (niveau === "departements") url = parent ? `${GEO}/regions/${parent}/departements` : `${GEO}/departements`;
      else {
        if (!parent) throw new Error("Pour lister des communes, indiquez le code département dans « parent ».");
        url = buildUrl(`${GEO}/departements/${parent}/communes`, { fields: "nom,code,codesPostaux,population" });
      }
      const data = await getJson(url);
      return { source: SOURCE_GEO, total: data.length, resultats: data };
    },
  },
];
