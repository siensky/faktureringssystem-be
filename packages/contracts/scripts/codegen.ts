// Genererar TypeScript-typer ur JSON Schema-filerna i schemas/. Schemat är
// källan till sanning — typerna i src/generated/ är en byggd artefakt av
// det, aldrig handskrivna vid sidan av (planens "packages/contracts når
// även Python"-avsnitt). CI kör detta skript och diffar mot committade
// filer (`git diff --exit-code`) för att fånga drift mellan schema och typ.
//
// Körs med: bun run codegen (från repo-roten) eller bun run scripts/codegen.ts
// (från packages/contracts).

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";
import { loadSchema } from "../src/schema-loader";

const here = dirname(fileURLToPath(import.meta.url));
const contractsRoot = dirname(here);
const generatedDir = join(contractsRoot, "src", "generated");

const HEADER = `/* eslint-disable */
/**
 * Denna fil är GENERERAD av packages/contracts/scripts/codegen.ts.
 * Ändra inte här — ändra motsvarande .schema.json och kör \`bun run codegen\`.
 */

`;

async function generateOne(schemaRelativePath: string, typeName: string, outFileName: string) {
  const schema = loadSchema(schemaRelativePath);
  const ts = await compile(schema as any, typeName, {
    additionalProperties: false,
    bannerComment: "",
    style: { semi: true, singleQuote: false },
  });
  await mkdir(generatedDir, { recursive: true });
  await writeFile(join(generatedDir, outFileName), HEADER + ts, "utf8");
  console.log(`  ✓ ${outFileName}`);
}

async function main() {
  console.log("Genererar TS-typer ur JSON Schema...");
  await generateOne("schemas/envelope.schema.json", "EventEnvelope", "envelope.ts");

  const eventsDir = join(contractsRoot, "schemas", "events");
  const eventFiles = (await readdir(eventsDir).catch(() => [])).filter((f) =>
    f.endsWith(".schema.json"),
  );
  for (const file of eventFiles) {
    const typeName = file
      .replace(".schema.json", "")
      .split(/[-_]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
    const outFileName = file.replace(".schema.json", ".ts");
    await generateOne(join("schemas", "events", file), typeName, outFileName);
  }

  console.log("Klart.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
