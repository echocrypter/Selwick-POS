
"use strict";

const fs = require("node:fs");
const path = require("node:path");

module.exports = async function (context) {
  const source = path.join(
    context.packager.projectDir,
    ".next",
    "standalone",
    "node_modules"
  );

  const destination = path.join(
    context.appOutDir,
    "resources",
    "server",
    "node_modules"
  );

  if (!fs.existsSync(source)) {
    throw new Error("Next.js standalone dependencies not found.");
  }

  fs.cpSync(source, destination, {
    recursive: true,
    force: true
  });

  console.log("Selwick POS: standalone dependencies copied.");
};
