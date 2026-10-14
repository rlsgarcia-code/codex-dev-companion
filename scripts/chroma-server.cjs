"use strict";

const path = require("node:path");
const binding = require(path.join(__dirname, "chromadb.node"));

binding.cli(["chroma", ...process.argv.slice(2)]);
