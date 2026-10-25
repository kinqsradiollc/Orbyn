# Select the evidence path

Use available local schemas/help to determine exact operations and fields. Names
below identify REA capabilities when present, not a requirement to install them.

| Question / target | First useful observation | Deeper work and boundary |
| --- | --- | --- |
| Unknown package or container | `inspect_artifact` identity, inventory and coverage | Inspect selected entries. Extract only into owned storage with path/size controls; do not run extracted code. An omitted or unreadable child stays unknown. |
| Native executable | `open_binary` and relevant format/provider availability | Select procedures, imports or sections before analysis. Preserve architecture, address space and load mapping; a static call relationship is not an execution trace. |
| Electron, ASAR or JavaScript bundle | Artifact inventory and selected local sources | Use supported JavaScript analysis/reconstruction. Keep source maps and source correspondence explicit. Reconstruction is not original source identity or successful execution. |
| APK | Package metadata and selected resources/code | Use supported Android inspection. Permission declarations do not prove use; signing metadata or digest consistency does not establish publisher trust. Device interaction is separate runtime scope. |
| Two artifact versions | Identity and comparable inventory for each side | Compare equivalent scopes and retained records. Equal observed root bytes do not establish equal runtime behavior or equal unexamined container contents. |
| Runtime-only behavior | Exact process/device and allowed effects | Choose launch, attach, debugger, network or UI capture according to the question. Plan capture bounds and cleanup; a working connection is not target ownership. |

For JavaScript, select files/chunks relevant to the question and account for
lazy, inaccessible or omitted sources. If the server supports route inventories,
request only relevant paths and page retained facts. Call them **static route
candidates**. Do not request those URLs or claim application-wide coverage from
that inventory. A compact view reduces delivery, not necessarily analysis work.

For native analysis, keep file offsets, virtual addresses and image-relative
addresses distinct. Account for same-address aliases, unresolved indirect calls
and provider limitations. Engine-free metadata inspection, when supported, can
answer a narrower question without starting a decompiler. Parsing bytecode or
certificate tables does not by itself decompile, execute or verify signatures.

For runtime capture, record executable identity and capture conditions. Attaching
to a user-owned process generally owns the connection, not permission to kill
that process. Launch ownership and target side effects must come from the actual
operation contract. Path selection and working directories are not sandboxes.
UI observation and UI actions have different effects. Cleanup must address the
resources acquired without undoing or killing unrelated user work.

If a tool reports partial results, preserve them and their limitations. Seek one
specific missing observation when it changes the answer; avoid an unbounded
catalog dump, whole-application decompilation or runtime session by default.

See [evidence and recovery](evidence-and-recovery.md) before retrying or comparing.
