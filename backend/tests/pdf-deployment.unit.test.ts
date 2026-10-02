import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, delimiter } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const file = (path: string) => readFileSync(join(root, path), "utf8");

test("PDF deployment preflight rejects missing keys and describes renderer-before-API rollout without mutations or secret output", () => {
  const directory = mkdtempSync(join(tmpdir(), "orbyn-pdf-deploy-check-"));
  const secret = "test-only-pdf-deployment-secret-at-least-32-characters";
  const environment = join(directory, "deployment.env");
  const calls = join(directory, "docker-calls");
  writeFileSync(
    join(directory, "docker"),
    '#!/bin/sh\nprintf "%s\\n" "$@" >> "$PDF_TEST_CALLS"\n',
    { mode: 0o700 },
  );
  const run = () =>
    spawnSync(
      "bash",
      [join(root, "scripts/deploy.sh"), "--check", "--no-pull"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ENV_FILE: environment,
          PATH: directory + delimiter + process.env.PATH,
          PDF_TEST_CALLS: calls,
        },
      },
    );
  try {
    writeFileSync(environment, "APP_URL=https://test.example\n");
    const missing = run();
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Set DOC_PDF_KEY/);
    writeFileSync(
      environment,
      `APP_URL=https://test.example\nDOC_PDF_KEY=${secret}\n`,
    );
    const ready = run();
    assert.equal(ready.status, 0, ready.stderr);
    assert.match(ready.stdout, /roll out pdf, api/);
    assert.match(ready.stdout, /Preflight: OK/);
    assert.doesNotMatch(ready.stdout + ready.stderr, new RegExp(secret));
    const invoked = readFileSync(calls, "utf8").trim().split("\n");
    assert.deepEqual(invoked, [
      "compose",
      "--env-file",
      environment,
      "config",
      "--quiet",
      "compose",
      "--env-file",
      environment,
      "config",
      "--quiet",
    ]);
    const script = file("scripts/deploy.sh");
    assert.match(
      script,
      /rollout pdf "\$\(setting PDF_REPLICAS 1\)"\nrollout api/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("private renderer manifests retain credential, sandbox and network boundaries", () => {
  const compose = file("compose.yaml")
    .split("\n  pdf:\n")[1]
    ?.split(/\n  \w[\w-]*:/)[0];
  assert.ok(compose);
  assert.match(compose, /target: pdf/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /cap_drop: \[ALL\]/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /seccomp:\.\/deploy\/pdf\/seccomp.json/);
  assert.doesNotMatch(
    compose,
    /env_file:|ports:|DATABASE_URL|SECRETS_KEY|SMTP_PASSWORD/,
  );
  const kubernetes = file("deploy/k8s/pdf.yaml");
  assert.match(kubernetes, /automountServiceAccountToken: false/);
  assert.match(kubernetes, /localhostProfile: orbyn\/pdf-seccomp.json/);
  assert.match(kubernetes, /readOnlyRootFilesystem: true/);
  assert.match(kubernetes, /allowPrivilegeEscalation: false/);
  assert.match(kubernetes, /egress: \[\]/);
  assert.doesNotMatch(kubernetes, /^\s+envFrom:/m);
  const dns = file("deploy/k8s/networkpolicy.yaml")
    .split("name: allow-dns")[1]
    ?.split("---")[0];
  assert.ok(dns);
  assert.match(dns, /operator: NotIn/);
  assert.match(dns, /values: \[pdf\]/);
  const profile = JSON.parse(file("deploy/pdf/seccomp.json"));
  assert.equal(profile.defaultAction, "SCMP_ACT_ERRNO");
  assert.ok(
    profile.syscalls.some(
      (rule: { names: string[]; action: string }) =>
        rule.names.includes("chroot") && rule.action === "SCMP_ACT_ALLOW",
    ),
  );
});

test("private diagram asset matches the locked first-party builder and engine source", () => {
  const asset = JSON.parse(file("backend/assets/mermaid-runtime.json"));
  const digest = createHash("sha256")
    .update(file("scripts/mermaid-runtime.mjs"))
    .update(file("packages/core/src/mermaid.ts"))
    .update(file("scripts/build-mermaid.mjs"))
    .update(file("package.json"))
    .update(file("package-lock.json"))
    .digest("hex");
  assert.equal(asset.sourceDigest, digest);
  assert.match(asset.html, /connect-src 'none'/);
  assert.match(asset.html, /img-src data:/);
  assert.doesNotMatch(asset.html, /<script[^>]+src=/i);
});
