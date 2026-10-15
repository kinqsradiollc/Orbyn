# Private standalone LaTeX compiler

The API authorizes a writer and current note revision before and after compiling
a draft. Internal requests authenticate exact source, timestamp and nonce using
the PDF service key with a separate LaTeX signature purpose. The service accepts
one job at a time, returns only a bounded PDF and deletes its temporary job files.
It receives no database, provider, mail or file-store credentials.

Each job starts Bubblewrap with fresh user, process, network and mount namespaces.
No host or nested `/proc` mount is exposed; pdfLaTeX does not need one.
Only `/usr`, library paths, TeX configuration/cache and that job directory are
mounted. The job has a cleared environment, no network, read-only installation
paths, no shell escape, restrictive TeX input/output settings and fixed compiler
arguments. CPU, address space, output file size and wall time are bounded. The
container also has bounded memory, temporary storage and process count. Missing
namespaces/compiler support fails closed; there is no unsandboxed fallback.

`seccomp.json` extends the existing PDF service policy with mount, unmount and
pivot-root setup for Bubblewrap inside its unprivileged user namespace. Container
capabilities stay dropped. It is specific to this service; do not apply it to the
API. Kubernetes must install this policy as `orbyn/latex-seccomp.json` and enforce
the included private-service network policy.

Provisioned packages support standalone pdfLaTeX documents with standard LaTeX,
AMS math and recommended packages/fonts. CM-Super's minimal Type 1 package
provisions the default T1/EC fonts before runtime, so compilation does not need
to generate bitmap fonts in a read-only installation. The empty starter emits a
blank page; removing all page-producing content from custom source can produce
no PDF and is reported as a compilation failure. Uploaded TeX projects, bibliography
assets, custom fonts, external images and package downloads are not inputs to
this endpoint. Invalid source leaves the editor draft and previous PDF intact.
Two bounded compilation passes update ordinary cross-references. External
bibliography/project assets are not supported inputs.

The sandbox configuration is Orbyn's responsibility, as explained by the
[Bubblewrap project](https://github.com/containers/bubblewrap). Its namespace and
process-lifetime options are documented in the
[Debian manual](https://manpages.debian.org/bookworm/bubblewrap/bwrap.1.en.html).
Container/compiler/runtime qualification remains required; source and type checks
alone do not establish isolation or successful PDF rendering.
