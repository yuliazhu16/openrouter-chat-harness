#!/usr/bin/env bash
# Fail if anything resembling an OpenRouter API key is committable.
#
# BYOK app in a public repo: a committed key is the costliest possible mistake
# (ADR-0002). Scans tracked AND untracked-but-not-ignored files — i.e. anything
# that could be committed next. Key shape: sk-or-v1-<64 hex>; the 32+ threshold
# keeps documentation placeholders like `sk-or-v1-…` from matching.
#
# One source of truth, two callers: `just secret-scan` (local gate) and the
# test job of .github/workflows/pages.yml (CI gate, ADR-0005 QST-DEPLOY-GATE).
set -uo pipefail

if git grep --untracked -nIE 'sk-or-v1-[0-9a-fA-F]{32,}' -- . ; then
    echo "❌ secret-scan: possible OpenRouter API key above — remove it (and rotate the key if it was ever pushed)" >&2
    exit 1
fi
echo "✅ secret-scan: no OpenRouter keys found"
