# Plan 15 — Telemetry & feedback (folded into plan-14)

Design: `design.md` §6.14, §6.10.5. Overview: [plan-00](plan-00-overview.md).

In v4 this is no longer a module (S9, F7). The file is kept so that plan numbering and links stay
stable. Here is where each piece went:

| v3 piece | Now | Plan |
| --- | --- | --- |
| `usage record` | a pure merge in the session's `turn_ctx`, written once in `commit_turn` as `meta.usage` | [plan-14](plan-14-session-runtime.md) step 14 |
| `decided_by` / hook-failure counters | part of the same usage record | plan-14 step 14 |
| `feedback submit` | `session-store submit_feedback` → `memory feedback` / `memory record` | plan-14 step 23 |
| `feedback implicit` | recorded by the session in `finalizing`; changes memory only when `decisions.feedback.implicit_enabled` | plan-14 step 23 |
| `usage report` | `agent-admin usage_report` over `meta.usage`, with the degraded-classifier flag | [plan-16](plan-16-interface-layer.md) |
| cost limits (new in v4) | per-user daily counters checked in `preparing`; agent-wide rollup by the janitor | plan-14 step 22, [plan-17](plan-17-maintenance.md) |

Why it was folded: usage is a merge the session already does, and feedback is one write plus one
memory call. A separate `feedback` wfspec in the Agent layer had to call `session-store` in the
Orchestration layer, a layering violation, while adding no behaviour.
