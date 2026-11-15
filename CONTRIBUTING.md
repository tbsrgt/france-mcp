# Contribuer à france-mcp

Merci ! Le projet vise une chose : que n'importe quel agent IA accède proprement aux données publiques françaises, sans clé et en citant ses sources.

## Ajouter une source

1. Créez `src/tools/ma-source.js` qui exporte `tools = [{ name, title, description, input, run }]` :
   - `input` : un objet de schémas `zod`, décrits en français (`.describe(...)`) ;
   - `run(args)` renvoie un objet avec un champ `source: { nom, url }` pointant vers le producteur officiel.
2. Déclarez-la dans `src/registry.js` (nouveau toolset ou toolset existant).
3. Ajoutez un cas dans `test/smoke.mjs`, et si possible un test hors ligne dans `test/unit.test.mjs`.
4. Ajoutez une ligne au tableau des outils du README.

## Règles

- **Sources officielles uniquement**, appelées en direct (API publiques, fichiers publiés par le producteur).
- **Lecture seule.** Aucun outil n'écrit, n'envoie ni ne modifie quoi que ce soit.
- **Pas de clé par défaut.** Une source qui exige une clé est un toolset optionnel, désactivé sans variable d'environnement (voir `legifrance.js`).
- **Données personnelles minimisées** : ne renvoyez que ce qui est utile (ex. jamais la date de naissance d'un dirigeant).
- **Sorties compactes** : l'agent paie chaque caractère en contexte. Filtrez, renommez en français clair, tronquez les textes longs.
- Passez par `src/http.js` (cache, nouvelles tentatives, client identifiable) plutôt que par `fetch` directement.

## Vérifier

```bash
npm install
npm test          # hors ligne
npm run smoke     # chaque outil contre les vraies API
npm run parity    # fidélité champ par champ (≈ 10 min)
```
