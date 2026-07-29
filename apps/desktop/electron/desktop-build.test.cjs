const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("packaged frontend uses relative asset paths for file loading", () => {
  const distIndex = path.resolve(__dirname, "..", "dist", "index.html");
  const html = fs.readFileSync(distIndex, "utf-8");

  assert.match(html, /src="\.\/assets\//);
  assert.match(html, /href="\.\/assets\//);
  assert.doesNotMatch(html, /src="\/assets\//);
  assert.doesNotMatch(html, /href="\/assets\//);
});

test("desktop package bundles the FFmpeg executable used by Doubao AAC conversion", () => {
  const desktopRoot = path.resolve(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf-8"));
  const resource = manifest.build.extraResources.find((item) => item.to === "ffmpeg/ffmpeg.exe");

  assert.ok(resource);
  assert.equal(resource.from, "node_modules/ffmpeg-static/ffmpeg.exe");
  assert.ok(fs.existsSync(path.join(desktopRoot, resource.from)));
});
