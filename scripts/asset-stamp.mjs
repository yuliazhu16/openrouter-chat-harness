#!/usr/bin/env node
// Content-hash stamps on every CSS/JS URL in site/ (ADR-0001 QST-PAGES-CACHE, option A).
//
// Why: a browser keyed its cache by URL and paired NEW index.html with OLD styles.css/app.js —
// twice, locally (heuristic caching from a no-Cache-Control server), and the same mix is due on
// GitHub Pages (max-age=600) right after a deploy. When every reference carries ?v=<hash of the
// current site/css + site/js>, new HTML asks for URLs no cache can hold, so old CSS/JS can never
// be paired with it. Still no build step: the files are served exactly as written.
//
// Stamped references:  index.html  href="./css/*.css?v=…"  src="./js/*.js?v=…"
//                      site/js/*.js  import … from './x.js?v=…'
// The hash is computed with existing stamps stripped, so stamping doesn't change it.
//
// CLI:   node scripts/asset-stamp.mjs          rewrite all stamps (just stamp-assets)
//        node scripts/asset-stamp.mjs --check  exit 1 if any stamp is stale
// Test:  tests/asset-stamps.test.js runs the check inside `just gate` and CI.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'site');

const STAMP = /\?v=[0-9a-f]{8}/g;
// index.html: ./css/… and ./js/… references (href/src), with or without a stamp
const HTML_REF = /((?:href|src)="\.\/(?:css|js)\/[\w./-]+?\.(?:css|js))(?:\?v=[0-9a-f]{8})?"/g;
// js modules: static `from './x.js'` and dynamic `import('./x.js')`, relative only
const JS_REF = /((?:from\s+|import\s*\(\s*)['"]\.{1,2}\/[\w./-]+?\.js)(?:\?v=[0-9a-f]{8})?(['"])/g;

const filesUnder = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]))
    .sort();

/** 8-hex hash over site/css + site/js (paths + contents), ignoring the stamps themselves. */
export function assetHash(site = SITE) {
  const h = createHash('sha256');
  for (const file of [...filesUnder(join(site, 'css')), ...filesUnder(join(site, 'js'))]) {
    h.update(relative(site, file)).update('\0');
    h.update(readFileSync(file, 'utf8').replace(STAMP, '')).update('\0');
  }
  return h.digest('hex').slice(0, 8);
}

/** Every file that carries references, with its text rewritten to `hash`. */
function restamped(site, hash) {
  const out = [];
  const html = join(site, 'index.html');
  out.push([html, readFileSync(html, 'utf8').replace(HTML_REF, `$1?v=${hash}"`)]);
  for (const file of filesUnder(join(site, 'js')).filter((f) => f.endsWith('.js'))) {
    out.push([file, readFileSync(file, 'utf8').replace(JS_REF, `$1?v=${hash}$2`)]);
  }
  return out;
}

/** References whose stamp is missing or stale, as "file: reference" strings. */
export function staleReferences(site = SITE) {
  const hash = assetHash(site);
  const stale = [];
  const scan = (file, text, pattern) => {
    for (const m of text.matchAll(pattern)) {
      if (!m[0].includes(`?v=${hash}`)) stale.push(`${relative(site, file)}: ${m[0]}`);
    }
  };
  const html = join(site, 'index.html');
  scan(html, readFileSync(html, 'utf8'), HTML_REF);
  for (const file of filesUnder(join(site, 'js')).filter((f) => f.endsWith('.js'))) {
    scan(file, readFileSync(file, 'utf8'), JS_REF);
  }
  return { hash, stale };
}

/** Rewrite every stamp to the current hash. Returns { hash, changed: [relative paths] }. */
export function stampAssets(site = SITE) {
  const hash = assetHash(site);
  const changed = [];
  for (const [file, text] of restamped(site, hash)) {
    if (readFileSync(file, 'utf8') !== text) {
      writeFileSync(file, text);
      changed.push(relative(site, file));
    }
  }
  return { hash, changed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const { hash, stale } = staleReferences();
    if (stale.length) {
      console.error(`❌ ${stale.length} asset reference(s) not stamped with ?v=${hash} — run: just stamp-assets`);
      for (const s of stale) console.error(`   ${s}`);
      process.exit(1);
    }
    console.log(`✅ asset stamps current (?v=${hash})`);
  } else {
    const { hash, changed } = stampAssets();
    console.log(changed.length ? `stamped ?v=${hash} → ${changed.join(', ')}` : `stamps already current (?v=${hash})`);
  }
}
