# Changelog

All notable changes to the Ask O11y Grafana plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.21](https://github.com/Consensys/ask-o11y-plugin/compare/v0.2.20...v0.2.21) (2026-04-07)


### Bug Fixes

* use http client from grafana sdk everywhere ([#115](https://github.com/Consensys/ask-o11y-plugin/issues/115)) ([d35f851](https://github.com/Consensys/ask-o11y-plugin/commit/d35f85108556f5f01177d3f490afa994d5a4df96))

## [0.2.20](https://github.com/Consensys/ask-o11y-plugin/compare/v0.2.19...v0.2.20) (2026-04-02)


### Features

* **viz:** more trace viz and fix todays new vuln ([#113](https://github.com/Consensys/ask-o11y-plugin/issues/113)) ([b806658](https://github.com/Consensys/ask-o11y-plugin/commit/b806658ad9347dd10ac7c14f342e9bc311ff8d0e))

## [0.2.19](https://github.com/Consensys/ask-o11y-plugin/compare/v0.2.18...v0.2.19) (2026-04-01)


### Features

* **viz:** improve visualizations ([#109](https://github.com/Consensys/ask-o11y-plugin/issues/109)) ([fee8e28](https://github.com/Consensys/ask-o11y-plugin/commit/fee8e28e1676b10f45dd8949fc072ceb43fbd445))

## [0.2.18](https://github.com/Consensys/ask-o11y-plugin/compare/v0.2.17...v0.2.18) (2026-03-30)


### Features

* **chat:** tighten investigation and multi-turn agent prompts ([#102](https://github.com/Consensys/ask-o11y-plugin/issues/102)) ([f9fd9ab](https://github.com/Consensys/ask-o11y-plugin/commit/f9fd9abd8e38346460f9c2b5805f2a631bc68227))


### Bug Fixes

* **viz:** resolve datasources by Grafana default and optional ds uid ([#105](https://github.com/Consensys/ask-o11y-plugin/issues/105)) ([34ef96d](https://github.com/Consensys/ask-o11y-plugin/commit/34ef96d615cb43f517b8cb6ad45b43dd1d9cbfa3))

## [Unreleased]

### Fixed

* **viz:** resolve Prometheus, Loki, and Tempo datasources like Grafana defaults (and optional `ds` UID on code fences) instead of hardcoded names ([#104](https://github.com/Consensys/ask-o11y-plugin/issues/104))

## [0.2.17](https://github.com/Consensys/ask-o11y-plugin/compare/v0.2.16...v0.2.17) (2026-03-13)


### Features

* add attestation to artifact ([#2](https://github.com/Consensys/ask-o11y-plugin/issues/2)) ([99b0a07](https://github.com/Consensys/ask-o11y-plugin/commit/99b0a07cbec82a506b5cd619e2018c58dc226585))
* add custom loader with style ([#17](https://github.com/Consensys/ask-o11y-plugin/issues/17)) ([5b4abcc](https://github.com/Consensys/ask-o11y-plugin/commit/5b4abcc810b64632ba2dc0f1df83b4b3d8343999))
* add Right Side Panel ([#3](https://github.com/Consensys/ask-o11y-plugin/issues/3)) ([9bbf7c7](https://github.com/Consensys/ask-o11y-plugin/commit/9bbf7c7851c06611af84321d95abb98916adf498))
* **agent:** server-side agentic loop with detached execution and E2E test consolidation ([#46](https://github.com/Consensys/ask-o11y-plugin/issues/46)) ([c5fbe29](https://github.com/Consensys/ask-o11y-plugin/commit/c5fbe29383005d94e6713e3625916a8dbe54eb14))
* **agent:** use alert runbook annotation during investigation ([#57](https://github.com/Consensys/ask-o11y-plugin/issues/57)) ([3f1bc5d](https://github.com/Consensys/ask-o11y-plugin/commit/3f1bc5d7b695a2b7033d9a32d79c1bb3f7df29a4))
* **backend:** move agent loop logic server-side with template system and PromptEditor UI ([#53](https://github.com/Consensys/ask-o11y-plugin/issues/53)) ([f50ff9a](https://github.com/Consensys/ask-o11y-plugin/commit/f50ff9accfe79ac779663691fe02c7b5cd338921))
* **chat:** add alert investigation mode for one-click RCA ([#29](https://github.com/Consensys/ask-o11y-plugin/issues/29)) ([a0f129e](https://github.com/Consensys/ask-o11y-plugin/commit/a0f129e594e14e8cb5a8594f94681a5a47e8e2d0))
* **chat:** add OTEL tracing and Tempo to the agent loop ([#82](https://github.com/Consensys/ask-o11y-plugin/issues/82)) ([4037b68](https://github.com/Consensys/ask-o11y-plugin/commit/4037b68f5a9221e1f2c0f2ba365b59f740d80a07))
* **config:** store MCP server headers and Redis URL in secureJsonData ([#86](https://github.com/Consensys/ask-o11y-plugin/issues/86)) ([1038a49](https://github.com/Consensys/ask-o11y-plugin/commit/1038a499e05810b217fe651d78bf9a92244056a9))
* get ready for first release ([#1](https://github.com/Consensys/ask-o11y-plugin/issues/1)) ([bdd4c98](https://github.com/Consensys/ask-o11y-plugin/commit/bdd4c984bcbb7a732c783b1cdf1f5c80801dd22a))
* store sessions in the backend ([#6](https://github.com/Consensys/ask-o11y-plugin/issues/6)) ([4825a8e](https://github.com/Consensys/ask-o11y-plugin/commit/4825a8e4b35aa4f11464f19be33a24e738dedcaf))
* use scene for split view ([#15](https://github.com/Consensys/ask-o11y-plugin/issues/15)) ([62a8f4b](https://github.com/Consensys/ask-o11y-plugin/commit/62a8f4b23c306f7c7bb18f10b4f885b774e75bd8))


### Bug Fixes

* add orgID to share urls ([#18](https://github.com/Consensys/ask-o11y-plugin/issues/18)) ([b08a530](https://github.com/Consensys/ask-o11y-plugin/commit/b08a5304eb1c992ab7bf03db1beaeda49ba4dac2))
* allow plugin signing ([a52542c](https://github.com/Consensys/ask-o11y-plugin/commit/a52542c365a8084ef273debf6e2a8a8c33d61e22))
* allow signing ([a6e75ad](https://github.com/Consensys/ask-o11y-plugin/commit/a6e75ad6d965754e10a58bbe0ef3d8282bb2774f))
* **backend:** address Grafana review feedback for Go code quality ([#64](https://github.com/Consensys/ask-o11y-plugin/issues/64)) ([57b42f1](https://github.com/Consensys/ask-o11y-plugin/commit/57b42f1de27fc6a6ac462aa8d416c1cb6d47f29a))
* **backend:** fix unreliable session history in multi-replica Grafana deployments ([#69](https://github.com/Consensys/ask-o11y-plugin/issues/69)) ([876e939](https://github.com/Consensys/ask-o11y-plugin/commit/876e939d7b2650d19f4a253de597f3eac3486c4a))
* **backend:** make SA token fetch non-fatal and sanitize HTTP error messages ([#90](https://github.com/Consensys/ask-o11y-plugin/issues/90)) ([9c14ba6](https://github.com/Consensys/ask-o11y-plugin/commit/9c14ba6944fe44caab576a288b9bfc7b6b1d0a63))
* **build:** filter node_modules from Go manifest ([#71](https://github.com/Consensys/ask-o11y-plugin/issues/71)) ([881d928](https://github.com/Consensys/ask-o11y-plugin/commit/881d928b104eb666558187d3ef4fb38f6a422ea4))
* **chat:** add SSE idle timeout and allow new chat during generation ([#62](https://github.com/Consensys/ask-o11y-plugin/issues/62)) ([954437c](https://github.com/Consensys/ask-o11y-plugin/commit/954437c26fa8eff6e6040233739f6a6f55b5db72))
* **chat:** fix autoscroll not triggering after user scrolls up ([#78](https://github.com/Consensys/ask-o11y-plugin/issues/78)) ([4d4c618](https://github.com/Consensys/ask-o11y-plugin/commit/4d4c618cc964e682f9d1a292655e95017f3bb21b))
* **ci:** add fast-pass for release-please PRs ([49de748](https://github.com/Consensys/ask-o11y-plugin/commit/49de748180bf36106b6db55c8aacdca7e96c2827))
* **ci:** add workflow_dispatch trigger ([75c59b4](https://github.com/Consensys/ask-o11y-plugin/commit/75c59b4a5a6dbe5c6bf30d117354a3357615bb07))
* **ci:** allow 'main' scope for release-please PRs ([7aa127b](https://github.com/Consensys/ask-o11y-plugin/commit/7aa127bdd9169bf1d04285b0df476bdea69014a6))
* **ci:** make release-please PRs mergeable by skipping CI for non-code changes ([#35](https://github.com/Consensys/ask-o11y-plugin/issues/35)) ([73b1bea](https://github.com/Consensys/ask-o11y-plugin/commit/73b1bea8ef97753ba0c94d895742e03ba17b5ab5))
* **ci:** remove package.json from paths filter ([05ab8b4](https://github.com/Consensys/ask-o11y-plugin/commit/05ab8b421b744eed0da765ece0f3d8a2505b2d22))
* **config:** enhance claude setup ([7d76956](https://github.com/Consensys/ask-o11y-plugin/commit/7d769561158d91b883a7116ccd956c8c0711ddd2))
* **deps:** pin flatted to 3.3.3 to exclude Go files from manifest ([#75](https://github.com/Consensys/ask-o11y-plugin/issues/75)) ([c458ef4](https://github.com/Consensys/ask-o11y-plugin/commit/c458ef445c3078174bac19ad2df93ae989cab5f8))
* **mcp:** namespace mcp-tool-settings localStorage key with plugin ID ([#83](https://github.com/Consensys/ask-o11y-plugin/issues/83)) ([a1e8eef](https://github.com/Consensys/ask-o11y-plugin/commit/a1e8eef582a3e942a63ad6a86f26551f74a44a7a))
* **plugin:** change per-request MCP log statements from Info to Debug ([#84](https://github.com/Consensys/ask-o11y-plugin/issues/84)) ([dd8f4a3](https://github.com/Consensys/ask-o11y-plugin/commit/dd8f4a3270d44b713d2b4d40b1bca14fac56bc36))
* **release:** use PAT for release-please and skip GitHub Release creation ([#37](https://github.com/Consensys/ask-o11y-plugin/issues/37)) ([fc6014a](https://github.com/Consensys/ask-o11y-plugin/commit/fc6014ae1b566c496c9dd977310b5808ce190656))
* **release:** use simple tag format (v0.2.5 not ask-o11y-plugin-v0.2.5) ([e84de65](https://github.com/Consensys/ask-o11y-plugin/commit/e84de653f788fcb4cc23b87d893d135107abf7d2))
* share banner and limit tabs ([#19](https://github.com/Consensys/ask-o11y-plugin/issues/19)) ([51b491d](https://github.com/Consensys/ask-o11y-plugin/commit/51b491de35707265d26ebdefcc414ccb6386323c))
* side panel disappearing after each new question ([#16](https://github.com/Consensys/ask-o11y-plugin/issues/16)) ([527287d](https://github.com/Consensys/ask-o11y-plugin/commit/527287d73a8f55dbc79cb33284188b20059d8594))
* **side-panel:** open panel when links appear after session load or hard refresh ([#79](https://github.com/Consensys/ask-o11y-plugin/issues/79)) ([fb4d87d](https://github.com/Consensys/ask-o11y-plugin/commit/fb4d87ded77a702e5d55dff1290228f4a9a67204))
* **ui:** remove all console.* calls from shipped frontend code ([#91](https://github.com/Consensys/ask-o11y-plugin/issues/91)) ([61f59a1](https://github.com/Consensys/ask-o11y-plugin/commit/61f59a1b340e5f05ecf62726c270b5b5660acd95))
* **ui:** replace hardcoded colors and fixed pixel widths with Grafana theme abstractions ([#87](https://github.com/Consensys/ask-o11y-plugin/issues/87)) ([5f64b38](https://github.com/Consensys/ask-o11y-plugin/commit/5f64b3840a0f18b55f85500eb1ca94d107595c94))
* **ui:** resolve chat UX issues and frontend code quality ([#66](https://github.com/Consensys/ask-o11y-plugin/issues/66)) ([5ec62dc](https://github.com/Consensys/ask-o11y-plugin/commit/5ec62dc2ed597f905734e4bf8f76b3e3a0dc9082))
* version ([#28](https://github.com/Consensys/ask-o11y-plugin/issues/28)) ([0f9b584](https://github.com/Consensys/ask-o11y-plugin/commit/0f9b584ad65b44d3f36c8d8704a0b5736880e3d2))


### Reverts

* restore skip-github-release in release-please config ([#73](https://github.com/Consensys/ask-o11y-plugin/issues/73)) ([911b72f](https://github.com/Consensys/ask-o11y-plugin/commit/911b72f4812feb42fc4d765ea20fb5d103637f3e))

## [0.2.16](https://github.com/Consensys/ask-o11y-plugin/compare/v0.2.15...v0.2.16) (2026-03-13)


### Bug Fixes

* allow plugin signing ([a52542c](https://github.com/Consensys/ask-o11y-plugin/commit/a52542c365a8084ef273debf6e2a8a8c33d61e22))
* allow signing ([a6e75ad](https://github.com/Consensys/ask-o11y-plugin/commit/a6e75ad6d965754e10a58bbe0ef3d8282bb2774f))

## [0.2.15](https://github.com/Consensys/ask-o11y-plugin/compare/v0.2.14...v0.2.15) (2026-03-12)


### Bug Fixes

* **backend:** make SA token fetch non-fatal and sanitize HTTP error messages ([#90](https://github.com/Consensys/ask-o11y-plugin/issues/90)) ([9c14ba6](https://github.com/Consensys/ask-o11y-plugin/commit/9c14ba6944fe44caab576a288b9bfc7b6b1d0a63))
* **ui:** remove all console.* calls from shipped frontend code ([#91](https://github.com/Consensys/ask-o11y-plugin/issues/91)) ([61f59a1](https://github.com/Consensys/ask-o11y-plugin/commit/61f59a1b340e5f05ecf62726c270b5b5660acd95))

## [0.2.14](https://github.com/Consensys/ask-o11y-plugin/compare/v0.2.13...v0.2.14) (2026-03-11)


### Features

* **chat:** add OTEL tracing and Tempo to the agent loop ([#82](https://github.com/Consensys/ask-o11y-plugin/issues/82)) ([4037b68](https://github.com/Consensys/ask-o11y-plugin/commit/4037b68f5a9221e1f2c0f2ba365b59f740d80a07))
* **config:** store MCP server headers and Redis URL in secureJsonData ([#86](https://github.com/Consensys/ask-o11y-plugin/issues/86)) ([1038a49](https://github.com/Consensys/ask-o11y-plugin/commit/1038a499e05810b217fe651d78bf9a92244056a9))


### Bug Fixes

* **chat:** add SSE idle timeout and allow new chat during generation ([#62](https://github.com/Consensys/ask-o11y-plugin/issues/62)) ([954437c](https://github.com/Consensys/ask-o11y-plugin/commit/954437c26fa8eff6e6040233739f6a6f55b5db72))
* **mcp:** namespace mcp-tool-settings localStorage key with plugin ID ([#83](https://github.com/Consensys/ask-o11y-plugin/issues/83)) ([a1e8eef](https://github.com/Consensys/ask-o11y-plugin/commit/a1e8eef582a3e942a63ad6a86f26551f74a44a7a))
* **plugin:** change per-request MCP log statements from Info to Debug ([#84](https://github.com/Consensys/ask-o11y-plugin/issues/84)) ([dd8f4a3](https://github.com/Consensys/ask-o11y-plugin/commit/dd8f4a3270d44b713d2b4d40b1bca14fac56bc36))
* **ui:** replace hardcoded colors and fixed pixel widths with Grafana theme abstractions ([#87](https://github.com/Consensys/ask-o11y-plugin/issues/87)) ([5f64b38](https://github.com/Consensys/ask-o11y-plugin/commit/5f64b3840a0f18b55f85500eb1ca94d107595c94))

## [0.2.13](https://github.com/Consensys/ask-o11y-plugin/compare/v0.2.12...v0.2.13) (2026-03-09)


### Bug Fixes

* **chat:** fix autoscroll not triggering after user scrolls up ([#78](https://github.com/Consensys/ask-o11y-plugin/issues/78)) ([4d4c618](https://github.com/Consensys/ask-o11y-plugin/commit/4d4c618cc964e682f9d1a292655e95017f3bb21b))
* **side-panel:** open panel when links appear after session load or hard refresh ([#79](https://github.com/Consensys/ask-o11y-plugin/issues/79)) ([fb4d87d](https://github.com/Consensys/ask-o11y-plugin/commit/fb4d87ded77a702e5d55dff1290228f4a9a67204))

## [0.2.12](https://github.com/Consensys/ask-o11y-plugin/compare/v0.2.11...v0.2.12) (2026-03-06)


### Bug Fixes

* **deps:** pin flatted to 3.3.3 to exclude Go files from manifest ([#75](https://github.com/Consensys/ask-o11y-plugin/issues/75)) ([c458ef4](https://github.com/Consensys/ask-o11y-plugin/commit/c458ef4))

## [0.2.11](https://github.com/Consensys/ask-o11y-plugin/compare/v0.2.10...v0.2.11) (2026-03-06)


### Bug Fixes

* **build:** filter node_modules from Go manifest ([#71](https://github.com/Consensys/ask-o11y-plugin/issues/71)) ([881d928](https://github.com/Consensys/ask-o11y-plugin/commit/881d928b104eb666558187d3ef4fb38f6a422ea4))


### Reverts

* restore skip-github-release in release-please config ([#73](https://github.com/Consensys/ask-o11y-plugin/issues/73)) ([911b72f](https://github.com/Consensys/ask-o11y-plugin/commit/911b72f4812feb42fc4d765ea20fb5d103637f3e))

## [0.2.10](https://github.com/Consensys/ask-o11y-plugin/compare/v0.2.9...v0.2.10) (2026-03-04)


### Bug Fixes

* **backend:** fix unreliable session history in multi-replica Grafana deployments ([#69](https://github.com/Consensys/ask-o11y-plugin/issues/69)) ([876e939](https://github.com/Consensys/ask-o11y-plugin/commit/876e939d7b2650d19f4a253de597f3eac3486c4a))

## [0.2.9](https://github.com/Consensys/ask-o11y-plugin/compare/v0.2.8...v0.2.9) (2026-03-03)


### Features

* **agent:** use alert runbook annotation during investigation ([#57](https://github.com/Consensys/ask-o11y-plugin/issues/57)) ([3f1bc5d](https://github.com/Consensys/ask-o11y-plugin/commit/3f1bc5d7b695a2b7033d9a32d79c1bb3f7df29a4))


### Bug Fixes

* **backend:** address Grafana review feedback for Go code quality ([#64](https://github.com/Consensys/ask-o11y-plugin/issues/64)) ([57b42f1](https://github.com/Consensys/ask-o11y-plugin/commit/57b42f1de27fc6a6ac462aa8d416c1cb6d47f29a))
* **ui:** resolve chat UX issues and frontend code quality ([#66](https://github.com/Consensys/ask-o11y-plugin/issues/66)) ([5ec62dc](https://github.com/Consensys/ask-o11y-plugin/commit/5ec62dc2ed597f905734e4bf8f76b3e3a0dc9082))

## [0.2.8](https://github.com/Consensys/ask-o11y-plugin/compare/v0.2.7...v0.2.8) (2026-02-18)


### Features

* **backend:** move agent loop logic server-side with template system and PromptEditor UI ([#53](https://github.com/Consensys/ask-o11y-plugin/issues/53)) ([f50ff9a](https://github.com/Consensys/ask-o11y-plugin/commit/f50ff9accfe79ac779663691fe02c7b5cd338921))

## [0.2.7](https://github.com/Consensys/ask-o11y-plugin/compare/v0.2.6...v0.2.7) (2026-02-14)


### Features

* **agent:** server-side agentic loop with detached execution and E2E test consolidation ([#46](https://github.com/Consensys/ask-o11y-plugin/issues/46)) ([c5fbe29](https://github.com/Consensys/ask-o11y-plugin/commit/c5fbe29383005d94e6713e3625916a8dbe54eb14))


### Bug Fixes

* **config:** enhance claude setup ([7d76956](https://github.com/Consensys/ask-o11y-plugin/commit/7d769561158d91b883a7116ccd956c8c0711ddd2))

## [0.2.6](https://github.com/Consensys/ask-o11y-plugin/compare/v0.2.5...v0.2.6) (2026-02-06)


### Features

* add attestation to artifact ([#2](https://github.com/Consensys/ask-o11y-plugin/issues/2)) ([99b0a07](https://github.com/Consensys/ask-o11y-plugin/commit/99b0a07cbec82a506b5cd619e2018c58dc226585))
* add custom loader with style ([#17](https://github.com/Consensys/ask-o11y-plugin/issues/17)) ([5b4abcc](https://github.com/Consensys/ask-o11y-plugin/commit/5b4abcc810b64632ba2dc0f1df83b4b3d8343999))
* add Right Side Panel ([#3](https://github.com/Consensys/ask-o11y-plugin/issues/3)) ([9bbf7c7](https://github.com/Consensys/ask-o11y-plugin/commit/9bbf7c7851c06611af84321d95abb98916adf498))
* **chat:** add alert investigation mode for one-click RCA ([#29](https://github.com/Consensys/ask-o11y-plugin/issues/29)) ([a0f129e](https://github.com/Consensys/ask-o11y-plugin/commit/a0f129e594e14e8cb5a8594f94681a5a47e8e2d0))
* get ready for first release ([#1](https://github.com/Consensys/ask-o11y-plugin/issues/1)) ([bdd4c98](https://github.com/Consensys/ask-o11y-plugin/commit/bdd4c984bcbb7a732c783b1cdf1f5c80801dd22a))
* store sessions in the backend ([#6](https://github.com/Consensys/ask-o11y-plugin/issues/6)) ([4825a8e](https://github.com/Consensys/ask-o11y-plugin/commit/4825a8e4b35aa4f11464f19be33a24e738dedcaf))
* use scene for split view ([#15](https://github.com/Consensys/ask-o11y-plugin/issues/15)) ([62a8f4b](https://github.com/Consensys/ask-o11y-plugin/commit/62a8f4b23c306f7c7bb18f10b4f885b774e75bd8))


### Bug Fixes

* add orgID to share urls ([#18](https://github.com/Consensys/ask-o11y-plugin/issues/18)) ([b08a530](https://github.com/Consensys/ask-o11y-plugin/commit/b08a5304eb1c992ab7bf03db1beaeda49ba4dac2))
* **ci:** add fast-pass for release-please PRs ([49de748](https://github.com/Consensys/ask-o11y-plugin/commit/49de748180bf36106b6db55c8aacdca7e96c2827))
* **ci:** add workflow_dispatch trigger ([75c59b4](https://github.com/Consensys/ask-o11y-plugin/commit/75c59b4a5a6dbe5c6bf30d117354a3357615bb07))
* **ci:** allow 'main' scope for release-please PRs ([7aa127b](https://github.com/Consensys/ask-o11y-plugin/commit/7aa127bdd9169bf1d04285b0df476bdea69014a6))
* **ci:** make release-please PRs mergeable by skipping CI for non-code changes ([#35](https://github.com/Consensys/ask-o11y-plugin/issues/35)) ([73b1bea](https://github.com/Consensys/ask-o11y-plugin/commit/73b1bea8ef97753ba0c94d895742e03ba17b5ab5))
* **ci:** remove package.json from paths filter ([05ab8b4](https://github.com/Consensys/ask-o11y-plugin/commit/05ab8b421b744eed0da765ece0f3d8a2505b2d22))
* **release:** use PAT for release-please and skip GitHub Release creation ([#37](https://github.com/Consensys/ask-o11y-plugin/issues/37)) ([fc6014a](https://github.com/Consensys/ask-o11y-plugin/commit/fc6014ae1b566c496c9dd977310b5808ce190656))
* **release:** use simple tag format (v0.2.5 not ask-o11y-plugin-v0.2.5) ([e84de65](https://github.com/Consensys/ask-o11y-plugin/commit/e84de653f788fcb4cc23b87d893d135107abf7d2))
* share banner and limit tabs ([#19](https://github.com/Consensys/ask-o11y-plugin/issues/19)) ([51b491d](https://github.com/Consensys/ask-o11y-plugin/commit/51b491de35707265d26ebdefcc414ccb6386323c))
* side panel disappearing after each new question ([#16](https://github.com/Consensys/ask-o11y-plugin/issues/16)) ([527287d](https://github.com/Consensys/ask-o11y-plugin/commit/527287d73a8f55dbc79cb33284188b20059d8594))
* version ([#28](https://github.com/Consensys/ask-o11y-plugin/issues/28)) ([0f9b584](https://github.com/Consensys/ask-o11y-plugin/commit/0f9b584ad65b44d3f36c8d8704a0b5736880e3d2))

## [0.2.5](https://github.com/Consensys/ask-o11y-plugin/compare/v0.2.4...v0.2.5) (2026-02-06)


### Features

* add attestation to artifact ([#2](https://github.com/Consensys/ask-o11y-plugin/issues/2)) ([99b0a07](https://github.com/Consensys/ask-o11y-plugin/commit/99b0a07cbec82a506b5cd619e2018c58dc226585))
* add custom loader with style ([#17](https://github.com/Consensys/ask-o11y-plugin/issues/17)) ([5b4abcc](https://github.com/Consensys/ask-o11y-plugin/commit/5b4abcc810b64632ba2dc0f1df83b4b3d8343999))
* add Right Side Panel ([#3](https://github.com/Consensys/ask-o11y-plugin/issues/3)) ([9bbf7c7](https://github.com/Consensys/ask-o11y-plugin/commit/9bbf7c7851c06611af84321d95abb98916adf498))
* **chat:** add alert investigation mode for one-click RCA ([#29](https://github.com/Consensys/ask-o11y-plugin/issues/29)) ([a0f129e](https://github.com/Consensys/ask-o11y-plugin/commit/a0f129e594e14e8cb5a8594f94681a5a47e8e2d0))
* get ready for first release ([#1](https://github.com/Consensys/ask-o11y-plugin/issues/1)) ([bdd4c98](https://github.com/Consensys/ask-o11y-plugin/commit/bdd4c984bcbb7a732c783b1cdf1f5c80801dd22a))
* store sessions in the backend ([#6](https://github.com/Consensys/ask-o11y-plugin/issues/6)) ([4825a8e](https://github.com/Consensys/ask-o11y-plugin/commit/4825a8e4b35aa4f11464f19be33a24e738dedcaf))
* use scene for split view ([#15](https://github.com/Consensys/ask-o11y-plugin/issues/15)) ([62a8f4b](https://github.com/Consensys/ask-o11y-plugin/commit/62a8f4b23c306f7c7bb18f10b4f885b774e75bd8))


### Bug Fixes

* add orgID to share urls ([#18](https://github.com/Consensys/ask-o11y-plugin/issues/18)) ([b08a530](https://github.com/Consensys/ask-o11y-plugin/commit/b08a5304eb1c992ab7bf03db1beaeda49ba4dac2))
* **ci:** add fast-pass for release-please PRs ([49de748](https://github.com/Consensys/ask-o11y-plugin/commit/49de748180bf36106b6db55c8aacdca7e96c2827))
* **ci:** add workflow_dispatch trigger ([75c59b4](https://github.com/Consensys/ask-o11y-plugin/commit/75c59b4a5a6dbe5c6bf30d117354a3357615bb07))
* **ci:** allow 'main' scope for release-please PRs ([7aa127b](https://github.com/Consensys/ask-o11y-plugin/commit/7aa127bdd9169bf1d04285b0df476bdea69014a6))
* **ci:** make release-please PRs mergeable by skipping CI for non-code changes ([#35](https://github.com/Consensys/ask-o11y-plugin/issues/35)) ([73b1bea](https://github.com/Consensys/ask-o11y-plugin/commit/73b1bea8ef97753ba0c94d895742e03ba17b5ab5))
* **ci:** remove package.json from paths filter ([05ab8b4](https://github.com/Consensys/ask-o11y-plugin/commit/05ab8b421b744eed0da765ece0f3d8a2505b2d22))
* **release:** use simple tag format (v0.2.5 not ask-o11y-plugin-v0.2.5) ([e84de65](https://github.com/Consensys/ask-o11y-plugin/commit/e84de653f788fcb4cc23b87d893d135107abf7d2))
* share banner and limit tabs ([#19](https://github.com/Consensys/ask-o11y-plugin/issues/19)) ([51b491d](https://github.com/Consensys/ask-o11y-plugin/commit/51b491de35707265d26ebdefcc414ccb6386323c))
* side panel disappearing after each new question ([#16](https://github.com/Consensys/ask-o11y-plugin/issues/16)) ([527287d](https://github.com/Consensys/ask-o11y-plugin/commit/527287d73a8f55dbc79cb33284188b20059d8594))
* version ([#28](https://github.com/Consensys/ask-o11y-plugin/issues/28)) ([0f9b584](https://github.com/Consensys/ask-o11y-plugin/commit/0f9b584ad65b44d3f36c8d8704a0b5736880e3d2))

## [0.2.4](https://github.com/Consensys/ask-o11y-plugin/compare/ask-o11y-plugin-v0.2.3...ask-o11y-plugin-v0.2.4) (2026-02-05)


### Features

* add attestation to artifact ([#2](https://github.com/Consensys/ask-o11y-plugin/issues/2)) ([99b0a07](https://github.com/Consensys/ask-o11y-plugin/commit/99b0a07cbec82a506b5cd619e2018c58dc226585))
* add custom loader with style ([#17](https://github.com/Consensys/ask-o11y-plugin/issues/17)) ([5b4abcc](https://github.com/Consensys/ask-o11y-plugin/commit/5b4abcc810b64632ba2dc0f1df83b4b3d8343999))
* add Right Side Panel ([#3](https://github.com/Consensys/ask-o11y-plugin/issues/3)) ([9bbf7c7](https://github.com/Consensys/ask-o11y-plugin/commit/9bbf7c7851c06611af84321d95abb98916adf498))
* **chat:** add alert investigation mode for one-click RCA ([#29](https://github.com/Consensys/ask-o11y-plugin/issues/29)) ([a0f129e](https://github.com/Consensys/ask-o11y-plugin/commit/a0f129e594e14e8cb5a8594f94681a5a47e8e2d0))
* get ready for first release ([#1](https://github.com/Consensys/ask-o11y-plugin/issues/1)) ([bdd4c98](https://github.com/Consensys/ask-o11y-plugin/commit/bdd4c984bcbb7a732c783b1cdf1f5c80801dd22a))
* store sessions in the backend ([#6](https://github.com/Consensys/ask-o11y-plugin/issues/6)) ([4825a8e](https://github.com/Consensys/ask-o11y-plugin/commit/4825a8e4b35aa4f11464f19be33a24e738dedcaf))
* use scene for split view ([#15](https://github.com/Consensys/ask-o11y-plugin/issues/15)) ([62a8f4b](https://github.com/Consensys/ask-o11y-plugin/commit/62a8f4b23c306f7c7bb18f10b4f885b774e75bd8))


### Bug Fixes

* add orgID to share urls ([#18](https://github.com/Consensys/ask-o11y-plugin/issues/18)) ([b08a530](https://github.com/Consensys/ask-o11y-plugin/commit/b08a5304eb1c992ab7bf03db1beaeda49ba4dac2))
* **ci:** add fast-pass for release-please PRs ([49de748](https://github.com/Consensys/ask-o11y-plugin/commit/49de748180bf36106b6db55c8aacdca7e96c2827))
* **ci:** allow 'main' scope for release-please PRs ([7aa127b](https://github.com/Consensys/ask-o11y-plugin/commit/7aa127bdd9169bf1d04285b0df476bdea69014a6))
* share banner and limit tabs ([#19](https://github.com/Consensys/ask-o11y-plugin/issues/19)) ([51b491d](https://github.com/Consensys/ask-o11y-plugin/commit/51b491de35707265d26ebdefcc414ccb6386323c))
* side panel disappearing after each new question ([#16](https://github.com/Consensys/ask-o11y-plugin/issues/16)) ([527287d](https://github.com/Consensys/ask-o11y-plugin/commit/527287d73a8f55dbc79cb33284188b20059d8594))
* version ([#28](https://github.com/Consensys/ask-o11y-plugin/issues/28)) ([0f9b584](https://github.com/Consensys/ask-o11y-plugin/commit/0f9b584ad65b44d3f36c8d8704a0b5736880e3d2))

## [0.1.0] - 2026-01-XX

Initial release of Ask O11y - AI-powered observability assistant for Grafana.

### Added

#### Core Features
- **Natural Language Query Interface**: Conversational AI assistant for querying metrics, logs, and traces
- **Real-time Streaming Responses**: Live LLM responses with tool execution status updates
- **Interactive Visualizations**: 8 chart types (time series, stats, gauge, table, pie, bar, heatmap, histogram)
- **On-the-fly Visualization Switching**: Change chart types without re-running queries
- **Session Management**: Persistent chat sessions with localStorage support
- **Quick Suggestions**: Context-aware query suggestions based on Grafana environment

#### MCP Integration
- **Model Context Protocol Support**: Integration with MCP servers for extensible tool capabilities
- **56+ Grafana Tools**: Complete dashboard, datasource, alerting, and query management
- **Multiple Transport Types**: Standard MCP, OpenAPI/REST, SSE streaming, HTTP streamable
- **Dynamic Tool Discovery**: Automatic detection of available tools from configured MCP servers
- **Multi-server Aggregation**: Proxy and aggregate tools from multiple MCP servers

#### Security & Access Control
- **Role-Based Access Control (RBAC)**: Admin/Editor full access (56 tools), Viewer read-only (45 tools)
- **Multi-tenant Organization Isolation**: Secure data isolation per user, with sessions organized by organization
- **Grafana Permission Integration**: Respects existing Grafana datasource permissions
- **Secure Credential Storage**: Integration with Grafana's secure storage mechanisms

#### Visualization Features
- **Time Range Controls**: Built-in time picker with common presets
- **Auto-refresh**: Configurable intervals from 5 seconds to 1 hour
- **Query Export**: Copy PromQL/LogQL/TraceQL queries to clipboard
- **Theme Support**: Automatic light/dark theme integration
- **Expandable Charts**: Full-screen chart analysis mode
- **Responsive Design**: Mobile and desktop optimized layouts

#### Developer Experience
- **TypeScript**: Strict type checking with comprehensive type definitions
- **React 18**: Modern React with hooks and functional components
- **Tailwind CSS**: Utility-first styling with Grafana theme integration
- **Go Backend**: High-performance MCP proxy server
- **Comprehensive Testing**: Unit tests (Jest), E2E tests (Playwright), Go tests
- **Hot Module Reload**: Fast development workflow with webpack dev server

#### Data Source Support
- **Prometheus**: PromQL query execution with metric visualization
- **Loki**: LogQL query execution with log exploration
- **Tempo**: TraceQL query execution with trace analysis
- **Generic Datasources**: Query any Grafana datasource through natural language

#### Tool Categories
- **Datasource Operations**: Query, list, test connectivity, health checks
- **Dashboard Management**: Create, update, delete, search, star, snapshot
- **Alert Management**: Configure alerts, silences, notification channels, contact points
- **Query Execution**: Run queries with automatic visualization
- **Resource Discovery**: Search and explore Grafana resources
- **Panel Operations**: Manage dashboard panels and visualizations
- **Folder Management**: Organize dashboards with folder operations
- **User Management**: Query user information and permissions

### Technical Details

#### Frontend Stack
- React 18.2.0 with TypeScript 5.5.4
- Grafana UI Components (@grafana/ui, @grafana/data, @grafana/scenes)
- Tailwind CSS 4.1.12 for styling
- RxJS 7.8.2 for reactive state management
- Model Context Protocol SDK (@modelcontextprotocol/sdk)

#### Backend Stack
- Go 1.23+ with Grafana Plugin SDK
- MCP Go SDK for server integration
- Multi-transport proxy server
- Health monitoring and connection management

#### Build & CI/CD
- Webpack 5 for frontend bundling
- Mage for Go build automation
- Multi-platform builds (Linux amd64/arm64, macOS amd64/arm64, Windows amd64)
- GitHub Actions CI/CD pipeline
- Automated testing and validation
- Plugin signing support

#### Supported Grafana Versions
- Minimum: Grafana 12.1.1
- Tested: Grafana 12.x and Enterprise editions

### Dependencies

#### Plugin Dependencies
- grafana-llm-app: Required for LLM provider integration

#### Key Libraries
- @grafana/* packages: Core Grafana integration
- @modelcontextprotocol/sdk: MCP client functionality
- js-tiktoken: Token counting for LLM context management
- streamdown: Markdown streaming utilities

### Notes
- This is the initial community release
- Requires LLM API key configuration (OpenAI, Anthropic, or compatible provider)
- MCP server configuration required for full functionality
- MIT License

[0.1.0]: https://github.com/Consensys/ask-o11y-plugin/releases/tag/v0.1.0
