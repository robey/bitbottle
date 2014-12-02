#!/usr/bin/env node

var fs = require("fs");
var JSON5 = require("json5");

var package = JSON5.parse(fs.readFileSync("./package.json5"));
fs.writeFileSync("./package.json", JSON.stringify(package, null, 2));
