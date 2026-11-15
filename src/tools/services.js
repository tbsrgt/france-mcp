// Annuaire de l'administration (Service-Public.fr) et calendrier officiel (jours fériés) — sans clé.
import { z } from "zod";
import { buildUrl, getJson } from "../http.js";

const ANNUAIRE = "https://api-lannuaire.service-public.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records";
const CALENDRIER = "https://calendrier.api.gouv.fr/jours-feries";
const SOURCE_ANNUAIRE = { nom: "Annuaire de l'administration (DILA, Service-Public.fr)", url: "https://lannuaire.service-public.gouv.fr" };
const SOURCE_CAL = { nom: "Jours fériés (Etalab)", url: "https://calendrier.api.gouv.fr" };

const q = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const parse = (v) => {
  if (typeof v !== "string") return v ?? undefined;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

const JOURS = (plages) =>
  (parse(plages) ?? []).map((p) => {
    const jours = p.nom_jour_debut === p.nom_jour_fin ? p.nom_jour_debut : `${p.nom_jour_debut}–${p.nom_jour_fin}`;
    const h = (a, b) => (a && b && a !== "00:00:00" ? `${a.slice(0, 5)}-${b.slice(0, 5)}` : null);
    const heures = [h(p.valeur_heure_debut_1, p.valeur_heure_fin_1), h(p.valeur_heure_debut_2, p.valeur_heure_fin_2)].filter(Boolean).join(", ");
    return `${jours} ${heures}${p.commentaire ? ` (${p.commentaire})` : ""}`.trim();
  });

function formatGuichet(r) {
  const adr = (parse(r.adresse) ?? []).find((a) => a.type_adresse === "Adresse") ?? parse(r.adresse)?.[0];
  return {
    nom: r.nom,
    type: (parse(r.pivot) ?? []).map((p) => p.type_service_local),
    adresse: adr ? [adr.numero_voie, adr.complement1, `${adr.code_postal ?? ""} ${adr.nom_commune ?? ""}`.trim()].filter(Boolean).join(", ") : undefined,
    latitude: adr?.latitude ? Number(adr.latitude) : undefined,
    longitude: adr?.longitude ? Number(adr.longitude) : undefined,
    telephone: (parse(r.telephone) ?? []).map((t) => t.valeur),
    courriel: r.adresse_courriel ?? undefined,
    site: (parse(r.site_internet) ?? []).map((s) => s.valeur),
    horaires: JOURS(r.plage_ouverture),
    siret: r.siret ?? undefined,
    fiche: r.url_service_public,
  };
}

export const tools = [
  {
    name: "services_publics_trouver",
    title: "Trouver un guichet public",
    description:
      "Trouve les services publics d'une commune ou par nom dans l'annuaire officiel Service-Public.fr (94 000 guichets) : mairie, préfecture, CAF, CPAM, France Travail, tribunal, France Services, gendarmerie, centre des impôts… Renvoie adresse, téléphone, courriel, horaires.",
    input: {
      code_insee: z.string().regex(/^(\d{5}|2[AB]\d{3})$/).optional().describe("Commune (voir communes_rechercher)"),
      type: z
        .string()
        .optional()
        .describe("Type de guichet (code pivot), ex. mairie, prefecture, caf, cpam, france_travail, france_services, gendarmerie, commissariat_police, sip (impôts), tribunal_judiciaire"),
      nom: z.string().optional().describe("Texte dans le nom, ex. « préfecture des Bouches-du-Rhône »"),
      limite: z.number().int().min(1).max(50).default(10),
    },
    async run({ code_insee, type, nom, limite }) {
      const where = [];
      if (code_insee) where.push(`code_insee_commune = ${q(code_insee)}`);
      if (type) where.push(`search(pivot, ${q(type)})`);
      if (nom) where.push(`search(nom, ${q(nom)})`);
      if (!where.length) throw new Error("Indiquez au moins une commune, un type ou un nom.");
      const data = await getJson(buildUrl(ANNUAIRE, { where: where.join(" AND "), limit: limite }));
      return { source: SOURCE_ANNUAIRE, total: data.total_count, resultats: data.results.map(formatGuichet) };
    },
  },
  {
    name: "jours_feries",
    title: "Jours fériés officiels",
    description: "Liste des jours fériés d'une année pour la métropole, l'Alsace-Moselle ou un département/territoire d'outre-mer.",
    input: {
      annee: z.number().int().min(2000).max(2050).default(new Date().getFullYear()),
      zone: z
        .enum(["metropole", "alsace-moselle", "guadeloupe", "guyane", "la-reunion", "martinique", "mayotte", "nouvelle-caledonie", "polynesie-francaise", "saint-barthelemy", "saint-martin", "saint-pierre-et-miquelon", "wallis-et-futuna"])
        .default("metropole"),
    },
    async run({ annee, zone }) {
      const data = await getJson(`${CALENDRIER}/${zone}/${annee}.json`);
      return { source: SOURCE_CAL, zone, annee, jours: Object.entries(data).map(([date, nom]) => ({ date, nom })) };
    },
  },
];
