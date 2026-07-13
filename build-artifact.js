// Builds the single-file version of NEON RUSH for publishing.
// Usage: node build-artifact.js [outPath]
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const out = process.argv[2] || path.join(root, 'dist', 'neon-rush.html');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const inline = (file) => '<script>\n' + fs.readFileSync(path.join(root, file), 'utf8') + '\n</script>';

let result = html
  .replace('<script src="three.min.js"></script>', () => inline('three.min.js'))
  .replace('<script src="world.js"></script>', () => inline('world.js'))
  .replace('<script src="game.js"></script>', () => inline('game.js'))
  // the artifact host wraps content in its own doctype/head/body skeleton
  .replace(/^<!DOCTYPE html>\s*<html lang="en">\s*<head>\s*/i, '')
  .replace(/<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*/i, '')
  .replace('</head>\n<body>', '')
  .replace('</body>\n</html>', '');

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, result);
console.log('built', out, fs.statSync(out).size, 'bytes');
