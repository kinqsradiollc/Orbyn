# Delegate runtime verification — 2026-10-21

**Latest result:** the fresh-chat native `orbyn-light` probe below succeeded.
Its recorded runtime model is `gpt-6-luna` with `high` reasoning effort.
Effective processing tier and acceleration controls remain unverified because
the child metadata does not expose them. Earlier discovery failures below are
historical evidence, superseded for discovery/model/effort by the latest probe.

## Earlier verification attempts

Scope: verify native delegate model/effort and standard processing for this Codex
chat. One minimal read-only native Sol probe was authorized and executed. No
product edits, app tests, CLI inference processes or user-owned chats were used.

| Property                              | Result                             | Direct evidence                                                                                                                                       |
| ------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orbyn-agent` discovery               | Verified                           | Native `spawn_agent` accepted `agent_type=orbyn-agent`.                                                                                               |
| Sol model                             | Verified at recorded session level | Child `turn_context.model` is `gpt-6.1-sol`.                                                                                                          |
| Sol reasoning effort                  | Verified at recorded session level | Child `turn_context.effort` is `medium`.                                                                                                              |
| `orbyn-light` discovery               | Failed in this running host        | Native launch returned `unknown agent_type 'orbyn-light'`; no Luna inference occurred.                                                                |
| Luna/high runtime                     | Unverified                         | Named agent unavailable to the current tool catalog. No generic substitute was used.                                                                  |
| Standard processing configuration     | Verified in files                  | Project `service_tier=default`; `features.fast_mode=false`; `features.ultrafast_mode=false`. User-level selected `service_tier` also reads `default`. |
| Fast control in installed CLI         | Verified in that CLI               | `codex features list` exited 0 and reported `fast_mode stable false`. This does not identify desktop effective processing.                            |
| Ultrafast control in installed CLI    | Unverified                         | No Ultrafast feature was advertised by this CLI.                                                                                                      |
| Actual delegate processing speed/tier | Unverified                         | Child session and turn metadata contain no explicit service-tier/speed field. Missing metadata is not evidence of standard speed.                     |
| Claude delegates                      | Unverified                         | No native Claude delegation host is exposed in this Codex chat; no substitute CLI model process was launched.                                         |

Child session: `01a15bdb-6ebe-7f52-ba76-4692261fc522`.
Read-only evidence source:
`/Users/anhdang/.codex/sessions/2026/10/21/rollout-2026-10-21T11-27-49-01a15bdb-6ebe-7f52-ba76-4692261fc522.jsonl`.
Only session identity and selected model/effort fields were extracted; raw prompts
and unrelated session contents are not copied here. The parent independently
read the matching child record after completion.

At the start of this verification, `.codex/config.toml` had returned to its
original single-agent content, although the model-specific definitions remained.
The cause is unknown. Restored the Luna registration, default service tier and
both false speed controls. Final asset checks, skill discovery and diff checks
passed after restoration. Do not treat the earlier configuration result as proof
that later runtime configuration remained unchanged.

Computer-use inspection of the Codex app was denied by the tool. No alternate
UI transport or bypass was attempted. Runtime speed remains an explicit gap.

Next qualification: load a fresh Orbyn chat or supported host refresh that
advertises `orbyn-light`, repeat the bounded native Luna probe, and inspect
host-supported effective service-tier metadata or the user's speed selector.
A fresh chat alone is not proof of correct speed. Claude requires a separate
native-host qualification. Keep all unobserved properties unverified.

Delivery: local files only; no commit, push or deployment.

## Follow-up: canonical model source and reversion investigation

Added `docs/agents/models.json` as the single human-editable mapping for both
OpenAI/Codex and Claude. `python3 scripts/sync-agent-models.py --write` updates
both hosts, preserving unrelated config; `--check` reports drift. The main asset
checker now invokes that check instead of duplicating model IDs and effort.
The sync detects files changed while it prepares updates and aborts that run.

Disposable checks passed for an old single-agent reset, repair, unrelated-value
preservation, changing both provider model IDs, generated policy-table updates,
idempotent repeat sync, and rejection of Fast processing before writes.
Controlled hashes showed `codex features list` and a rejected native Luna spawn
did not change the config. No repository writer or symlink was found. Concurrent
Git operations exist in the checkout history, but no evidence ties them to the
reversions. **The actual writer remains unidentified; reversion is not claimed
fixed.** The new registry detects and repairs drift, without a hidden watcher.

A later parent `thread_settings_applied` event explicitly recorded
`service_tier=default` (2026-10-21T00:30:17.126Z). This strengthens parent
configuration evidence, but does not add a delegate service-tier record.
`orbyn-light` was retried after sync and still returned `unknown agent_type`.
The running native catalog exposes no reload operation, and no generic agent or
CLI inference was substituted. Completing Luna/high qualification requires a
fresh Orbyn chat or supported host refresh that advertises this agent type.
The computer-use restriction on Codex remains respected.

## Retry after the user reloaded Codex

The user reported reloading Codex and explicitly requested another named Luna
probe. `spawn_agent(agent_type=orbyn-light, fork_turns=none)` again returned
`unknown agent_type 'orbyn-light'`; no child or Luna inference was created.
`sync-agent-models.py --check` passed. Both project agent files are present and
the project is explicitly trusted in user configuration. No global custom-agent
entries were configured. These observations rule out absent project files,
registry drift and an explicitly untrusted project as the immediate cause; they
do not establish why the current native catalog omits the light type.

The latest parent `thread_settings_applied` record explicitly reports
`model=gpt-6.1-sol`, `reasoning_effort=medium`, `service_tier=default`.
Project flags remain `fast_mode=false` and `ultrafast_mode=false`. This proves
parent configured runtime tier and file flags, not Luna runtime settings.
Luna/high and its effective processing tier remain unverified. No generic agent,
global configuration change or CLI inference substitute was used.

## Fresh-chat native orbyn-light probe — 2026-10-21 11:40 AEDT

Requested scope: read the registry and policy, launch exactly one minimal
read-only named native probe, independently inspect its recorded runtime
metadata, and record exposed settings and gaps. Only this report was edited.
The agent-tooling owner is the portable registry and Codex TOML configuration;
no runtime or configuration implementation change was requested.

Checkout: `/Users/anhdang/Documents/Github/Orbyn`, branch
`codex/agent-workflows`, HEAD `953438df3ef1f46cab545734d1e0e573b5ceeab5`.
The checkout already contained uncommitted agent/configuration/documentation
changes and this untracked report. Those changes were preserved. These results
apply to the working files inspected, not to an assertion that HEAD contains them.

Read `docs/agents/models.json`, `docs/agents/model-policy.md`,
`.codex/config.toml`, and `.codex/agents/orbyn-light.toml` before launch.
Native call: `spawn_agent(agent_type="orbyn-light", fork_turns="none",
task_name="light_runtime_probe", message=<bounded read-only Verifier brief>)`.
No model/effort overrides or generic fallback were supplied. The accepted result
was `{"task_name":"/root/light_runtime_probe"}`. The child completed after
read-only file/status inspection; its recorded tool calls contain no writes,
tests, CLI inference, external messages or further delegation.

| Property                                           | Latest result                                           | Evidence                                                                                                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Native named-agent discovery                       | Verified                                                | Spawn accepted; child `session_meta.agent_role` and `source.subagent.thread_spawn.agent_role` both identify `orbyn-light`.                                                                                                           |
| Runtime model                                      | Verified at recorded session level                      | Child `turn_context.model` and `thread_settings_applied.thread_settings.model` are `gpt-6-luna`.                                                                                                                                     |
| Runtime reasoning effort                           | Verified at recorded session level                      | Child `turn_context.effort`, collaboration settings and applied `reasoning_effort` are `high`.                                                                                                                                       |
| Standard/default configuration                     | Verified in project files                               | Registry `codex_service_tier="default"` and project `service_tier="default"`.                                                                                                                                                        |
| Fast disabled                                      | Verified in configuration; effective runtime unverified | Registry `codex_fast_mode=false`; project `features.fast_mode=false`. No runtime Fast field is exposed.                                                                                                                              |
| Ultrafast disabled                                 | Verified in configuration; effective runtime unverified | Registry `codex_ultrafast_mode=false`; project `features.ultrafast_mode=false`. No runtime Ultrafast field is exposed.                                                                                                               |
| Priority disabled / standard processing at runtime | Unverified                                              | Configured tier is `default`, but the child has no recorded effective `service_tier` or speed field. The tool catalog advertises Priority as an available service tier; availability does not establish selection or execution tier. |

Child session: `01a15be6-a958-7f53-bdc3-0c8d039382e3`.
Parent session: `01a15be6-2cb5-7302-8c40-3090e0e575e7`.
Read-only runtime evidence source:
`/Users/anhdang/.codex/sessions/2026/10/21/rollout-2026-10-21T11-40-05-01a15be6-a958-7f53-bdc3-0c8d039382e3.jsonl`.
The parent independently parsed this exact child record:

```text
line 1  session_meta:
  id = 01a15be6-a958-7f53-bdc3-0c8d039382e3
  parent_thread_id = 01a15be6-2cb5-7302-8c40-3090e0e575e7
  timestamp = 2026-10-21T00:40:05.743Z
  agent_path = /root/light_runtime_probe
  agent_role = orbyn-light
  model_provider = openai
