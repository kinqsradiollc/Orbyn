# Workload prompts, not technology rankings

Use these local prompts offline to frame research. Specific product/version
availability, prices, limits and support require current primary verification.

| Workload                                   | Questions that can change the choice                                                            | Common unproven leap to avoid                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Public content or interactive web          | Static output, indexing, server rendering, routing, accessibility, hosting and team experience? | Assuming a full server or a particular React framework is always necessary   |
| Local/offline desktop or device            | Platform APIs, distribution, local durable state, sync/conflict ownership and update channel?   | Treating cross-platform build success as native UX qualification             |
| Transactional service                      | Multi-user writes, invariants, isolation, backups, tenant authority and recovery?               | Treating a cache or search index as the sole durable authority               |
| Embedded/local storage                     | Writer topology, file ownership, backups, extension support and deployment boundary?            | Sharing an embedded database file across machines without validating locking |
| Analytical/ML workload                     | Batch versus online, data scale, reproducibility, numerical correctness and ecosystem?          | Selecting a runtime from a microbenchmark unrelated to the workload          |
| Systems or performance-sensitive component | Profiled bottleneck, memory/ABI constraints, safety, supported targets and team skills?         | Rewriting an application before measuring the owning hot path                |
| Managed service / build-versus-buy         | Required features, operational staffing, data export, contractual limits and total cost?        | Counting only subscription price or only implementation time                 |

For each candidate, independently check its documented capabilities, installed
version and actual project evidence. A language can serve several workloads; no
row requires a particular language, cloud or vendor. Keep existing owners and
project constraints ahead of examples.

Reviewed primary references, 24 October 2026:
[Azure workload-oriented technology choices](https://learn.microsoft.com/en-us/azure/architecture/guide/technology-choices/technology-choices-overview),
[React project constraints](https://react.dev/learn/creating-a-react-app),
[SQLite deployment/writer boundaries](https://sqlite.org/whentouse.html),
[PostgreSQL isolation semantics](https://www.postgresql.org/docs/18/transaction-iso.html).
These are evidence for specific questions, not endorsements or a cross-product
performance comparison. The workflow and matrix are independently authored.
