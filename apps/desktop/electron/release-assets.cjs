const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

function expectedReleaseAssetNames(version) {
  return {
    installer: `OpenTTS-Studio-Setup-${version}-x64.exe`,
    blockmap: `OpenTTS-Studio-Setup-${version}-x64.exe.blockmap`,
    portable: `OpenTTS-Studio-Portable-${version}-x64.exe`,
    metadata: "latest.yml",
    checksums: `OpenTTS-Studio-${version}-checksums.txt`
  };
}

async function readNonEmptyFile(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Release asset is empty: ${filePath}`);
  }
  return fs.readFile(filePath);
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function verifyReleaseAssets(options = {}) {
  const desktopRoot = options.desktopRoot || path.resolve(__dirname, "..");
  const releaseDirectory = options.releaseDirectory || path.join(desktopRoot, "release");
  const packagePath = options.packagePath || path.join(desktopRoot, "package.json");
  const packageJson = JSON.parse(await fs.readFile(packagePath, "utf8"));
  const names = expectedReleaseAssetNames(packageJson.version);
  const assetNames = [names.installer, names.blockmap, names.portable, names.metadata];
  const contents = new Map();

  for (const name of assetNames) {
    const filePath = path.join(releaseDirectory, name);
    try {
      contents.set(name, await readNonEmptyFile(filePath));
    } catch (error) {
      if (error && error.code === "ENOENT") {
        throw new Error(`Required release asset is missing: ${filePath}`);
      }
      throw error;
    }
  }

  const metadata = contents.get(names.metadata).toString("utf8");
  if (!metadata.includes(`version: ${packageJson.version}`)) {
    throw new Error(`latest.yml does not declare version ${packageJson.version}.`);
  }
  if (!metadata.includes(`url: ${names.installer}`) || !metadata.includes(`path: ${names.installer}`)) {
    throw new Error(`latest.yml does not point to ${names.installer}.`);
  }

  const checksumLines = assetNames
    .map((name) => `${sha256(contents.get(name))} *${name}`)
    .join("\n");
  const checksumPath = path.join(releaseDirectory, names.checksums);
  await fs.writeFile(checksumPath, `${checksumLines}\n`, "utf8");

  return {
    version: packageJson.version,
    releaseDirectory,
    checksumPath,
    assetNames: [...assetNames, names.checksums]
  };
}

if (require.main === module) {
  verifyReleaseAssets()
    .then(({ version, checksumPath }) => process.stdout.write(`Verified release assets for ${version}; wrote ${checksumPath}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  expectedReleaseAssetNames,
  sha256,
  verifyReleaseAssets
};
