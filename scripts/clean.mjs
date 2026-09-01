import { rm } from "node:fs/promises";

const distributionDirectory = new URL("../dist/", import.meta.url);

await rm(distributionDirectory, { force: true, recursive: true });
