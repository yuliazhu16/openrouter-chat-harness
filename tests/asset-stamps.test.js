// Every CSS/JS URL in site/ must carry the current content hash (ADR-0001 QST-PAGES-CACHE = A,
// provisional). Without it a browser can pair new index.html with old cached CSS/JS — which is
// exactly what broke yuliazhu's local Phase 2 layout twice (2026-11-20). See scripts/asset-stamp.mjs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SITE, assetHash, stampAssets, staleReferences } from '../scripts/asset-stamp.mjs';

describe('asset stamps', () => {
  it('every stylesheet, script, and module import in site/ is stamped with the current hash (run `just stamp-assets` if this fails)', () => {
    const { hash, stale } = staleReferences();
    assert.deepEqual(stale, [], `stale or missing ?v=${hash} stamps — run: just stamp-assets`);
  });

  it('editing any CSS or JS file changes the hash, so a forgotten re-stamp cannot pass the gate', () => {
    // A scratch copy of the real site; the working tree is never touched.
    const scratch = mkdtempSync(join(process.env.TMPDIR ?? '.', 'stamp-test-'));
    try {
      cpSync(SITE, scratch, { recursive: true });
      stampAssets(scratch);
      assert.deepEqual(staleReferences(scratch).stale, []);

      const css = join(scratch, 'css', 'styles.css');
      writeFileSync(css, `${readFileSync(css, 'utf8')}\n.later-edit { color: red; }\n`);

      const { stale } = staleReferences(scratch);
      assert.ok(stale.some((s) => s.startsWith('index.html')), 'index.html must now point at a new stylesheet URL');
      assert.ok(stale.some((s) => s.startsWith('js/app.js')), 'module imports must move to the new hash too');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('stamping is stable: re-stamping an already-stamped site changes nothing', () => {
    const scratch = mkdtempSync(join(process.env.TMPDIR ?? '.', 'stamp-test-'));
    try {
      cpSync(SITE, scratch, { recursive: true });
      const first = stampAssets(scratch);
      const second = stampAssets(scratch);
      assert.equal(second.hash, first.hash);
      assert.deepEqual(second.changed, []);
      assert.equal(assetHash(scratch), first.hash);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
