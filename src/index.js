#!/usr/bin/env node
// france-mcp — l'État français branché sur l'IA. Serveur MCP (stdio).
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TOOLSETS, selectTools } from "./registry.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const args = process.argv.slice(2);

function option(name) {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return undefined;
  return args[i].includes("=") ? args[i].split("=").slice(1).join("=") : args[i + 1];
}

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(`france-mcp ${pkg.version} — données publiques françaises pour agents IA (MCP, stdio)

Usage : npx -y france-mcp [--toolsets entreprises,marches,...] [--list]

Toolsets :
${Object.entries(TOOLSETS)
  .map(([k, s]) => `  ${k.padEnd(12)} ${s.label} (${s.tools.length} outils)`)
  .join("\n")}

Variables : FRANCE_MCP_TOOLSETS (même rôle que --toolsets),
            PISTE_CLIENT_ID / PISTE_CLIENT_SECRET (active Légifrance).
`);
  process.exit(0);
}

const wanted = (option("toolsets") ?? process.env.FRANCE_MCP_TOOLSETS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const { tools, skipped } = selectTools(wanted);

if (args.includes("--list")) {
  for (const t of tools) process.stdout.write(`${t.toolset.padEnd(12)} ${t.name.padEnd(28)} ${t.title}\n`);
  if (skipped.length) process.stdout.write(`\n(désactivés faute de clé : ${skipped.join(", ")})\n`);
  process.exit(0);
}

const server = new McpServer(
  { name: "france-mcp", title: "France MCP — données publiques françaises", version: pkg.version },
  {
    instructions:
      "Accès aux données publiques officielles françaises. Enchaîner les outils : adresse_geocoder donne latitude/longitude et code INSEE, réutilisables dans cadastre_parcelle, dvf_ventes, energie_postes_sources, services_publics_trouver. Chaque réponse cite sa source officielle : la mentionner à l'utilisateur.",
  },
);

for (const tool of tools) {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.input,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const result = await tool.run(input);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: `Erreur (${tool.name}) : ${err.message}` }] };
      }
    },
  );
}

await server.connect(new StdioServerTransport());
process.stderr.write(`france-mcp ${pkg.version} prêt — ${tools.length} outils${skipped.length ? ` (sans ${skipped.join(", ")} : clé manquante)` : ""}\n`);
