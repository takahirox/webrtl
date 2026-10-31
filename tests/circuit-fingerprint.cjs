const { createHash } = require("node:crypto");
const { readdirSync, openSync, readSync, closeSync } = require("node:fs");
const { join } = require("node:path");

// Hash the actual served build, including RTL, adapters, headers and every
// pinned compiler binary. No persistent cache or timestamps are trusted.
function circuitFingerprint(directory, identity) {
  const hash = createHash("sha256").update(JSON.stringify(identity));
  const buffer = Buffer.alloc(1024 * 1024);
  function visit(relative) {
    for (const entry of readdirSync(join(directory, relative), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) visit(path);
      else {
        if (!entry.isFile()) throw new Error(`Unexpected build entry: ${path}`);
        const fileHash = createHash("sha256");
        const fd = openSync(join(directory, path), "r");
        try {
          let length;
          while ((length = readSync(fd, buffer, 0, buffer.length, null))) fileHash.update(buffer.subarray(0, length));
        } finally { closeSync(fd); }
        hash.update(JSON.stringify([path, fileHash.digest("hex")]));
      }
    }
  }
  visit("");
  return hash.digest("hex");
}

module.exports = { circuitFingerprint };
