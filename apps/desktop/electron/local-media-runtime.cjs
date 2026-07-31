const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");

const LOCAL_MEDIA_SCHEME = "opentts-media";
const DEFAULT_MAX_ENTRIES = 24;

function parseByteRange(rangeHeader, totalBytes) {
  if (!rangeHeader) {
    return null;
  }
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) {
    return { unsatisfiable: true };
  }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader).trim());
  if (!match || (!match[1] && !match[2])) {
    return { unsatisfiable: true };
  }

  const [, startText, endText] = match;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { unsatisfiable: true };
    }
    const length = Math.min(suffixLength, totalBytes);
    return { start: totalBytes - length, end: totalBytes - 1, length };
  }

  const start = Number(startText);
  if (!Number.isSafeInteger(start) || start < 0 || start >= totalBytes) {
    return { unsatisfiable: true };
  }
  const requestedEnd = endText ? Number(endText) : totalBytes - 1;
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) {
    return { unsatisfiable: true };
  }
  const end = Math.min(requestedEnd, totalBytes - 1);
  return { start, end, length: end - start + 1 };
}

function createLocalMediaRegistry(dependencies = {}) {
  const pathImpl = dependencies.path ?? path;
  const toFileUrl = dependencies.pathToFileURL ?? pathToFileURL;
  const createToken = dependencies.createToken ?? randomUUID;
  const maxEntries = Number.isFinite(dependencies.maxEntries) ? Math.max(1, Math.trunc(dependencies.maxEntries)) : DEFAULT_MAX_ENTRIES;
  const records = new Map();

  function register(filePath) {
    if (typeof filePath !== "string" || !filePath.trim()) {
      throw new Error("Local media path is required");
    }
    const token = String(createToken());
    const normalizedPath = pathImpl.resolve(filePath);
    records.set(token, normalizedPath);
    while (records.size > maxEntries) {
      records.delete(records.keys().next().value);
    }
    return `${LOCAL_MEDIA_SCHEME}://local/${token}`;
  }

  function resolve(requestUrl) {
    try {
      const parsed = new URL(requestUrl);
      if (parsed.protocol !== `${LOCAL_MEDIA_SCHEME}:` || parsed.hostname !== "local") {
        return null;
      }
      const token = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
      const filePath = records.get(token);
      return filePath ? toFileUrl(filePath).toString() : null;
    } catch {
      return null;
    }
  }

  return {
    register,
    resolve,
    revoke(url) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === `${LOCAL_MEDIA_SCHEME}:` && parsed.hostname === "local") {
          records.delete(decodeURIComponent(parsed.pathname.replace(/^\//, "")));
        }
      } catch {
        // Ignore malformed values; callers can safely clean up in finally blocks.
      }
    },
    size() {
      return records.size;
    }
  };
}

module.exports = {
  LOCAL_MEDIA_SCHEME,
  createLocalMediaRegistry,
  parseByteRange
};
