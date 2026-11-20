# The Check That Grew With the Bug

**Date**: 2026-11-19
**Authors**: Switchboard 5.5 (Claude Opus 5.5), with yuliazhu
**Topic**: A green "no horizontal overflow" check that was measuring the bug against itself, caught by a screenshot that looked slightly *small*.

## The Discovery

Phase 2 added a conversation drawer, so the phone top bar gained two buttons: ☰ and +. The headless-Chrome smoke script ran 34 checks and all passed, including this one, carried over from Phase 1:

```js
check('phone: no horizontal overflow',
  await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`));
```

The screenshots came next, because Phase 1's screenshots had caught a clipped placeholder that no check saw. The first one showed an obvious bug: the composer floated mid-screen. A hidden banner (`display: none`) had dropped out of the CSS grid, so every later row shifted up by one. That was fixed in a line, and a check for it was added.

The second problem was subtler: after the fix, the phone screenshot looked *slightly small*. The measurements didn't fit: the emulated device was 844px tall, but `window.innerHeight` reported **953**. 844 / 953 ≈ 0.886, which is the ratio Chrome uses when it zooms a page out to fit content wider than the device. A probe script listed every element past x = 390:

```
configured { "innerWidth": 441, "scrollWidth": 441,
  "wide": ["header.topbar right=440 w=440", ...] }
```

The top bar's min-content width was 441px. An implicit `auto` grid column can't shrink below its content's min-content width, so the model chip never got the chance to truncate. On a real phone the whole app would load zoomed out to 88%.

## The "Aha"

The overflow check compared `scrollWidth` with `innerWidth`. But when the layout overflows, mobile Chrome **widens the layout viewport to fit it**, so `innerWidth` became 441 as well. The check compared the bug with itself and reported 441 ≤ 441. It could never fail on the failure it was written to catch.

The fix was two `minmax(0, 1fr)` column templates. The check now compares against the number that doesn't move:

```js
check('phone: layout is exactly 390px wide (no zoom-out, no horizontal scroll)',
  width.innerWidth === 390 && width.scrollWidth === 390);
```

It is now known to be able to fail: with each fix removed, its check goes red.

## Fourth Directive at Work

*"Tests that pass but don't actually verify correct behavior"* usually means a mock that returns what it was told to return. This was a quieter version: a real measurement in a real browser whose **reference point moved with the defect**. That is why the storage tests in the same session were also **mutation-checked**. Three deliberate breakages of `storage.js` (no orphan-key scan, trimming corrupt chats, Clear deleting every `orch:` key) were each caught by the intended test before the suite was trusted.

## Lessons Learned

1. **A check is only as good as its reference point.** If the yardstick can move with the bug, compare against a constant (the device width), not against another measurement of the same page.
2. **Prove a new check can fail.** Remove the fix once and watch it go red. This session did that for both layout checks and for three storage mutations.
3. **Look at the screenshot even when everything is green.** This project's screenshots have now caught three layout bugs that checks missed (Phase 1's clipped placeholder; Phase 2's stretched composer and the zoom-out). For the zoom-out, the only signal was that the screenshot looked *slightly too small*.

## Metacognitive Insight

The vacuous check came from Phase 1, when the top bar had two fewer buttons. Whether it was vacuous then too was never verified, because it couldn't have told us. It was copied forward with its assumptions and no new review. Inherited checks carry the context they were written in. When a change makes a check *more* relevant (here, more buttons in a narrow bar), re-read what it actually measures.
