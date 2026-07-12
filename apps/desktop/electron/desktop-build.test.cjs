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
