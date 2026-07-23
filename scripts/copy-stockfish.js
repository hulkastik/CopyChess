const fs = require('fs');
const path = require('path');

function tryCopy(src, dest) {
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`copied ${src} -> ${dest}`);
    return true;
  }
  return false;
}

const pkgRoot = process.cwd();
const publicDir = path.join(pkgRoot, 'public');
const nm = path.join(pkgRoot, 'node_modules', 'stockfish', 'bin');

// Reihenfolge ist Absicht:
// - "-single": kein SharedArrayBuffer, also keine COOP/COEP-Header noetig
// - "-lite":   7 MB statt 108 MB WASM. Kleineres NNUE-Netz, spielstaerkemaessig
//              immer noch weit ueber 3000 Elo — der grosse Build kostet nur
//              Ladezeit und Tab-Speicher.
const candidates = [
  { js: 'stockfish-18-lite-single.js', wasm: 'stockfish-18-lite-single.wasm' },
  { js: 'stockfish-18-single.js', wasm: 'stockfish-18-single.wasm' },
  { js: 'stockfish-18.js', wasm: 'stockfish-18.wasm' },
  { js: 'stockfish.js', wasm: 'stockfish.wasm' },
];

let ok = false;
for (const c of candidates) {
  const jsSrc = path.join(nm, c.js);
  const wasmSrc = path.join(nm, c.wasm);
  if (fs.existsSync(jsSrc) && fs.existsSync(wasmSrc)) {
    tryCopy(jsSrc, path.join(publicDir, 'stockfish.js'));
    tryCopy(wasmSrc, path.join(publicDir, 'stockfish.wasm'));
    ok = true;
    break;
  }
}

if (!ok) {
  console.warn('Could not find stockfish build in node_modules/stockfish/bin.');
  console.warn('If you installed stockfish as a package, run `npm run copy-stockfish` after install, or manually place stockfish.js and stockfish.wasm into public/.');
}
