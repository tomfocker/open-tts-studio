const childProcess = require("node:child_process");
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

function basePythonCopyOptions(basePythonRoot) {
  return {
    recursive: true,
    dereference: true,
    filter: (sourcePath) => shouldCopyBaseFile(basePythonRoot, sourcePath)
  };
}

function runtimePipArguments(apiRoot, sitePackages) {
  return [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "--no-input",
    "--upgrade",
    "--upgrade-strategy",
    "only-if-needed",
    "--target",
    sitePackages,
    apiRoot
  ];
}

function installRuntimeDependencies(venvPython, apiRoot, sitePackages, options = {}) {
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const result = spawnSync(venvPython, runtimePipArguments(apiRoot, sitePackages), {
    cwd: options.cwd || path.resolve(sitePackages, "..", "..", ".."),
    env: { ...process.env, PYTHONUTF8: "1" },
    stdio: options.stdio || "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`无法根据 apps/api/pyproject.toml 安装打包依赖（pip 退出码 ${result.status ?? "unknown"}）。`);
  }
}

function validateRuntimeDependencies(runtimePython, apiRoot, options = {}) {
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const code = [
    "import sys",
    "sys.path.insert(0, sys.argv[1])",
    "import fastapi, httpx, pydantic, qrcode, uvicorn, websockets",
    "from qrcode.image.pil import PilImage",
    "from tts_api.main import app"
  ].join("; ");
  const result = spawnSync(runtimePython, ["-c", code, apiRoot], {
    env: { ...process.env, PYTHONUTF8: "1" },
    stdio: options.stdio || "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("打包 Python 运行时依赖验证失败。");
  }
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
  const venvPythonExecutable = path.join(venvRoot, "Scripts", "python.exe");
  const apiSitePackages = path.join(venvRoot, "Lib", "site-packages");
  const runtimeSitePackages = path.join(runtimeRoot, "Lib", "site-packages");

  if (!basePythonRoot || !(await pathExists(basePythonExecutable))) {
    throw new Error("无法找到 API 虚拟环境对应的 Python 运行时。请先创建 apps/api/.venv。");
  }
  if (!(await pathExists(apiSitePackages))) {
    throw new Error("API 虚拟环境缺少 site-packages，无法打包。请先安装 apps/api 依赖。");
  }
  if (!(await pathExists(venvPythonExecutable))) {
    throw new Error("API 虚拟环境缺少 python.exe，无法同步 pyproject.toml 依赖。");
  }

  await fs.rm(runtimeRoot, { recursive: true, force: true });
  await fs.mkdir(runtimeRoot, { recursive: true });
  await fs.cp(basePythonRoot, runtimeRoot, basePythonCopyOptions(basePythonRoot));
  await fs.mkdir(runtimeSitePackages, { recursive: true });
  installRuntimeDependencies(venvPythonExecutable, apiRoot, runtimeSitePackages, options);
  validateRuntimeDependencies(path.join(runtimeRoot, "python.exe"), apiRoot, options);
  await fs.writeFile(
    path.join(runtimeRoot, "opentts-runtime.json"),
    JSON.stringify(
      { pythonHome: "bundled", sourceVenv: "apps/api/.venv", dependencySource: "apps/api/pyproject.toml" },
      null,
      2
    ),
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
  basePythonCopyOptions,
  installRuntimeDependencies,
  runtimePipArguments,
  shouldCopyBaseFile,
  validateRuntimeDependencies
};
