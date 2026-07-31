const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { LOCAL_MEDIA_SCHEME, createLocalMediaRegistry, parseByteRange } = require("./local-media-runtime.cjs");

test("local media registry exposes an opaque token instead of a local file path", () => {
  const registry = createLocalMediaRegistry({ createToken: () => "preview-token" });
  const url = registry.register("C:/Users/Test/Downloads/video preview.mp4");

  assert.equal(url, `${LOCAL_MEDIA_SCHEME}://local/preview-token`);
  assert.doesNotMatch(url, /Users|video preview/i);
  assert.equal(
    registry.resolve(url),
    "file:///C:/Users/Test/Downloads/video%20preview.mp4"
  );
  assert.equal(registry.resolve(`${LOCAL_MEDIA_SCHEME}://local/unknown`), null);
  assert.equal(registry.resolve("https://example.com/video.mp4"), null);
});

test("local media registry bounds retained preview paths and supports revocation", () => {
  const tokens = ["first", "second", "third"];
  const registry = createLocalMediaRegistry({ createToken: () => tokens.shift(), maxEntries: 2 });
  const first = registry.register(path.join("C:", "downloads", "first.mp4"));
  const second = registry.register(path.join("C:", "downloads", "second.mp4"));
  const third = registry.register(path.join("C:", "downloads", "third.mp4"));

  assert.equal(registry.size(), 2);
  assert.equal(registry.resolve(first), null);
  assert.match(registry.resolve(second), /second\.mp4$/);
  registry.revoke(third);
  assert.equal(registry.size(), 1);
  assert.equal(registry.resolve(third), null);
});

test("byte range parser produces standards-compliant video seek ranges", () => {
  assert.deepEqual(parseByteRange("bytes=100-299", 1_000), { start: 100, end: 299, length: 200 });
  assert.deepEqual(parseByteRange("bytes=800-", 1_000), { start: 800, end: 999, length: 200 });
  assert.deepEqual(parseByteRange("bytes=-150", 1_000), { start: 850, end: 999, length: 150 });
  assert.deepEqual(parseByteRange("bytes=950-2000", 1_000), { start: 950, end: 999, length: 50 });
  assert.equal(parseByteRange(null, 1_000), null);
});

test("byte range parser rejects invalid and unsatisfiable seeks", () => {
  assert.deepEqual(parseByteRange("bytes=1000-", 1_000), { unsatisfiable: true });
  assert.deepEqual(parseByteRange("bytes=300-100", 1_000), { unsatisfiable: true });
  assert.deepEqual(parseByteRange("bytes=0-1,4-5", 1_000), { unsatisfiable: true });
  assert.deepEqual(parseByteRange("bytes=-0", 1_000), { unsatisfiable: true });
});
