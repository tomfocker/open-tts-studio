const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { parseVenvHome, shouldCopyBaseFile } = require("./prepare-python-runtime.cjs");

test("parseVenvHome reads the base Python location from pyvenv.cfg", () => {
  assert.equal(parseVenvHome("home = C:\\Python312\nversion = 3.12.0\n"), "C:\\Python312");
  assert.equal(parseVenvHome("version = 3.12.0\n"), "");
});

test("shouldCopyBaseFile excludes only development-only Python directories", () => {
  const root = path.join("D:", "Python312");

  assert.equal(shouldCopyBaseFile(root, path.join(root, "python.exe")), true);
  assert.equal(shouldCopyBaseFile(root, path.join(root, "Lib", "encodings", "utf_8.py")), true);
  assert.equal(shouldCopyBaseFile(root, path.join(root, "Lib", "site-packages", "unused.py")), false);
  assert.equal(shouldCopyBaseFile(root, path.join(root, "Scripts", "pip.exe")), false);
});
