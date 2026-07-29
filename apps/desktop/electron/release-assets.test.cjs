const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { expectedReleaseAssetNames, sha256, verifyReleaseAssets } = require("./release-assets.cjs");

async function createReleaseFixture(version = "0.1.2") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open-tts-release-assets-"));
  const releaseDirectory = path.join(root, "release");
  const packagePath = path.join(root, "package.json");
  const names = expectedReleaseAssetNames(version);

  await fs.mkdir(releaseDirectory, { recursive: true });
  await fs.writeFile(packagePath, JSON.stringify({ version }), "utf8");
  await fs.writeFile(path.join(releaseDirectory, names.installer), "installer", "utf8");
  await fs.writeFile(path.join(releaseDirectory, names.blockmap), "blockmap", "utf8");
  await fs.writeFile(path.join(releaseDirectory, names.portable), "portable", "utf8");
  await fs.writeFile(
    path.join(releaseDirectory, names.metadata),
    `version: ${version}\nfiles:\n  - url: ${names.installer}\npath: ${names.installer}\n`,
    "utf8"
  );

  return { root, releaseDirectory, packagePath, names };
}

test("verifyReleaseAssets validates matching updater metadata and writes checksums", async (t) => {
  const fixture = await createReleaseFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  const result = await verifyReleaseAssets({
    releaseDirectory: fixture.releaseDirectory,
    packagePath: fixture.packagePath
  });

  assert.equal(result.version, "0.1.2");
  const checksums = await fs.readFile(path.join(fixture.releaseDirectory, fixture.names.checksums), "utf8");
  assert.match(checksums, new RegExp(`${sha256(Buffer.from("installer"))} \\*${fixture.names.installer}`));
  assert.match(checksums, new RegExp(`${sha256(Buffer.from("portable"))} \\*${fixture.names.portable}`));
});

test("verifyReleaseAssets rejects stale updater metadata", async (t) => {
  const fixture = await createReleaseFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  await fs.writeFile(path.join(fixture.releaseDirectory, fixture.names.metadata), "version: 0.1.1\n", "utf8");

  await assert.rejects(
    verifyReleaseAssets({ releaseDirectory: fixture.releaseDirectory, packagePath: fixture.packagePath }),
    /does not declare version 0\.1\.2/
  );
});
