// data.gouv.fr : catalogue national des données publiques + API tabulaire — sans clé.
import { z } from "zod";
import { buildUrl, getJson } from "../http.js";

const API = "https://www.data.gouv.fr/api/1";
const TABULAR = "https://tabular-api.data.gouv.fr/api/resources";
const SOURCE = { nom: "data.gouv.fr (Etalab / DINUM)", url: "https://www.data.gouv.fr" };

const court = (s, n = 400) => (s && s.length > n ? `${s.slice(0, n).trim()}…` : s);

function formatRessource(r) {
  return {
    id: r.id,
    titre: r.title,
    format: r.format,
    taille_octets: r.filesize ?? undefined,
    derniere_modification: r.last_modified,
    url: r.url,
    apercu_tabulaire: Boolean(r.extras?.["analysis:parsing:parsing_table"]),
  };
}

export const tools = [
  {
    name: "datagouv_rechercher",
    title: "Chercher un jeu de données public",
    description:
      "Recherche dans les 50 000+ jeux de données de data.gouv.fr (tous ministères, collectivités, opérateurs). Renvoie titre, producteur, date de mise à jour et identifiant à passer à datagouv_jeu_de_donnees.",
    input: {
      recherche: z.string().min(2),
      organisation: z.string().optional().describe("Identifiant ou slug d'organisation pour restreindre"),
      page: z.number().int().min(1).default(1),
      par_page: z.number().int().min(1).max(50).default(10),
    },
    async run({ recherche, organisation, page, par_page }) {
      const data = await getJson(buildUrl(`${API}/datasets/`, { q: recherche, organization: organisation, page, page_size: par_page }));
      return {
        source: SOURCE,
        total: data.total,
        resultats: data.data.map((d) => ({
          id: d.id,
          titre: d.title,
          producteur: d.organization?.name ?? d.owner?.slug,
          description: court(d.description_short || d.description, 300),
          mise_a_jour: d.last_update,
          frequence: d.frequency,
          licence: d.license,
          url: d.page,
        })),
      };
    },
  },
  {
    name: "datagouv_jeu_de_donnees",
    title: "Détail d'un jeu de données",
    description:
      "Description complète d'un jeu de données data.gouv.fr et liste de ses fichiers (ressources) avec leur format, taille, URL de téléchargement et indication de la disponibilité d'un aperçu tabulaire (datagouv_apercu).",
    input: { id: z.string().min(3).describe("Identifiant ou slug du jeu de données") },
    async run({ id }) {
      const d = await getJson(`${API}/datasets/${encodeURIComponent(id)}/`);
      return {
        source: SOURCE,
        id: d.id,
        titre: d.title,
        producteur: d.organization?.name,
        description: court(d.description, 2000),
        licence: d.license,
        frequence: d.frequency,
        couverture_temporelle: d.temporal_coverage ?? undefined,
        mots_cles: d.tags,
        mise_a_jour: d.last_update,
        url: d.page,
        ressources: d.resources.map(formatRessource),
      };
    },
  },
  {
    name: "datagouv_apercu",
    title: "Lire les lignes d'un fichier CSV public",
    description:
      "Lit directement les lignes d'un fichier CSV/XLS publié sur data.gouv.fr, sans le télécharger, via l'API tabulaire. Filtre par colonne (égalité ou contient) et tri. Utiliser l'id de ressource fourni par datagouv_jeu_de_donnees.",
    input: {
      ressource_id: z.string().uuid(),
      filtres: z
        .array(
          z.object({
            colonne: z.string(),
            operateur: z.enum(["exact", "contains", "less", "greater", "differs"]).default("exact"),
            valeur: z.string(),
          }),
        )
        .optional(),
      tri: z.object({ colonne: z.string(), ordre: z.enum(["asc", "desc"]).default("asc") }).optional(),
      page: z.number().int().min(1).default(1),
      par_page: z.number().int().min(1).max(50).default(20),
    },
    async run({ ressource_id, filtres, tri, page, par_page }) {
      const params = { page, page_size: par_page };
      for (const f of filtres ?? []) params[`${f.colonne}__${f.operateur}`] = f.valeur;
      if (tri) params[`${tri.colonne}__sort`] = tri.ordre;
      const data = await getJson(buildUrl(`${TABULAR}/${ressource_id}/data/`, params));
      return {
        source: SOURCE,
        total: data.meta?.total,
        page: data.meta?.page,
        colonnes: data.data[0] ? Object.keys(data.data[0]).filter((c) => c !== "__id") : [],
        lignes: data.data,
      };
    },
  },
];
