# ChatGPT hard output budget repair — 5 October 2026

## Finding and contract

The official [SIWC preview requirements](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations#responses-api-requirements)
exclude `max_output_tokens` from HTTP Responses requests. The desktop assignment
adapter previously discarded a required output limit, while its executor
advertised `plan_inference_limits_v1`. That combination falsely represented an
unbounded request as eligible for bounded private work.

The adapter now preserves the requested budget through transport preflight.
ChatgptPlanClient rejects a required hard output limit before model discovery or
inference, with a fixed admission error. It does not silently discard the limit
or send an unsupported field. Ordinary supported interactive requests retain
their existing streaming transport. The production executor no longer advertises
hard output limits merely because an assignment handler exists. A genuinely
bounded adapter must explicitly declare that capability.

Private jobs requiring hard output limits therefore remain ineligible on this
SIWC route. This is an external compatibility constraint, not completion of
bounded private ChatGPT execution. Managed fallback still requires explicit
consent and its own enforced budget; this repair does not enable fallback.

## Evidence and remaining gates

- The new fail-before-network regression failed against the prior transport:
  `/tmp/orbyn-chatgpt-limit-docs-baseline.log`.
- Transport, real registration/model adapter, and executor unit cohorts passed
  42/42, zero skips/failures, terminal exit 0:
  `/tmp/orbyn-siwc-budget-precommit.log`.
- All workspace typechecks passed, terminal exit 0:
  `/tmp/orbyn-siwc-budget-all-types.log`.
- Existing budget range assertions remain; supported field, completed-stream,
  account/default binding and quota failure assertions remain active. Synthetic
  bounded executor fixtures explicitly declare their bounded capability.

Exact committed-head full local tests and CI are still required. These checks do
not establish real positive OpenAI inference, account-wide plan/usage visibility,
native visual acceptance, or completion of C1–C6/M1/D1/U1. No production deployment
or cleanup is part of this repair.
