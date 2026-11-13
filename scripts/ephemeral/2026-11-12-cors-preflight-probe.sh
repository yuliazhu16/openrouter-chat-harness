#!/usr/bin/env bash
# 2026-11-12 — CORS probe for OpenRouter, by Switchboard 5.5 (Claude Opus 5.5)
#
# Context: hard requirement #2 of the OpenRouter Chat Harness is that the
# browser calls OpenRouter's Chat Completions API directly (no proxy). That
# only works if OpenRouter answers CORS correctly for an arbitrary GitHub
# Pages origin — including on ERROR responses (otherwise the browser hides the
# status/body and every failure reads as an opaque "Failed to fetch", which
# would make the "useful API error messages" requirement impossible).
# Evidence for ADR-0003. Needs NO API key: every probe is unauthenticated.
#
# A generic origin is used on purpose (no project/user identifiers sent out).
#
# Usage: bash scripts/ephemeral/2026-11-12-cors-preflight-probe.sh [origin]
set -uo pipefail

ORIGIN="${1:-https://example.github.io}"
BASE="https://openrouter.ai/api/v1"

show_cors() { grep -iE '^(HTTP/|access-control-|vary:|content-type:)' || true; }

echo "== 1. Preflight: OPTIONS /chat/completions (Origin: $ORIGIN)"
curl -sS -i -X OPTIONS "$BASE/chat/completions" \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type,http-referer,x-title" \
  | show_cors

echo
echo "== 2. Unauthenticated POST /chat/completions — is the ERROR readable cross-origin?"
curl -sS -i -X POST "$BASE/chat/completions" \
  -H "Origin: $ORIGIN" \
  -H "Content-Type: application/json" \
  -d '{"model":"openrouter/auto","messages":[{"role":"user","content":"ping"}]}' \
  | show_cors
echo "-- body:"
curl -sS -X POST "$BASE/chat/completions" \
  -H "Origin: $ORIGIN" -H "Content-Type: application/json" \
  -d '{"model":"openrouter/auto","messages":[{"role":"user","content":"ping"}]}'
echo

echo
echo "== 3. GET /models (public; could populate a model picker without a key)"
curl -sS -i "$BASE/models" -H "Origin: $ORIGIN" -o /dev/null -D - | show_cors

# ---------------------------------------------------------------------------
# OUTCOME (run 2026-11-12 by Switchboard 5.5, origin https://example.github.io):
#  1. Preflight → HTTP 204, access-control-allow-origin: *, allow-headers include
#     Authorization, Content-Type, HTTP-Referer, X-Title, X-Openrouter-Title.
#     Methods GET,OPTIONS,PATCH,DELETE,POST,PUT. → direct browser POST is allowed.
#  2. Unauthenticated POST → HTTP 401 WITH access-control-allow-origin: * and
#     JSON body {"error":{"message":"No cookie auth credentials found","code":401}}.
#     → error status + body ARE readable from page JS (useful errors possible),
#       but the raw message is misleading for a BYOK app: map 401 to our own text.
#  3. GET /models → HTTP 200, ACAO: * → a keyless model picker is feasible.
#  NOT verified here: an authenticated round-trip and SSE streaming from a real
#  browser tab — that is a Phase 1 manual check (see ADR-0003, ADR-0005).
#  Decision fed: ADR-0003 (direct fetch is viable; no proxy needed).
