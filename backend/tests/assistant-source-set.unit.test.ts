import { test } from "node:test";
import assert from "node:assert/strict";
import { assistantSourceVisibilitySet } from "../src/lib/assistant-source-visibility.js";
import { assistantJobSourcesVisible } from "../src/lib/assistant-job-sources.js";
import { assistantChatVisible } from "../src/lib/assistant-visibility.js";

test("statement source proofs cannot be reused under another authority context", () => {
  const scope = { user: "$1", teams: "$4", personal: false, ai: true };
  const sources = assistantSourceVisibilitySet(
    "profile_sources",
    "SELECT kind,id FROM requested_sources",
    "$1",
    scope,
  );
  assert.match(sources.cte, /AS MATERIALIZED/);
  assert.match(sources.cte, /SELECT DISTINCT kind,id/);
  assert.throws(
    () => assistantJobSourcesVisible("j", "$2", false, scope, true, sources),
    /authority contexts/,
  );
  assert.throws(
    () =>
      assistantJobSourcesVisible(
        "j",
        "$1",
        false,
        { ...scope, personal: true },
        true,
        sources,
      ),
    /authority contexts/,
  );
  assert.throws(
    () =>
      assistantJobSourcesVisible(
        "j",
        "$1",
        false,
        { ...scope, teams: "$5" },
        true,
        sources,
      ),
    /authority contexts/,
  );
  assert.throws(
    () => assistantJobSourcesVisible("j", "$1", false, scope, false, sources),
    /authority contexts/,
  );
  assert.throws(
    () =>
      assistantSourceVisibilitySet(
        "unsafe; relation",
        "SELECT kind,id FROM sources",
      ),
    /Invalid source visibility/,
  );
  const condition = assistantJobSourcesVisible(
    "j",
    "$1",
    false,
    scope,
    true,
    sources,
  );
  assert.match(condition, /FROM profile_sources source_proof/);
  assert.match(condition, /j\.sources_checked/);
  assert.match(condition, /assistant_turn_entry_sources/);
  assert.match(condition, /assistant_delivery_entry_sources/);
  assert.match(condition, /j\.user_id=\$1/);
  assert.doesNotMatch(
    assistantJobSourcesVisible("j", "$1", false),
    /source_proof/,
  );
  const chat = assistantChatVisible("c", "$1", scope, sources);
  assert.match(chat, /FROM profile_sources source_proof/);
  assert.match(chat, /c\.user_id = \$1/);
  assert.match(chat, /assistant_turn_entry_sources/);
  assert.throws(
    () => assistantChatVisible("c", "$2", scope, sources),
    /authority contexts/,
  );
});
