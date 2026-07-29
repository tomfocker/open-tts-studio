const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  basePythonCopyOptions,
  installRuntimeDependencies,
  parseVenvHome,
  runtimePipArguments,
  shouldCopyBaseFile,
  validateRuntimeDependencies
} = require("./prepare-python-runtime.cjs");

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

test("basePythonCopyOptions dereferences Python launcher links for Windows packaging", () => {
  const options = basePythonCopyOptions(path.join("D:", "Python312"));

  assert.equal(options.recursive, true);
  assert.equal(options.dereference, true);
});

test("runtimePipArguments installs the API project and its declared dependencies into the bundle", () => {
  const apiRoot = path.join("D:", "workspace", "apps", "api");
  const sitePackages = path.join("D:", "bundle", "Lib", "site-packages");
  const args = runtimePipArguments(apiRoot, sitePackages);

  assert.deepEqual(args.slice(0, 3), ["-m", "pip", "install"]);
  assert.equal(args.at(-1), apiRoot);
  assert.equal(args[args.indexOf("--target") + 1], sitePackages);
  assert.ok(args.includes("--upgrade-strategy"));
});

test("installRuntimeDependencies fails the package build when pip cannot sync pyproject dependencies", () => {
  assert.throws(
    () => installRuntimeDependencies("python.exe", "api", "site-packages", { spawnSync: () => ({ status: 1 }), stdio: "pipe" }),
    /pip 退出码 1/
  );
});

test("validateRuntimeDependencies checks QR and web runtime imports", () => {
  let invocation;
  validateRuntimeDependencies("runtime-python.exe", "api-root", {
    spawnSync: (filePath, args) => {
      invocation = { filePath, args };
      return { status: 0 };
    },
    stdio: "pipe"
  });

  assert.equal(invocation.filePath, "runtime-python.exe");
  assert.equal(invocation.args.at(-1), "api-root");
  assert.match(invocation.args[1], /qrcode/);
  assert.match(invocation.args[1], /websockets/);
  assert.match(invocation.args[1], /PilImage/);
  assert.match(invocation.args[1], /tts_api\.main/);
});
