# Shell: contracts to preserve

## Resolve the target

Resolve the shebang, actual shell/version and OS utilities. POSIX sh, Bash and zsh differ; macOS utilities and older Bash may differ from GNU/Linux.

## Apply at the affected boundary

- Pass arguments as separate quoted words or native arrays; preserve "$@". Never treat JSON escaping as shell quoting or eval untrusted text.
- Inspect every external effect and its exit status. set -e has conditional/pipeline exceptions; pipefail is a Bash feature, not a portable POSIX contract.
- Own temporary paths, validate destructive destinations and trap cleanup only for created resources. Do not reset/clean arbitrary Git work or remove a user's output to make a retry succeed.
- Keep credentials out of traces/logs and command substitution output. Use structured APIs or body files for multiline content; account for filename newlines and utility-specific option parsing.

## Worked failure and correction

Preserve a filename containing spaces as one argument:

```sh
if ! cp "$source_path" "$destination_path"; then
    printf '%s\n' 'Copy failed' >&2
    exit 1
fi
```

Validate option-like filenames or use a supported -- delimiter for the actual
utility. Quoting alone does not stop option parsing.

## Evidence to report

Run syntax checks for the actual interpreter and authorized disposable failure/recovery fixtures. bash -n does not execute the path, prove portability or validate a remote deployment.

## Primary references

Reviewed 24 October 2026. These independently written instructions and synthetic
examples are usable offline. The links identify semantics and update evidence;
verify compatibility with the project's target before using newer APIs.

[GNU Bash quoting](https://www.gnu.org/software/bash/manual/html_node/Quoting.html), [GNU Bash set builtin](https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html).
