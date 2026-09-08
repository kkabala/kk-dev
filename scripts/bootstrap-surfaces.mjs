import path from "node:path";
import process from "node:process";

const checkoutRoot = path.resolve(process.argv[2] ?? process.cwd());
const distDirectory = new URL("../dist/", import.meta.url);

function isMissingModule(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ERR_MODULE_NOT_FOUND" || error.code === "ENOENT")
  );
}

async function loadBootstrap() {
  const candidates = [
    new URL("./risk-bootstrap.js", distDirectory),
    new URL("./index.js", distDirectory),
  ];
  let lastMissing = true;
  for (const candidate of candidates) {
    try {
      const module = await import(candidate.href);
      if (
        typeof module.bootstrapSurfaces === "function" &&
        typeof module.writeBootstrapProposals === "function"
      ) {
        return module;
      }
    } catch (error) {
      lastMissing = isMissingModule(error);
      if (!lastMissing) {
        throw error;
      }
    }
  }
  throw new Error("run npm run build first");
}

const { bootstrapSurfaces, writeBootstrapProposals } = await loadBootstrap();
const result = await bootstrapSurfaces(checkoutRoot);
await writeBootstrapProposals(checkoutRoot, result.catalog, result.yaml);
process.stdout.write(result.yaml);
