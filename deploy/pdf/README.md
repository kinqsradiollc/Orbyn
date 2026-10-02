# Private document PDF renderer

The `pdf` Compose service has no published port, database credentials or provider
credentials. The API supplies an already authorized, revision-fenced snapshot.
Requests authenticate their timestamp, nonce and exact content with an independent
`DOC_PDF_KEY`; replay and excess concurrent jobs are rejected. Generate the key
with `openssl rand -hex 32` and place it in the API/renderer configuration.

The Chromium browser sandbox stays enabled. The renderer runs as `node`, drops
container capabilities, uses a read-only root and bounded temporary/shared memory.
Its private CDP pipe opens only fresh about:blank targets and blocks resource
requests. No existing browser/user profiles or debug TCP ports are used.

`seccomp.json` is the documented Playwright Docker profile (Docker default plus
user-namespace creation), pinned from Microsoft Playwright commit
`ae935a43d9e376e4759548f6b3c6905c7b282333` at
`utils/docker/seccomp_profile.json` (Apache-2.0). See
[official sandbox guidance](https://playwright.dev/docs/docker) and
[upstream source](https://github.com/microsoft/playwright/blob/ae935a43d9e376e4759548f6b3c6905c7b282333/utils/docker/seccomp_profile.json).
Orbyn adds permission for `chroot` inside Chromium's unprivileged user namespace;
Docker's capability-dependent default rule otherwise blocks that sandbox step
when all container capabilities are dropped. This does not grant `CAP_SYS_CHROOT`
to the container user. Only the renderer gets this profile; API/other containers keep their policies.

Do not add `--no-sandbox` or privileged container flags to work around a host
failure. Kubernetes/other runtimes need an equivalent provisioned user-namespace
seccomp policy. Container qualification and deployment manifests remain required.
