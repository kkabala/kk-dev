# Exoframe task workflow

Copy this checklist and keep it updated.

```
- [ ] Repository facts discovered
- [ ] ScopeFacts extracted (predicted paths, not a risk opinion)
- [ ] Accepted `.exoframe/surfaces.json` loaded, or bootstrap PR opened and stopped
- [ ] parseScopeFacts, then matchSurfaces + classifyRisk(predicted) + applyScopeFacts
- [ ] Assignment sent to pstack/poteto-mode
- [ ] Actual diff classified
- [ ] reevaluateRisk(...).decision used as post-diff RiskDecision for gates
- [ ] Protected gates measured
- [ ] Draft PR updated
```

## ScopeFacts shape

```json
{
  "schema_version": 1,
  "predicted_paths": ["src/app-team/Settings.ts"],
  "change_types": ["ui"],
  "sensitive": {
    "money": false,
    "auth": false,
    "permissions": false,
    "persistent_data": false,
    "external_api": false,
    "infrastructure": false
  },
  "blast_radius": "LOCAL",
  "uncertainty": "KNOWN"
}
```

`uncertainty` is `KNOWN`, `PARTIALLY_KNOWN`, or `UNKNOWN`. Never a probability.

If you cannot name the files, set `uncertainty` to `UNKNOWN`. That raises risk. Do not guess a low tier.

## Ticket keywords are not enough

A ticket that says "send a notification" still needs predicted paths. If those paths include a transaction processor, facts must set `sensitive.money` true and include those paths. `classifyRisk` then hits the payments/transactions surface floor.

## Pre-work vs post-diff

Pre-work `diff.paths` are `ScopeFacts.predicted_paths`.

Post-diff `diff.paths` are the candidate's actual relative paths.

Call `parseScopeFacts`, then `applyScopeFacts` with that parsed object. After a candidate, use `reevaluateRisk({ planned, actual }).decision` as the post-diff `RiskDecision` for gates. `overall` on that decision is the max of planned and actual. Extra actual paths set `escalated` true even when the tier number stays the same.

The CLI loads accepted policy from `.exoframe/surfaces.json`. Bootstrap writes human-readable `.exoframe/proposals/surfaces.yaml`, full catalog `.exoframe/proposals/catalog.json`, and `matchSurfaces` proposal `.exoframe/proposals/surfaces.json`. Do not copy yaml into `.exoframe/surfaces.yaml` and expect the CLI to load it.

## Protected gates

Use a template id from the accepted catalog. Never interpolate shell. Infrastructure errors retry then block. Mixed outcomes for one evidence key stay FLAKY.
