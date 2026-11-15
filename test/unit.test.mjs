// Tests hors ligne (aucun appel réseau) : npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { parseCsv, csvToObjects, buildUrl } from "../src/http.js";
import { regrouperMutations } from "../src/tools/immobilier.js";
import { formatEntreprise } from "../src/tools/entreprises.js";
import { selectTools, allTools, TOOLSETS } from "../src/registry.js";

test("parseCsv gère guillemets, séparateurs internes, BOM et CRLF", () => {
  const rows = parseCsv('﻿a;b;c\r\n"x;1";"dit ""oui""";\r\n', ";");
  assert.deepEqual(rows, [["a", "b", "c"], ["x;1", 'dit "oui"', ""]]);
});

test("csvToObjects associe l'en-tête", () => {
  assert.deepEqual(csvToObjects("k,v\n1,2\n"), [{ k: "1", v: "2" }]);
});

test("buildUrl ignore les paramètres vides", () => {
  assert.equal(buildUrl("https://x.fr/a", { q: "é t", vide: "", n: undefined, z: 0 }), "https://x.fr/a?q=%C3%A9+t&z=0");
});

test("regrouperMutations : une vente sur plusieurs lignes, prix au m² sur logement unique", () => {
  const base = { id_mutation: "2024-1", date_mutation: "2024-03-01", nature_mutation: "Vente", valeur_fonciere: "300000", code_commune: "13005", nom_commune: "Aubagne" };
  const m = regrouperMutations([
    { ...base, id_parcelle: "13005000AB0012", type_local: "Maison", surface_reelle_bati: "100", nombre_pieces_principales: "4", surface_terrain: "500" },
    { ...base, id_parcelle: "13005000AB0012", type_local: "Dépendance", surface_reelle_bati: "", surface_terrain: "" },
    { ...base, id_parcelle: "13005000AB0013", type_local: "", surface_terrain: "200" },
  ]);
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].parcelles, ["13005000AB0012", "13005000AB0013"]);
  assert.equal(m[0].prix_m2, 3000);
  assert.equal(m[0].type_principal, "Maison");
  assert.equal(m[0].surface_terrain_m2, 700);
});

test("regrouperMutations : pas de prix au m² quand plusieurs logements", () => {
  const base = { id_mutation: "x", date_mutation: "2024-01-01", nature_mutation: "Vente", valeur_fonciere: "500000" };
  const [m] = regrouperMutations([
    { ...base, type_local: "Appartement", surface_reelle_bati: "50" },
    { ...base, type_local: "Appartement", surface_reelle_bati: "60" },
  ]);
  assert.equal(m.prix_m2, undefined);
  assert.equal(m.type_principal, "Plusieurs logements");
});

test("formatEntreprise n'expose pas la date de naissance des dirigeants", () => {
  const e = formatEntreprise(
    { siren: "123456789", nom_complet: "X", etat_administratif: "A", siege: {}, dirigeants: [{ nom: "N", prenoms: "P", qualite: "Président", date_de_naissance: "1960-01", annee_de_naissance: "1960", type_dirigeant: "personne physique" }] },
    { detail: true },
  );
  assert.deepEqual(e.dirigeants, [{ nom: "N", prenoms: "P", qualite: "Président" }]);
  assert.equal(e.etat, "active");
});

test("chaque outil a un nom unique, une description et un schéma zod valide", () => {
  const tools = allTools();
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
  for (const t of tools) {
    assert.match(t.name, /^[a-z_]+$/);
    assert.ok(t.description.length > 40, t.name);
    assert.doesNotThrow(() => z.object(t.input), t.name);
  }
});

test("selectTools filtre par toolset et désactive Légifrance sans clé", () => {
  delete process.env.PISTE_CLIENT_ID;
  const { tools, skipped } = selectTools(["marches", "legifrance"]);
  assert.deepEqual([...new Set(tools.map((t) => t.toolset))], ["marches"]);
  assert.deepEqual(skipped, ["legifrance"]);
  assert.throws(() => selectTools(["inconnu"]), /Toolset inconnu/);
  assert.ok(Object.keys(TOOLSETS).length >= 8);
});

test("entreprises_fiche accepte un SIRET avec espaces", () => {
  const t = allTools().find((x) => x.name === "entreprises_fiche");
  assert.equal(z.object(t.input).parse({ siren: "855 200 507 00017" }).siren, "85520050700017");
});
