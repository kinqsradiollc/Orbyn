# C6 production-host test

Codex Security is not needed to install or exercise the Orbyn plugin. The normal
Orbyn plugin backend and its OAuth flow are separate from that scanner.

## Prepare the deployment

1. Finish the local Test → Review correction checkpoint and merge the accepted
   code to main. This prepares a production-test checkpoint, not proof of live
   host acceptance.
2. On the server's private `.env`, set:

   ```dotenv
   PLUGIN_PUBLIC_URL=https://mcp.orbyn.dev/plugin
   ```

   Use this URL only if that hostname already routes to this server's gateway
   port 8082. Otherwise use a hostname you own and route it there first.
   Keep `MCP_PUBLIC_URL` unchanged; `/mcp` and `/plugin` are separate recipients.
3. Run `./scripts/deploy.sh --check`, then the normal deployment script. A
   nonempty plugin URL makes the script build/start the separate plugin service
   and update the gateway. Legacy key conversion deliberately stops old writers.
4. Check that the public protected-resource metadata identifies the exact plugin
   recipient at `https://mcp.orbyn.dev/.well-known/oauth-protected-resource/plugin`.
   Its authorization server must be the first-party Orbyn consent website.
5. Use a dedicated Orbyn test account with sample data. Enable UI cards in
   Admin → Agents for that workspace. Inference permission stays off until that
   account explicitly chooses a provider/model and allowance for the plugin grant.

## Connect a real host

The official [local plugin testing guide](https://developers.openai.com/plugins/build/plugins#create-and-test-a-plugin-locally-with-an-mcp-server)
provides a custom-server authoring flow:

1. Open [ChatGPT Plugins](https://chatgpt.com/plugins).
2. Select **+ → Add custom MCP server** and enter the deployed `/plugin` URL.
3. Complete the host's warning/connection flow and select **Create as a plugin**.
4. Sign in to the dedicated Orbyn account and approve only the test scopes.
5. Test in a new chat. If a local installable bundle is needed for Codex/Work,
   copy the created `plugin_asdk_app...` technical ID and use it as the registered
   app mapping in the package; never invent an ID or include credentials.

This flow depends on authoring access in the host account. A local/repo marketplace
is an authoring distribution source, not public directory publication. Public
submission has its own [OpenAI review process](https://developers.openai.com/plugins/deploy/submission);
that process is not a Codex Security repository scan. No public submission is
performed by this runbook.

## Acceptance cases

| Case | Expected evidence |
| --- | --- |
| Sign-in | Plugin-specific consent and grant; browser session or `/mcp` token cannot substitute |
| Today | Open Orbyn, explicitly load Today, see only the approved account's data |
| Account switch/reconnect | Old grant/account data disappears; fresh authority is required |
| Mentions | Only authorized titles/links; no full item contents or private Memory |
| Markdown resources | Read a supported host resource; save only writable resources with ETag; conflict retains draft |
| Provider execution | Explicit managed/BYO consent, pinned model and allowance; no ChatGPT-plan token borrowing or silent paid fallback |
| Revocation | Existing connection loses access; no new result or file parcel leaks afterward |

Record host/account capabilities, deployed commit, actual successful cases and
unsupported cases in a Markdown report. A host that lacks file-resource extensions
cannot qualify that platform feature. Request concrete UI checks through Orbyn
Visual Check; no automatic whole-app visual sweep is required.

Until these cases run against the deployed endpoint, real-host C6 remains
unverified. A code checkpoint on main is not production deployment or full C6
acceptance.
