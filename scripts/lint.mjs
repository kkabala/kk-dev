import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const SOURCE_ROOTS = ["src", "tests", "scripts"];
const CHECKED_EXTENSIONS = new Set([".js", ".mjs", ".ts"]);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
    } else if (CHECKED_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }
  return files;
}

function inspect(file, source) {
  const errors = [];
  if (source.includes("\r")) {
    errors.push("uses CRLF line endings");
  }
  if (!source.endsWith("\n")) {
    errors.push("has no final newline");
  }

  for (const [index, line] of source.split("\n").entries()) {
    if (/\s+$/.test(line)) {
      errors.push(`line ${index + 1} has trailing whitespace`);
    }
    if (line.includes("\t")) {
      errors.push(`line ${index + 1} contains a tab`);
    }
  }
  return errors.map((message) => `${file}: ${message}`);
}

const files = (await Promise.all(SOURCE_ROOTS.map(collectFiles))).flat().sort();
const failures = [];
for (const file of files) {
  failures.push(...inspect(file, await readFile(file, "utf8")));
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`lint: checked ${files.length} source files`);
}
