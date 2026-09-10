// Läser schemafiler från disk med en relativ sökväg som är identisk oavsett
// om koden körs lokalt, i CI, eller inuti en Docker-image — så länge
// packages/contracts/ kopieras med bevarad mappstruktur relativt tjänsten
// (se infra-Dockerfiles). Ingen bundling, inget importassertion-krångel:
// Bun kör .ts direkt, och JSON läses som vanlig text + JSON.parse.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url))); // .../packages/contracts

export function loadSchema(relativePath: string): Record<string, unknown> {
  const fullPath = join(packageRoot, relativePath);
  return JSON.parse(readFileSync(fullPath, "utf8"));
}

export function loadFixture(name: string): unknown {
  return loadSchema(join("fixtures", name));
}