line 10 turn_context:
  model = gpt-6-luna
  effort = high
  collaboration_mode.settings.reasoning_effort = high
line 11 event_msg / thread_settings_applied:
  thread_id = 01a15be6-a958-7f53-bdc3-0c8d039382e3
  thread_settings.model = gpt-6-luna
  thread_settings.reasoning_effort = high
```

An exact-key scan of structured `session_meta`, `turn_context` and `event_msg`
records found no `service_tier`, `fast_mode`, `ultrafast_mode`,
`processing_mode`, `speed`, `priority` or `speed_mode` fields. Text in prompts
and configuration excerpts was excluded from runtime-field evidence. The child
itself reported no directly exposed effective settings; its self-report is not
the basis for the parent's model/effort verification.

The [official custom-agent schema](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agent-file-schema),
fetched during this verification, documents named-agent model/effort fields and
says service tier follows the root session preference. This explains the
configuration relationship; it does not supply the missing runtime observation.
No speed controls were enabled or changed. No CLI inference, generic agent,
application tests, UI inspection or additional probe was used.

Inspected working-file SHA-256 values:

```text
docs/agents/models.json          1890f8bcb492101838883d47c873bde9ee3323fed8f052383c3f501e75e61c45
docs/agents/model-policy.md      52c82d8fd5524c40232790101b3d231cb49406e47b070091a055f167c202c12c
.codex/config.toml              4400901699be65cd53a788c1dac1a6b3363a229030dfb6c13fcc3121dd56dd61
.codex/agents/orbyn-light.toml   ebefa55b5d8589087dd7db13db6c1b8ccaf3afacd3253bcf56bfccedd5416306
```

Outcome: named native discovery and recorded Luna/high settings are verified.
Full standard-processing runtime qualification remains incomplete; it requires
an exposed effective service-tier/acceleration record. Delivery is this local
report update only, with no commit, push or deployment.
