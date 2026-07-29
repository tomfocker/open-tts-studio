const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const electronDirectory = __dirname;
const testFiles = fs
  .readdirSync(electronDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.cjs"))
  .map((entry) => path.join(electronDirectory, entry.name))
  .sort();

if (testFiles.length === 0) {
  throw new Error(`No Electron test files found in ${electronDirectory}.`);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit"
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status === null ? 1 : result.status;
