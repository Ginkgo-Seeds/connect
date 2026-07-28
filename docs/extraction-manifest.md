# Extraction manifest

This document records donor baselines and the provenance of every donor artifact
introduced into Ginkgo Connect.

## Donor baselines

| Repository                 | Source commit                              | Access    |
| -------------------------- | ------------------------------------------ | --------- |
| `ginkgoai/ginkgo-tree`     | `194061c600b5f5779008bbc644c2193475ee8164` | Read-only |
| `ginkgoai/ginkgo-platform` | `9b5db872e9d4583018dea74671f6f3304cfccfa2` | Read-only |
| `ginkgoai/ai-stack`        | `f4540ca91c72e86606867cb88faf776e565bd141` | Read-only |

## Imported artifacts

Every imported artifact must use the following fields:

| repository | sourceCommit | sourcePath | destinationPath | treatment | reason | verification |
| ---------- | ------------ | ---------- | --------------- | --------- | ------ | ------------ |

There are no imported artifacts in Foundation 001. All files in this slice were
rewritten from the approved architecture and contain no donor source code.

Valid future values for `treatment` are `copied`, `adapted`, and `rewritten`.
