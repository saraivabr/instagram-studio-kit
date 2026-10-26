// Install the packed SDK into an empty project and import every exported subpath by name.
// Unit tests import dist/ directly, so only this catches a broken exports map or files list.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const core = join(root, "packages/core");
const manifest = JSON.parse(readFileSync(join(core, "package.json"), "utf8"));
const workspace = mkdtempSync(join(tmpdir(), "studio-pack-"));
const npm = (args, cwd) => execFileSync("npm", args, { cwd, encoding: "utf8" });
try {
  const [{ filename }] = JSON.parse(npm(["pack", "--json", "--pack-destination", workspace], core));
  writeFileSync(
    join(workspace, "package.json"),
    JSON.stringify({ name: "smoke", private: true, type: "module" }),
  );
  npm(["install", "--no-audit", "--no-fund", join(workspace, filename)], workspace);
  const expected = {
    ".": ["createStudio", "createAi", "publishInstagram", "createSchema"],
    "./schemas": ["createSchema", "safeSource", "carouselTemplates"],
    "./ai": ["createAi", "openAiTransport", "maxPersonPhotos"],
    "./social": ["publishInstagram", "mutateAutomation", "SocialError"],
    "./studio": ["createStudio"],
  };
  const subpaths = Object.keys(manifest.exports);
  if (subpaths.sort().join() !== Object.keys(expected).sort().join())
    throw new Error(`exports mudou: ${subpaths.join(", ")}; atualize este teste.`);
  for (const [subpath, names] of Object.entries(expected)) {
    const specifier = manifest.name + subpath.slice(1);
    const source = `const m = await import(${JSON.stringify(specifier)});
for (const name of ${JSON.stringify(names)}) if (!(name in m)) throw new Error(${JSON.stringify(specifier)} + " sem " + name);`;
    execFileSync(process.execPath, ["--input-type=module", "-e", source], { cwd: workspace });
    console.log(`ok ${specifier}`);
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
