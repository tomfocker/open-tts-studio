const fs = require("node:fs/promises");
const path = require("node:path");

function parseVenvHome(content) {
  const match = String(content).match(/^home\s*=\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function shouldCopyBaseFile(sourceRoot, sourcePath) {
  const relative = path.relative(sourceRoot, sourcePath);
  const segments = relative.split(path.sep);
  return ![
    ["Lib", "site-packages"],
    ["Lib", "__pycache__"],
    ["include"],
    ["libs"],
    ["Scripts"]
  ].some((ignored) => ignored.every((segment, index) => segments[index] === segment));
}

async function preparePythonRuntime(options = {}) {
  const desktopRoot = options.desktopRoot || path.resolve(__dirname, "..");
  const apiRoot = options.apiRoot || path.resolve(desktopRoot, "..", "api");
  const venvRoot = options.venvRoot || path.join(apiRoot, ".venv");
  const runtimeRoot = options.runtimeRoot || path.join(desktopRoot, ".runtime", "python");
  const venvConfigPath = path.join(venvRoot, "pyvenv.cfg");
  const venvConfig = await fs.readFile(venvConfigPath, "utf8");
  const basePythonRoot = options.basePythonRoot || parseVenvHome(venvConfig);
  const basePythonExecutable = path.join(basePythonRoot, "python.exe");
  const apiSitePackages = path.join(venvRoot, "Lib", "site-packages");

  if (!basePythonRoot || !(await pathExists(basePythonExecutable))) {
    throw new Error("无法找到 API 虚拟环境对应的 Python 运行时。请先创建 apps/api/.venv。");
  }
  if (!(await pathExists(apiSitePackages))) {
    throw new Error("API 虚拟环境缺少 site-packages，无法打包。请先安装 apps/api 依赖。");
  }

  await fs.rm(runtimeRoot, { recursive: true, force: true });
  await fs.mkdir(runtimeRoot, { recursive: true });
  await fs.cp(basePythonRoot, runtimeRoot, {
    recursive: true,
    filter: (sourcePath) => shouldCopyBaseFile(basePythonRoot, sourcePath)
  });
  await fs.cp(apiSitePackages, path.join(runtimeRoot, "Lib", "site-packages"), { recursive: true });
  await fs.writeFile(
    path.join(runtimeRoot, "opentts-runtime.json"),
    JSON.stringify({ pythonHome: "bundled", sourceVenv: "apps/api/.venv" }, null, 2),
    "utf8"
  );

  return {
    basePythonRoot,
    runtimeRoot,
    pythonExecutable: path.join(runtimeRoot, "python.exe")
  };
}

if (require.main === module) {
  preparePythonRuntime()
    .then(({ runtimeRoot }) => process.stdout.write(`Prepared bundled Python runtime: ${runtimeRoot}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  parseVenvHome,
  preparePythonRuntime,
  shouldCopyBaseFile
};
