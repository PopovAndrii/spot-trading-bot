# Grid marks: ✓ and ✗

With Hybrid on, most rungs in the scalp zone carry a small **✓** or **✗** in the close
cell. They are a **forecast**: *if this rung fills, will the scalp be allowed here?* You
get the answer before a single order fills — which is exactly when you're setting the
knobs.

> 📷 **Screenshot:** table rows showing green ✓ and red ✗ marks.

## What the marks mean

| Mark | Meaning |
|---|---|
| **✓** (green) | **The scalp fits here.** The micro on this rung stays on the safe side of the split — it can be placed. |
| **✗** (red) | **No scalp here.** The micro would cross the split, so it is refused. |

The engine refuses a crossing micro **silently** — without these marks, a rung would
simply never scalp and nothing would tell you why. The marks make that visible up front.

Only rungs **at or below** *Grid from order* are forecast (shallower rungs are pure DCA
and never scalp, so they carry no mark). The rung that is **actually carrying a live
micro** shows the real [micro badge](/hybrid/badges) instead of a forecast — the live
order wins its own row.

## How the knobs move the marks

A ✗ becomes a ✓ when the micro gains room under the split. Two levers do that:

- **Raise [Grid exit %](/hybrid/parameters#grid-exit)** → pushes the split toward the
  close → more room below it → more ✓. (This is exactly what
  [Auto exit](/hybrid/parameters#auto-exit) does automatically when a rung blocks.)
- **Lower [Micro profit %](/hybrid/parameters#micro-profit)** → the micro needs less
  room → fits under a tighter split → more ✓.

The two are interchangeable levers on the same gap: one moves the boundary out, the
other shrinks what has to fit under it. Watch the marks flip as you drag either — that
is the fastest way to feel how the scalp zone responds.

::: tip
A row of ✗ near the top of the zone with ✓ deeper down is normal: shallow rungs leave a
tiny gap between entry and close, so the micro rarely fits; deeper rungs open the gap up.
:::
