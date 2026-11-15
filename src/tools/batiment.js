// Risques naturels et technologiques (Géorisques) et diagnostics de performance énergétique (ADEME) — sans clé.
import { z } from "zod";
import { buildUrl, getJson } from "../http.js";

const GEORISQUES = "https://georisques.gouv.fr/api/v1/resultats_rapport_risque";
const DPE = "https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines";
const SOURCE_RISQUES = { nom: "Géorisques (ministère de la Transition écologique, BRGM)", url: "https://www.georisques.gouv.fr" };
const SOURCE_DPE = { nom: "DPE logements existants depuis juillet 2021 (ADEME)", url: "https://data.ademe.fr/datasets/dpe03existant" };

const DPE_FIELDS = [
  "numero_dpe",
  "date_etablissement_dpe",
  "etiquette_dpe",
  "etiquette_ges",
  "adresse_ban",
  "code_insee_ban",
  "type_batiment",
  "annee_construction",
  "periode_construction",
  "surface_habitable_logement",
  "conso_5_usages_par_m2_ep",
  "emission_ges_5_usages_par_m2",
  "type_energie_principale_chauffage",
  "_geopoint",
].join(",");

function risques(bloc) {
  const presents = [];
  const absents = [];
  for (const r of Object.values(bloc ?? {})) {
    if (r.present) presents.push({ risque: r.libelle, a_l_adresse: r.libelleStatutAdresse ?? undefined, commune: r.libelleStatutCommune ?? undefined });
    else absents.push(r.libelle);
  }
  return { presents, absents };
}

export const tools = [
  {
    name: "risques_adresse",
    title: "Risques naturels et technologiques à une adresse",
    description:
      "Rapport Géorisques officiel pour un point GPS : inondation, remontée de nappe, séisme, mouvements de terrain, retrait-gonflement des argiles, radon, feux de forêt, côtier, et risques technologiques (sites industriels ICPE, nucléaire, canalisations, sols pollués, barrages, mines). Base de l'état des risques obligatoire lors d'une vente ou location.",
    input: {
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    },
    async run({ latitude, longitude }) {
      const d = await getJson(buildUrl(GEORISQUES, { latlon: `${longitude},${latitude}` }), { timeoutMs: 30000 });
      return {
        source: SOURCE_RISQUES,
        adresse: d.adresse?.libelle,
        commune: d.commune,
        risques_naturels: risques(d.risquesNaturels),
        risques_technologiques: risques(d.risquesTechnologiques),
        rapport: d.url,
      };
    },
  },
  {
    name: "dpe_rechercher",
    title: "Diagnostics de performance énergétique (DPE)",
    description:
      "Cherche les DPE officiels des logements (base ADEME, 16 millions de diagnostics depuis 2021) autour d'un point GPS ou par texte d'adresse : étiquette énergie (A à G), étiquette climat, consommation au m², année de construction, surface, chauffage. Filtre possible sur l'étiquette (ex. passoires F et G).",
    input: {
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      rayon_m: z.number().int().min(10).max(5000).default(100),
      adresse: z.string().optional().describe("Texte d'adresse, ex. « 20 avenue Antide Boyer Aubagne »"),
      code_insee: z.string().regex(/^(\d{5}|2[AB]\d{3})$/).optional(),
      etiquettes: z.array(z.enum(["A", "B", "C", "D", "E", "F", "G"])).optional().describe("Ne garder que ces étiquettes énergie"),
      limite: z.number().int().min(1).max(100).default(20),
    },
    async run({ latitude, longitude, rayon_m, adresse, code_insee, etiquettes, limite }) {
      if ((latitude == null || longitude == null) && !adresse && !code_insee) {
        throw new Error("Indiquez latitude + longitude, une adresse ou un code INSEE.");
      }
      const params = { size: limite, select: DPE_FIELDS, sort: "-date_etablissement_dpe" };
      if (latitude != null && longitude != null) params.geo_distance = `${longitude},${latitude},${rayon_m}`;
      if (adresse) {
        params.q = adresse;
        params.q_fields = "adresse_ban";
        delete params.sort;
      }
      if (code_insee) params.code_insee_ban_eq = code_insee;
      if (etiquettes?.length) params.etiquette_dpe_in = etiquettes.join(",");
      const d = await getJson(buildUrl(DPE, params), { timeoutMs: 30000 });
      return {
        source: SOURCE_DPE,
        total: d.total,
        resultats: d.results.map((r) => {
          const [lat, lon] = (r._geopoint ?? "").split(",").map(Number);
          return {
            numero_dpe: r.numero_dpe,
            date: r.date_etablissement_dpe,
            etiquette_energie: r.etiquette_dpe,
            etiquette_climat: r.etiquette_ges,
            adresse: r.adresse_ban,
            code_insee: r.code_insee_ban,
            type_batiment: r.type_batiment,
            annee_construction: r.annee_construction ?? undefined,
            periode_construction: r.periode_construction ?? undefined,
            surface_m2: r.surface_habitable_logement ?? undefined,
            conso_kwhep_m2_an: r.conso_5_usages_par_m2_ep,
            ges_kgco2_m2_an: r.emission_ges_5_usages_par_m2,
            chauffage: r.type_energie_principale_chauffage ?? undefined,
            latitude: Number.isFinite(lat) ? lat : undefined,
            longitude: Number.isFinite(lon) ? lon : undefined,
            verifier: `https://observatoire-dpe-audit.ademe.fr/afficher-dpe/${r.numero_dpe}`,
          };
        }),
      };
    },
  },
];
