# Changelog

All notable changes to this project are documented in this file.

## [0.11.6](https://github.com/dyphn1/Harness-everything/compare/v0.11.5...v0.11.6) (2026-09-18)

### Bug Fixes

* **workflow:** avoid workflow rewrite after probe registration ([b9f2e06](https://github.com/dyphn1/Harness-everything/commit/b9f2e065114d70e927b6f75e7c0f7899d9e8392f))
* **workflow:** correlate mutation probes by tool-use identity ([86cd1a1](https://github.com/dyphn1/Harness-everything/commit/86cd1a1c6eaef6518936160b0c35f94a3e652cae))
* **workflow:** defer shell mutation accounting to observer ([c543fd0](https://github.com/dyphn1/Harness-everything/commit/c543fd0c41e18f05c21235ce4ffcf28864200940))
* **workflow:** discard denied shell mutation probes ([7a8757c](https://github.com/dyphn1/Harness-everything/commit/7a8757cab821e524ccdd17e416e013bfbadc4f39))
* **workflow:** fingerprint observed workspace effects ([9d8e316](https://github.com/dyphn1/Harness-everything/commit/9d8e316eb97ec7bbcd0e46ceb51491af90e57e9f))
* **workflow:** fingerprint visible content independent of staging ([a1f370e](https://github.com/dyphn1/Harness-everything/commit/a1f370e64a97b04bee4d8df23e3ffdc7552377b8))
* **workflow:** isolate mutation probes per tool call ([70d6052](https://github.com/dyphn1/Harness-everything/commit/70d6052ef02fce1125da9a20a14a4ad65d09ba93))
* **workflow:** make mutation observation single-handler ordered ([ea166e1](https://github.com/dyphn1/Harness-everything/commit/ea166e1a94cdd1725cd7242feb5b0716a4dce8b8))
* **workflow:** normalize deleted paths in fingerprint ([e5019da](https://github.com/dyphn1/Harness-everything/commit/e5019daee870e806d77d92c741a9624cd6c9bfe0))
* **workflow:** observe shell effects before state persistence ([5271655](https://github.com/dyphn1/Harness-everything/commit/5271655627344eb71ffeb8dd36b007709862b9d0))
* **workflow:** observe shell workspace mutations ([c547b39](https://github.com/dyphn1/Harness-everything/commit/c547b396bf2e3829b83ed03abeca594b7391f542))
* **workflow:** remove parallel standalone mutation observer ([20027f6](https://github.com/dyphn1/Harness-everything/commit/20027f68f5b63719ea7a96a524f49c7103586644))
* **workflow:** reserve shell mutation probes ([e7273f6](https://github.com/dyphn1/Harness-everything/commit/e7273f66010d5b0c740b87b8dbc020c8de616fe7))
* **workflow:** settle mutation probes inside state persistence ([88feaf4](https://github.com/dyphn1/Harness-everything/commit/88feaf4ee3accbd8504b745fd4e79e548c31bd6d))

## [0.11.5](https://github.com/dyphn1/Harness-everything/compare/v0.11.4...v0.11.5) (2026-09-18)

### Bug Fixes

* **workflow:** lex shell separators safely ([df1a92c](https://github.com/dyphn1/Harness-everything/commit/df1a92ca6129ea96390e463ebcaef769604742e2))

## [0.11.4](https://github.com/dyphn1/Harness-everything/compare/v0.11.3...v0.11.4) (2026-09-18)

### Bug Fixes

* **workflow:** Stop classifyShell misclassifying safe read-only chains as mutations ([96d687a](https://github.com/dyphn1/Harness-everything/commit/96d687ab4437ab19e3a743d1b9bf5113cfe52525)), closes [82/#149](https://github.com/82/Harness-everything/issues/149) [#155](https://github.com/dyphn1/Harness-everything/issues/155) [#82](https://github.com/dyphn1/Harness-everything/issues/82) [#133](https://github.com/dyphn1/Harness-everything/issues/133) [#149](https://github.com/dyphn1/Harness-everything/issues/149) [#153](https://github.com/dyphn1/Harness-everything/issues/153)

## [0.11.3](https://github.com/dyphn1/Harness-everything/compare/v0.11.2...v0.11.3) (2026-09-18)

### Bug Fixes

* **workflow:** Resolve verification-after-edit-missing without a host exit code ([e5dae03](https://github.com/dyphn1/Harness-everything/commit/e5dae03799cca594ac3e4f9d0facca6209dec3c8)), closes [#153](https://github.com/dyphn1/Harness-everything/issues/153)

## [0.11.2](https://github.com/dyphn1/Harness-everything/compare/v0.11.1...v0.11.2) (2026-09-18)

### Bug Fixes

* **workflow:** classify major workflow from active plan ([b1eae14](https://github.com/dyphn1/Harness-everything/commit/b1eae14ca5157c73ba9cf7c0f2e4b0ed122e9f77))
* **workflow:** keep pending plan isolation inert ([8b522c2](https://github.com/dyphn1/Harness-everything/commit/8b522c26589e2140bd0971365ad0569c18da6d3f))

## [0.11.1](https://github.com/dyphn1/Harness-everything/compare/v0.11.0...v0.11.1) (2026-09-18)

### Bug Fixes

* **workflow:** admit all trusted controller commands ([65ec5f3](https://github.com/dyphn1/Harness-everything/commit/65ec5f31e9d218d7c32e1d9ed82992814be79b9b))
* **workflow:** share controller command contract ([b9ba2dc](https://github.com/dyphn1/Harness-everything/commit/b9ba2dc59a5c2dce10533aad79b9a5303b921506))
* **workflow:** validate shared controller command set ([8d3247d](https://github.com/dyphn1/Harness-everything/commit/8d3247d51d8aa0f1cfa61328c1061cb239dfba6a))

## [0.11.0](https://github.com/dyphn1/Harness-everything/compare/v0.10.0...v0.11.0) (2026-09-18)

### Features

* **contract-integrity:** add trace reconciliation audit ([bb99f7a](https://github.com/dyphn1/Harness-everything/commit/bb99f7a8c29e14bd718a896ef30c7b820dcb2d7c))
* **contract-integrity:** bind evidence to current living spec ([77f203a](https://github.com/dyphn1/Harness-everything/commit/77f203a1f59d968d1a4075e3441e2113adeb0942))
* **contract-integrity:** define trace and probe schema ([d688f8a](https://github.com/dyphn1/Harness-everything/commit/d688f8a7dba66e3e7faa8e33fd3d659b09982143))
* **contract-integrity:** expose audit and regression scripts ([fa33f11](https://github.com/dyphn1/Harness-everything/commit/fa33f118b4a1995ce02feb69e76b0145d6b7e5d2))

### Bug Fixes

* **contract-integrity:** align runtime validation with schema ([b4d702a](https://github.com/dyphn1/Harness-everything/commit/b4d702a248f7f088e4ce97dee21b92250390a451))

## [0.10.0](https://github.com/dyphn1/Harness-everything/compare/v0.9.0...v0.10.0) (2026-09-18)

### Features

* **self-evolve:** add lesson candidate lifecycle ([b53a7a9](https://github.com/dyphn1/Harness-everything/commit/b53a7a9435d27ea75cf02b6b38522306cb71bdb3))
* **self-evolve:** add lesson candidate lifecycle ([2ee8c21](https://github.com/dyphn1/Harness-everything/commit/2ee8c21904546bd6049b6a8cfaa19caaff584795))
* **self-evolve:** add runtime learning opportunity emitter ([21223a2](https://github.com/dyphn1/Harness-everything/commit/21223a24ba740b6903fd6aa8bbc0b29da7c2355e))
* **self-evolve:** add runtime learning opportunity emitter ([59803a5](https://github.com/dyphn1/Harness-everything/commit/59803a5005385abf209fc8d8e9a3050cf1ebc758))
* **self-evolve:** correlate retrieval to lesson candidate ([3041df3](https://github.com/dyphn1/Harness-everything/commit/3041df3ffce37a7917db4911e9bb61a96ee0d619))
* **self-evolve:** correlate retrieval to lesson candidate ([d8e2a1f](https://github.com/dyphn1/Harness-everything/commit/d8e2a1f0acbe4e8c0afd34ce745a3359fc073ea3))
* **self-evolve:** define lesson candidate schema ([69cbb57](https://github.com/dyphn1/Harness-everything/commit/69cbb57e2a9798e4c4fe2e42c38a83bf4b3be762))
* **self-evolve:** define lesson candidate schema ([a99db38](https://github.com/dyphn1/Harness-everything/commit/a99db38a68be95fdbc1d24cbb8571b10c0c9831a))
* **self-evolve:** emit Rule-of-3 recovery candidates ([3635add](https://github.com/dyphn1/Harness-everything/commit/3635add62786bc4f73895a11ef2b12de7752333d))
* **self-evolve:** emit Rule-of-3 recovery candidates ([618260d](https://github.com/dyphn1/Harness-everything/commit/618260de246fd01cfa6c8a4da413a6f00522fe8e))
* **self-evolve:** emit verifier recovery candidates ([c125143](https://github.com/dyphn1/Harness-everything/commit/c125143f5c6f2487f0271cef40933547794cf95e))
* **self-evolve:** emit verifier recovery candidates ([46bd554](https://github.com/dyphn1/Harness-everything/commit/46bd554865ba82ac2d52a1d8980f88448e288955))
* **self-evolve:** retain promotion writer provenance ([fee88e5](https://github.com/dyphn1/Harness-everything/commit/fee88e51a7c87d03fe60ff95ae93298a3db71b82))
* **self-evolve:** retain promotion writer provenance ([1bc4b94](https://github.com/dyphn1/Harness-everything/commit/1bc4b94bcdade65fd4e094a5ed965b84b311c2b5))
* **telemetry:** add fail-open skill lifecycle adapter ([4de5ca7](https://github.com/dyphn1/Harness-everything/commit/4de5ca7e2b4b97af73bc65304fe22a667c0d5525))
* **telemetry:** add local overhead benchmark ([85284eb](https://github.com/dyphn1/Harness-everything/commit/85284ebd376b5116c2e859d428cf441d633bbbf6))
* **telemetry:** add normalized aggregation report ([a317478](https://github.com/dyphn1/Harness-everything/commit/a3174785770a6a8c8a3884fd02e10a8abc620c33))
* **telemetry:** add OpenCode lifecycle adapter ([a3c400d](https://github.com/dyphn1/Harness-everything/commit/a3c400d32511f321bfbbd34e4c67ad71af1df4fd))
* **telemetry:** add privacy-safe local JSONL sink ([ca6f8d0](https://github.com/dyphn1/Harness-everything/commit/ca6f8d0154330609692f3b9ec9d12e99b6a497f1))
* **telemetry:** define normalized event schema ([fa69e5d](https://github.com/dyphn1/Harness-everything/commit/fa69e5d2ae1f1cc5dc7e2a1b49cc90b697e72894))
* **telemetry:** expose report benchmark and test scripts ([c235a7e](https://github.com/dyphn1/Harness-everything/commit/c235a7e81ac285de68e1b41f7089b3a062cf6a98))
* **telemetry:** observe tools from existing state hook ([aa81a70](https://github.com/dyphn1/Harness-everything/commit/aa81a70d19927179a7861e5f6e3d0e5a80a1eec1))
* **telemetry:** package mechanism-only Codex skill adapter ([00b45f1](https://github.com/dyphn1/Harness-everything/commit/00b45f1dcfeee99a087ed9c8d6dcc64307965607))
* **telemetry:** wire Claude skill lifecycle ([840a9b1](https://github.com/dyphn1/Harness-everything/commit/840a9b15dc4c08e67386baaeb20cf58bfb04ef4a))

### Bug Fixes

* **self-evolve:** keep recovery capture non-blocking ([d507daf](https://github.com/dyphn1/Harness-everything/commit/d507daff7386d1d917c63cd9efdfd65916aa264a))
* **self-evolve:** keep recovery capture non-blocking ([6a478e7](https://github.com/dyphn1/Harness-everything/commit/6a478e7b6c7fbdad3f6beccd1a8fc3ad1c6b34b1))
* **self-evolve:** keep verifier capture non-blocking ([bce9de5](https://github.com/dyphn1/Harness-everything/commit/bce9de56c2fbbb65a4bec930eac0efd550c2f8b9))
* **self-evolve:** keep verifier capture non-blocking ([b517a52](https://github.com/dyphn1/Harness-everything/commit/b517a5252d6023dfe5bd7e8d1eb5d0d11bb039f2))
* **self-evolve:** preserve validated routing trigger semantics ([7dc07cc](https://github.com/dyphn1/Harness-everything/commit/7dc07cc1112d88e5234380f0b0351a7b7556b307))
* **self-evolve:** preserve validated routing trigger semantics ([15080ab](https://github.com/dyphn1/Harness-everything/commit/15080ab1df41bf3e11909526ee2c8f03a438479d))
* **telemetry:** keep unavailable host duration null ([0cdc0f1](https://github.com/dyphn1/Harness-everything/commit/0cdc0f136336314709bfffed02f305a01e76a6e5))

## [0.9.0](https://github.com/dyphn1/Harness-everything/compare/v0.8.1...v0.9.0) (2026-09-18)

### Features

* **action-gate:** classify structured tool actions ([3502f42](https://github.com/dyphn1/Harness-everything/commit/3502f4200401be029250ac503ea283f90fd5552d))
* **action-gate:** package isolated MCP adapters ([81133db](https://github.com/dyphn1/Harness-everything/commit/81133db7fffc417fdc01530db01235dcfb32f3c7))
* **action-gate:** wire Claude MCP lifecycle ([27c9e72](https://github.com/dyphn1/Harness-everything/commit/27c9e72171f7a69d1f0797356feae71d50fa02b9))
* **memory:** add deterministic scoped retrieval ([2fb175c](https://github.com/dyphn1/Harness-everything/commit/2fb175c98274bf031fd54d6d3cace321a040d63e))
* **memory:** add deterministic scoped retrieval ([bfa158b](https://github.com/dyphn1/Harness-everything/commit/bfa158b2e519460b45cbf85796549816a32c826f))
* **memory:** detect explicit persistence intent ([f438543](https://github.com/dyphn1/Harness-everything/commit/f438543f2e27ef50f419fd52d51fc606e72bac61))
* **memory:** detect explicit persistence intent ([7b37cee](https://github.com/dyphn1/Harness-everything/commit/7b37ceeab58c239ab81f6310fcc6543e64c6f194))
* **memory:** enforce workflow-authorized persistence ([987ecd1](https://github.com/dyphn1/Harness-everything/commit/987ecd1c3e5bfc2564a2c8eb3280b717041c1cb9))
* **memory:** issue workflow-bound write capability ([93c001f](https://github.com/dyphn1/Harness-everything/commit/93c001facc11c30a97d83bcc6d1debbdd5dba25d))
* **memory:** issue workflow-bound write capability ([0034f1a](https://github.com/dyphn1/Harness-everything/commit/0034f1a58724f6cf76c3bbecc06dab7b43f6c464))
* **memory:** route bounded persistence requests ([bfabb4a](https://github.com/dyphn1/Harness-everything/commit/bfabb4a27aa9db9545136a450b76037241b1becd))
* **memory:** route bounded persistence requests ([1451b7a](https://github.com/dyphn1/Harness-everything/commit/1451b7a9f64cadb857223899dffa14ca427dfda4))
* **memory:** route explicit persistence authorization ([ea275cc](https://github.com/dyphn1/Harness-everything/commit/ea275cc1b60b7211607095d21136f50f49f602d6))
* **memory:** route explicit persistence authorization ([3fb9e23](https://github.com/dyphn1/Harness-everything/commit/3fb9e23e01361128f75df8d2aea9ef9e916e74d7))
* **memory:** schema persistence intent signal ([50dfb83](https://github.com/dyphn1/Harness-everything/commit/50dfb830ff0bb4e548d36115a55fda16d7e77f8b))
* **memory:** schema persistence intent signal ([4fdd410](https://github.com/dyphn1/Harness-everything/commit/4fdd410309974def42dbd13f9a46e94ca57673b3))
* **memory:** surface authorization invariant ([88f87a2](https://github.com/dyphn1/Harness-everything/commit/88f87a2be9942a00fd85e0e383dcc015ef101313))
* **memory:** surface authorization invariant ([00c7588](https://github.com/dyphn1/Harness-everything/commit/00c7588bbf5fbdefdc472e2a0e27a40b2c0ba91e))
* **runtime:** account failed verification rounds ([4bb3ea1](https://github.com/dyphn1/Harness-everything/commit/4bb3ea1a45661672e932ae758d77482a453c46ad))
* **runtime:** add run-scoped budget accounting ([b1dc987](https://github.com/dyphn1/Harness-everything/commit/b1dc9875701c81dcd4d92ac8a882a6e16fadb909))
* **runtime:** cap parallel dispatch batches ([0c587bc](https://github.com/dyphn1/Harness-everything/commit/0c587bc963370e50698626b647a0a69c96e63aec))
* **runtime:** cap parallel dispatch batches ([42f396f](https://github.com/dyphn1/Harness-everything/commit/42f396fb6f4e3d8f91d3b7b1027cdd3c3543a65e))
* **runtime:** enforce iterative mutation budget ([8b54044](https://github.com/dyphn1/Harness-everything/commit/8b54044f27cf05608a8e192857e0362e3ff5a207))
* **runtime:** enforce replan and revision budgets ([3fae99b](https://github.com/dyphn1/Harness-everything/commit/3fae99bb28e5f2354465936fba11e8f7406be4fd))
* **runtime:** enforce worker concurrency budget ([5a7de6d](https://github.com/dyphn1/Harness-everything/commit/5a7de6daa4292047c5a623b338551324689e84bd))
* **runtime:** make workflow limits numeric ([9295ee2](https://github.com/dyphn1/Harness-everything/commit/9295ee2f9ad043abce8dc07e9b88a1210f152286))
* **runtime:** make workflow limits numeric ([2409f5b](https://github.com/dyphn1/Harness-everything/commit/2409f5bce4dd338bf9f7496d0a4a00498a9ca1e4))
* **runtime:** schema numeric workflow budgets ([7fa7a55](https://github.com/dyphn1/Harness-everything/commit/7fa7a556bebf38257c4fdf8d0837acba5ae630ce))
* **runtime:** schema numeric workflow budgets ([9cc26a1](https://github.com/dyphn1/Harness-everything/commit/9cc26a1d352eeab03dc8dc973850476f7d60b080))

## [0.8.1](https://github.com/dyphn1/Harness-everything/compare/v0.8.0...v0.8.1) (2026-09-17)

### Bug Fixes

* **router:** enforce selected workflow lifecycle ([9f3394a](https://github.com/dyphn1/Harness-everything/commit/9f3394a3ff59aaa08428e12a9a2784e7541368c4))
* **workflow:** Close lifecycle isolation gaps ([96b58e7](https://github.com/dyphn1/Harness-everything/commit/96b58e7ce2e52312880663e59380038e4bf5f985)), closes [#131](https://github.com/dyphn1/Harness-everything/issues/131)
* **workflow:** Normalize Windows worktree paths ([18ee645](https://github.com/dyphn1/Harness-everything/commit/18ee645a1a7165d01d60a964947082ad0108b93c)), closes [#131](https://github.com/dyphn1/Harness-everything/issues/131)
* **workflow:** require worktree isolation for major mutations ([9ba0098](https://github.com/dyphn1/Harness-everything/commit/9ba0098adc94fe141fca2c03f07d0883d9a56b9b))

## [Unreleased]

### Fixed

- Make selected workflows persist across follow-up prompts, bind Fable runs to workflow/session identities, and require correlated stage evidence before completion (#131, #142).
- Enforce major-workflow Git worktree isolation at supported mutation hooks, check direct/patch targets and explicit shell paths, and retain isolation across scoped escape and blocked states.
- Provide bounded run entry/replan and per-stage escape commands; expose unsupported hosts and shell-sandbox limits without upgrading live-host evidence.

## [0.8.0](https://github.com/dyphn1/Harness-everything/compare/v0.7.0...v0.8.0) (2026-09-17)

### Features

* **router:** require evaluation before skipping suggested skills ([#140](https://github.com/dyphn1/Harness-everything/issues/140)) ([b959cb9](https://github.com/dyphn1/Harness-everything/commit/b959cb94afff984c4e4507f0be7f6c62dfa89961)), closes [#131](https://github.com/dyphn1/Harness-everything/issues/131)

## [0.7.0](https://github.com/dyphn1/Harness-everything/compare/v0.6.1...v0.7.0) (2026-09-17)

### Features

* **router:** make routing checkpoint observable ([#139](https://github.com/dyphn1/Harness-everything/issues/139)) ([97dc06d](https://github.com/dyphn1/Harness-everything/commit/97dc06d6b07747ba5e9c328838b8d535c9585b00)), closes [#282](https://github.com/dyphn1/Harness-everything/issues/282)

## [0.6.1](https://github.com/dyphn1/Harness-everything/compare/v0.6.0...v0.6.1) (2026-09-17)

### Bug Fixes

* **hooks:** harden atomic commit and destructive action gates ([#132](https://github.com/dyphn1/Harness-everything/issues/132)) ([e7dee3a](https://github.com/dyphn1/Harness-everything/commit/e7dee3aed9bc2c2922151743e573f62ecdd60039)), closes [#90](https://github.com/dyphn1/Harness-everything/issues/90) [#100](https://github.com/dyphn1/Harness-everything/issues/100)

## [0.6.0](https://github.com/dyphn1/Harness-everything/compare/v0.5.3...v0.6.0) (2026-09-17)

### Features

* **behavioral:** add paired benchmark contract ([42d52b3](https://github.com/dyphn1/Harness-everything/commit/42d52b3a6db89fa27cd2239726a22fe119299932))

## [0.5.3](https://github.com/dyphn1/Harness-everything/compare/v0.5.2...v0.5.3) (2026-09-17)

### Bug Fixes

* **opencode:** Install discoverable plugin and guard loadability ([5645c08](https://github.com/dyphn1/Harness-everything/commit/5645c080c794b82afd50a0206cf35d2dd3fcd54c))

## [0.5.2](https://github.com/dyphn1/Harness-everything/compare/v0.5.1...v0.5.2) (2026-09-16)

### Bug Fixes

* **release:** close semantic-release contract gaps ([79d2a76](https://github.com/dyphn1/Harness-everything/commit/79d2a76c931eaaa8928334877ca2b1195e06cce4))

## [0.5.1](https://github.com/dyphn1/Harness-everything/compare/v0.5.0...v0.5.1) (2026-09-16)

### Bug Fixes

* **rule-of-3:** parse Claude failure hook payload ([83d3106](https://github.com/dyphn1/Harness-everything/commit/83d310653d19fd72f597d119eface1c3baf5a7bd))
* **rule-of-3:** wire Claude failure hook to tracker ([11b3e9e](https://github.com/dyphn1/Harness-everything/commit/11b3e9e7a08b0394d2dd3dac78bd1464ae5881df))

## [0.5.0](https://github.com/dyphn1/Harness-everything/compare/v0.4.4...v0.5.0) (2026-09-16)

### Features

* **claude:** add plugin-only staging helper ([64e619b](https://github.com/dyphn1/Harness-everything/commit/64e619ba1add2678fac26152fe9e95a82517c03b))
* **claude:** add strict host validation helper ([8d4ba18](https://github.com/dyphn1/Harness-everything/commit/8d4ba18396bd9ed305f26849f937f3e4e0d4d1ad))

### Bug Fixes

* **claude:** add strict marketplace description ([61129e5](https://github.com/dyphn1/Harness-everything/commit/61129e5078352ad8e0af343cba10255e9d31a0f5))
* **claude:** correct hook validation diagnostic ([dd6681b](https://github.com/dyphn1/Harness-everything/commit/dd6681b5a073dcef19c17c9eda7ffbeb1cc5687f))
* **claude:** keep staging output outside checkout ([10ac0da](https://github.com/dyphn1/Harness-everything/commit/10ac0da0c0e62537490d4051bb20c9095c601831))

## [0.4.4](https://github.com/dyphn1/Harness-everything/compare/v0.4.3...v0.4.4) (2026-09-16)

### Bug Fixes

* **codex:** use portable PLUGIN_ROOT hook placeholders ([cdad922](https://github.com/dyphn1/Harness-everything/commit/cdad922baae531b9bacbf975b6149a48bca947d5))

## [0.4.3](https://github.com/dyphn1/Harness-everything/compare/v0.4.2...v0.4.3) (2026-09-16)

### Bug Fixes

* **codex:** add PreToolUse attribution adapter ([9c54688](https://github.com/dyphn1/Harness-everything/commit/9c54688efc647bb34311dae57abe8766567daf5b))
* **codex:** package PreToolUse attribution adapter ([93cb459](https://github.com/dyphn1/Harness-everything/commit/93cb4592f2b3f1ebfbed71882dd0f25579b0b469))
* **codex:** route PreToolUse through attribution adapter ([0ac9221](https://github.com/dyphn1/Harness-everything/commit/0ac922111912813635e9fbc747f7aaa22666bc94))

## [0.4.2](https://github.com/dyphn1/Harness-everything/compare/v0.4.1...v0.4.2) (2026-09-16)

## [0.4.1](https://github.com/dyphn1/Harness-everything/compare/v0.4.0...v0.4.1) (2026-09-16)

## [0.4.0](https://github.com/dyphn1/Harness-everything/compare/v0.3.6...v0.4.0) (2026-09-16)

### Features

* **action-gate:** add destructive action rule table ([fc472b0](https://github.com/dyphn1/Harness-everything/commit/fc472b04dcba1b2b27faf42e2ba69a28e49191f9))
* **action-gate:** enforce pre-action approval ([fca6ccb](https://github.com/dyphn1/Harness-everything/commit/fca6ccba4d07a18f46fa1d43b214cb10a8be122c))
* **action-gate:** mirror destructive action rule table ([4ad59aa](https://github.com/dyphn1/Harness-everything/commit/4ad59aa51e2450a761e31db524f03e0ac754b1a6))
* **action-gate:** mirror pre-action approval enforcement ([5b254ea](https://github.com/dyphn1/Harness-everything/commit/5b254eaace8e438c3e1aa969ad150256f6e07161))
* **action-gate:** wire Claude lifecycle enforcement ([eadca2f](https://github.com/dyphn1/Harness-everything/commit/eadca2fcc8a98a5467a12774f0cad7983a4252f8))
* **action-gate:** wire plugin lifecycle enforcement ([f15a500](https://github.com/dyphn1/Harness-everything/commit/f15a50074fc564ebb8cdc72bc6b2979fe323c0f2))
* **codex:** observe native permission requests ([2cb472c](https://github.com/dyphn1/Harness-everything/commit/2cb472cee3786e2f510f0e1356f7163bcd37026d))
* **codex:** package native permission observer ([c7c279c](https://github.com/dyphn1/Harness-everything/commit/c7c279c5e187ec02830c91b8925129377fe338eb))
* **codex:** wire native permission request observer ([318c6ca](https://github.com/dyphn1/Harness-everything/commit/318c6ca14ef16f1846a0f1b993b1ce0a8e13d588))
* **compatibility:** Add official platform capability matrix ([3b423e2](https://github.com/dyphn1/Harness-everything/commit/3b423e233536406a6ef58609a1471b604ed1b461))
* **fable:** add bounded ensemble evidence synthesis ([df18314](https://github.com/dyphn1/Harness-everything/commit/df1831495344cc738617c320216799146192f6af))
* **fable:** add workflow plan consumer and run-scoped contracts ([215fe26](https://github.com/dyphn1/Harness-everything/commit/215fe266a748591870c98873100e05c05d3ce1b5))
* **hooks:** add run-scoped fable contract helpers ([0fa5b39](https://github.com/dyphn1/Harness-everything/commit/0fa5b3936184c98c293d6dbe265371cd0a5f47eb))
* **hooks:** correlate stage checks with run-scoped contracts ([2be79a9](https://github.com/dyphn1/Harness-everything/commit/2be79a9f9e50417c5211698bae380c4f080c50ee))
* **hooks:** validate subagent diffs against declared write sets ([56a1521](https://github.com/dyphn1/Harness-everything/commit/56a152135b100e432a6b2666531d26f930d6a0eb))
* **installer:** Add canonical per-scope skill store with link-aware uninstall ([4ec59dd](https://github.com/dyphn1/Harness-everything/commit/4ec59dd8702abf99574aab2524e65c84ad698bef)), closes [#49](https://github.com/dyphn1/Harness-everything/issues/49)
* **memory:** screen persisted rules and record provenance ([8f0759a](https://github.com/dyphn1/Harness-everything/commit/8f0759acf013281552440990977abc87d2d7ad4e))
* **openai:** 完成外掛生命週期支援 ([bf5d75b](https://github.com/dyphn1/Harness-everything/commit/bf5d75b19c5a979cd10a90a43cba61c09e2326ca)), closes [#72](https://github.com/dyphn1/Harness-everything/issues/72)
* **plugin:** add deterministic skills submission bundle builder ([a6fc321](https://github.com/dyphn1/Harness-everything/commit/a6fc3214460fe48961ee8f6cbadda4b3f0a335d4))
* **plugin:** add OpenAI submission listing source ([f0915dc](https://github.com/dyphn1/Harness-everything/commit/f0915dc650214691f7e89af2f19ea73cd1309530))
* **plugin:** mirror bounded ensemble evidence synthesis ([3b6c3f0](https://github.com/dyphn1/Harness-everything/commit/3b6c3f0f63c205882222747434395d8fb547847e))
* **plugin:** mirror bounded ensemble modifier policy ([aa9ee20](https://github.com/dyphn1/Harness-everything/commit/aa9ee20be35582567a9877e85b6337d2dded7198))
* **plugin:** mirror bounded ensemble schema ([e8b138e](https://github.com/dyphn1/Harness-everything/commit/e8b138e5018d4a011094432acc6ceb59cf127bd1))
* **plugin:** mirror kernel ensemble modifier ([389146a](https://github.com/dyphn1/Harness-everything/commit/389146a36037d3e1cf6ecbf4317ab0d887c254c7))
* **plugin:** mirror memory persistence screening ([0b707a9](https://github.com/dyphn1/Harness-everything/commit/0b707a91a89eb3da46091314f0a3977b5a9d90e9))
* **plugin:** package Harness Everything for ChatGPT and Codex ([0ce65d0](https://github.com/dyphn1/Harness-everything/commit/0ce65d0165b4890c847f561f79f95ebfd25d81e5))
* **plugin:** prepare Harness Everything for OpenAI publication ([8e827f6](https://github.com/dyphn1/Harness-everything/commit/8e827f6b8a0027c388bb18d94a8ae127a1d06141))
* **release:** add deterministic version synchronizer ([9a75283](https://github.com/dyphn1/Harness-everything/commit/9a75283718b624b98c98da6871ec80e8e397f031))
* **release:** align OpenCode plugin version ([e1a3e87](https://github.com/dyphn1/Harness-everything/commit/e1a3e87d79ec50701107e6e4cd29afa7a4c7eaf5))
* **release:** configure semantic release ([93020dc](https://github.com/dyphn1/Harness-everything/commit/93020dcedc0f58eabe7b05b27963be71cfa52e60))
* **release:** publish from conventional commit history ([585516b](https://github.com/dyphn1/Harness-everything/commit/585516bf4fa138d71860e0c25c01bef51cb31b32))
* **release:** remove beta Claude plugin version ([cb24975](https://github.com/dyphn1/Harness-everything/commit/cb24975f64c009cd84d571b9d994eb94899a7f32))
* **release:** remove beta Codex plugin version ([4c11024](https://github.com/dyphn1/Harness-everything/commit/4c11024f6f0895238447bb229cffbf4676bbb104))
* **release:** remove beta marketplace version ([85d48a7](https://github.com/dyphn1/Harness-everything/commit/85d48a790049460ad83e565674898f01d1592915))
* **release:** remove beta package version ([e5c24dd](https://github.com/dyphn1/Harness-everything/commit/e5c24ddd2f01451735b3961463b9139eb0608111))
* **release:** remove beta portable plugin version ([f94ff42](https://github.com/dyphn1/Harness-everything/commit/f94ff424830137a1d20e02277af461dfdb3475b0))
* **router:** add bounded ensemble modifier policy ([ae25dc5](https://github.com/dyphn1/Harness-everything/commit/ae25dc5096aba4254fc42c16f7dc746be5af668d))
* **router:** add task-shape schema ([5185d75](https://github.com/dyphn1/Harness-everything/commit/5185d759e68687eb32bd45f868581405ad8be59b))
* **router:** add versioned workflow plan contract ([714bb3f](https://github.com/dyphn1/Harness-everything/commit/714bb3fb4db4d47e3808c41e2eb133eb85df4510))
* **router:** add workflow plan schema ([1ffa89b](https://github.com/dyphn1/Harness-everything/commit/1ffa89b99d3d57497031e2673a966efe26304474))
* **router:** attach ensemble modifier at kernel contract boundary ([29841fc](https://github.com/dyphn1/Harness-everything/commit/29841fce11a15de1746517488eef218d4f1bf74c))
* **router:** consume structured tier contract ([6472bde](https://github.com/dyphn1/Harness-everything/commit/6472bdefc20659347256086600b29eadf358f727))
* **router:** derive task shape and safety modifiers ([904c0bf](https://github.com/dyphn1/Harness-everything/commit/904c0bf364d57443a8b1006d6e83709b3d2171ed))
* **router:** emit structured shadow routing contract ([49fcc72](https://github.com/dyphn1/Harness-everything/commit/49fcc7267bc4e6f91b92151e8009455b37905d77))
* **router:** extend task-shape schema for phase 2 ([21d98ec](https://github.com/dyphn1/Harness-everything/commit/21d98ec3d902e27181ae2e80b402e046376bdc3b))
* **router:** extend workflow-plan schema for selected strategies ([69b4f15](https://github.com/dyphn1/Harness-everything/commit/69b4f1506da1c5624f124085215c882f64c96f77))
* **router:** make kernel consume selected workflow plan ([f9162e5](https://github.com/dyphn1/Harness-everything/commit/f9162e55aa623c25023a30ccb84dbbe601ac6d26))
* **router:** select deterministic phase 2 strategies ([b85b0e9](https://github.com/dyphn1/Harness-everything/commit/b85b0e94c3fd1c749f5d563264bd8ce06b038b9f))
* **schema:** define bounded ensemble modifier contract ([6e1fa26](https://github.com/dyphn1/Harness-everything/commit/6e1fa266bee0665d7fa7713ba00697cd66b4edfb))
* **tdd:** Add quantified quality gate ([0fd4abf](https://github.com/dyphn1/Harness-everything/commit/0fd4abf19479ab3bb250d080622ddedd61593f31)), closes [#58](https://github.com/dyphn1/Harness-everything/issues/58)
* **workspace:** consume workspace portion of workflow plan ([5b75680](https://github.com/dyphn1/Harness-everything/commit/5b756807eae8b56ebcc2ecc2b312b91e42b84d37))

### Bug Fixes

* **action-gate:** Defer matched commands to Claude Code permission modes ([7628da1](https://github.com/dyphn1/Harness-everything/commit/7628da1cbadd2b5ed2916514e8172b281aaf6e80)), closes [#107](https://github.com/dyphn1/Harness-everything/issues/107)
* **action-gate:** preserve fail-closed runtime semantics ([a959316](https://github.com/dyphn1/Harness-everything/commit/a9593166e1c6210d2c5cafe1b3f688a53b68ca1b))
* **action-gate:** sync shared runtime into plugin ([ed40429](https://github.com/dyphn1/Harness-everything/commit/ed4042973bd79afaaa0e8d1c84c067eb85ef4f3e))
* **behavioral-evals:** Correct the find-skills verdict claimed in PR [#51](https://github.com/dyphn1/Harness-everything/issues/51) ([6afa34f](https://github.com/dyphn1/Harness-everything/commit/6afa34f5f3601c32d7d04a8437ae373a9bcb514a)), closes [#52](https://github.com/dyphn1/Harness-everything/issues/52)
* **behavioral-evals:** Grant claude engine real headless autonomy, correct rubric bugs found live ([90e36c2](https://github.com/dyphn1/Harness-everything/commit/90e36c2071fb5a71e16cdc99b1060cd3d699c43b)), closes [#52](https://github.com/dyphn1/Harness-everything/issues/52) [#52](https://github.com/dyphn1/Harness-everything/issues/52)
* **behavioral-evals:** harden evidence triage ([f7bd8ec](https://github.com/dyphn1/Harness-everything/commit/f7bd8ec8fe6b8f02f55e8b45e45af5e233f4d224)), closes [#56](https://github.com/dyphn1/Harness-everything/issues/56) [#56](https://github.com/dyphn1/Harness-everything/issues/56)
* **behavioral-evals:** Harden evidence triage ([ad45453](https://github.com/dyphn1/Harness-everything/commit/ad45453a8f08d28256ae569735aa2c7125d901e8))
* **behavioral-evals:** Make execution evidence grading command-aware ([aa2235d](https://github.com/dyphn1/Harness-everything/commit/aa2235d49a97764dd6406ce5f12fc057366faa17))
* **behavioral-evals:** parse Claude stream evidence ([77efb06](https://github.com/dyphn1/Harness-everything/commit/77efb06ae91b28d07b60e7833ba96940bae612cb)), closes [#52](https://github.com/dyphn1/Harness-everything/issues/52)
* **behavioral-evals:** parse Claude stream evidence ([f5c3a46](https://github.com/dyphn1/Harness-everything/commit/f5c3a4639b15464017b344b7329c990912480516)), closes [#52](https://github.com/dyphn1/Harness-everything/issues/52)
* **behavioral-evals:** Support --model for the claude engine, correct find-skills-exposure claim ([15e4c7c](https://github.com/dyphn1/Harness-everything/commit/15e4c7c98717dea615052114be9e8033f9e4feb5))
* **boundaries:** Add shared verifier contracts ([c093c50](https://github.com/dyphn1/Harness-everything/commit/c093c50de7cd12260f0fdee3f6e6d4f6a49d2d0b))
* **ci:** Derive the release baseline and gate tag pushes with the full CI suite ([0ec04af](https://github.com/dyphn1/Harness-everything/commit/0ec04af3f4fc100eced3b464c7be919f31a8e969)), closes [#39](https://github.com/dyphn1/Harness-everything/issues/39)
* **ci:** Fetch history for historical evidence tests ([aeeb69f](https://github.com/dyphn1/Harness-everything/commit/aeeb69f43cbec76f1a4d9f8e3e6cd1483bf33664))
* **ci:** Harden issue 20 verification gates ([b482e41](https://github.com/dyphn1/Harness-everything/commit/b482e41a9448efe0504032472b86eeb1f983c6cd))
* **ci:** Make SKILL.md path notation file-relative and fail on unknown placeholders ([543c057](https://github.com/dyphn1/Harness-everything/commit/543c057b676c9e4e98f745b1758b666a6756a95a)), closes [#44](https://github.com/dyphn1/Harness-everything/issues/44)
* **ci:** Publish the workspace skip-list instead of paying tokens to inline it ([cda087c](https://github.com/dyphn1/Harness-everything/commit/cda087cff423763f2e14fd2940cc1331396de313)), closes [#44](https://github.com/dyphn1/Harness-everything/issues/44)
* **ci:** Spend path markers only where the base is not the current file ([8b2a73e](https://github.com/dyphn1/Harness-everything/commit/8b2a73ed3c2a9b83009ab3273c7fa00ccd45645a)), closes [#44](https://github.com/dyphn1/Harness-everything/issues/44)
* **claude-plugin:** avoid duplicate standard hooks registration ([314bcf1](https://github.com/dyphn1/Harness-everything/commit/314bcf1663a24f9eb32fdf342a3b1ed58c2f0006))
* **claude:** anchor plugin hooks to CLAUDE_PLUGIN_ROOT ([6a4462b](https://github.com/dyphn1/Harness-everything/commit/6a4462b85fbc79464da6be0e0e27092a36fa9fa6))
* **claude:** resolve plugin-root hook commands during install ([fdd2dd7](https://github.com/dyphn1/Harness-everything/commit/fdd2dd7cacf07e46699dec582cd734966addea88))
* **claude:** sync installer hook-root resolver into plugin ([308949a](https://github.com/dyphn1/Harness-everything/commit/308949a7840bdc26179c4772dd4fa424b84d8f7e))
* **codex:** align hook lifecycle with supported events ([8f90425](https://github.com/dyphn1/Harness-everything/commit/8f904258d6bf5e46e939facff3d734ad2baf7e63))
* **codex:** canonicalize action-gate post adapter ([82b56af](https://github.com/dyphn1/Harness-everything/commit/82b56af6195d05790573b3e75ffcf16684011d73))
* **codex:** infer action-gate outcome from PostToolUse ([0c79b11](https://github.com/dyphn1/Harness-everything/commit/0c79b110f5af9f311c80bdfaf42e94f26c5c1298))
* **fable:** serialize overlapping staged work without rejecting plan ([33e4c1a](https://github.com/dyphn1/Harness-everything/commit/33e4c1ae9dc5d74ee229c1e2b1758153f25a1f45))
* **find-skills:** Add tested host-agent exposure for ephemeral skills ([#35](https://github.com/dyphn1/Harness-everything/issues/35)) ([11fe847](https://github.com/dyphn1/Harness-everything/commit/11fe847bf6d8a1643b9487106b5519aae87b1e5a))
* **find-skills:** Trim SKILL.md under the 500-token waza hard limit ([5d66c0a](https://github.com/dyphn1/Harness-everything/commit/5d66c0a8a35fd6495b137b5578a511541ad88c30)), closes [#35](https://github.com/dyphn1/Harness-everything/issues/35)
* Harden PR [#66](https://github.com/dyphn1/Harness-everything/issues/66) behavioral evidence triage ([fcf0015](https://github.com/dyphn1/Harness-everything/commit/fcf00157597ed17ead63dcfb68e35c913b21fc2e))
* **hooks:** keep contract correlation session and path safe ([6655d83](https://github.com/dyphn1/Harness-everything/commit/6655d836394acd0e83145e35f1f20f3bd33e17aa))
* **hooks:** treat pending stage contracts as active ([ec6c265](https://github.com/dyphn1/Harness-everything/commit/ec6c2653afc97dd48ff2f9b8051d4ef57a28e03b))
* **installer:** discover native Continue and Hermes manifests ([d836760](https://github.com/dyphn1/Harness-everything/commit/d836760179e09cd08ec5aa206e439624d68d1973))
* **installer:** fail closed on malformed Claude settings ([fdec691](https://github.com/dyphn1/Harness-everything/commit/fdec691ef682ca0c4c28a4490d1be8b539ffbe9f))
* **installer:** Honor explicit uninstall scope flags over the interactive menu ([9f791d9](https://github.com/dyphn1/Harness-everything/commit/9f791d9ac39fa20a24e82ee996e71312f187b437)), closes [#48](https://github.com/dyphn1/Harness-everything/issues/48) [#49](https://github.com/dyphn1/Harness-everything/issues/49)
* **installer:** preserve pre-existing advisory files ([0299db0](https://github.com/dyphn1/Harness-everything/commit/0299db0724a789b83d8c5f3ed8b4d1a32bf68f14))
* **installer:** protect global Codex prompt ownership ([db67ac6](https://github.com/dyphn1/Harness-everything/commit/db67ac697e9f4d5beb50280f9db96f7114b99829))
* **installer:** protect global Copilot prompt ownership ([5f36651](https://github.com/dyphn1/Harness-everything/commit/5f36651d80550acea4a5d2a7c5bb532dece89e4a))
* **installer:** track Hermes global install ownership ([6967a3e](https://github.com/dyphn1/Harness-everything/commit/6967a3e33f0d2506192a16a5b705a0b04a774663))
* **installer:** use Codex native project skills path ([b4a372c](https://github.com/dyphn1/Harness-everything/commit/b4a372c6d9749c9ebd22b379bd45ce61358fffc6))
* **installer:** use Continue native global skills path ([cb0202c](https://github.com/dyphn1/Harness-everything/commit/cb0202cc518facf3836af1e377b58c10320fc6fb))
* **installer:** use Hermes native skill scopes ([d7c8275](https://github.com/dyphn1/Harness-everything/commit/d7c8275db04e71c5e6cf6b12e7b474da2fc8ecd9))
* **multi-agent-workspace:** Harden document resolution and migration ([6361f96](https://github.com/dyphn1/Harness-everything/commit/6361f96bec03741ea4a743f7284e0fdc7febeaa0)), closes [#43](https://github.com/dyphn1/Harness-everything/issues/43) [#43](https://github.com/dyphn1/Harness-everything/issues/43)
* **opencode-plugin:** Declare all five hooks and gate them in CI ([30e2e6d](https://github.com/dyphn1/Harness-everything/commit/30e2e6d6e868323d9b5af9a8cf8cb7015515879e)), closes [#37](https://github.com/dyphn1/Harness-everything/issues/37) [#20](https://github.com/dyphn1/Harness-everything/issues/20)
* **opencode-plugin:** Port enforcement plugin to opencode's real plugin API ([4ae960c](https://github.com/dyphn1/Harness-everything/commit/4ae960c15e582a7c4b23e41471d875120da8dcd6)), closes [#37](https://github.com/dyphn1/Harness-everything/issues/37) [#37](https://github.com/dyphn1/Harness-everything/issues/37)
* **opencode:** enforce reflection lifecycle ([d790e7f](https://github.com/dyphn1/Harness-everything/commit/d790e7f71d9738cea28d8d623e9c2cf857dd2793)), closes [#37](https://github.com/dyphn1/Harness-everything/issues/37)
* **opencode:** enforce reflection lifecycle ([74ffed3](https://github.com/dyphn1/Harness-everything/commit/74ffed3513aa7e9b51251a44d7c2a39298a990d1)), closes [#37](https://github.com/dyphn1/Harness-everything/issues/37)
* **opencode:** Harden reflection enforcement ([8989ab4](https://github.com/dyphn1/Harness-everything/commit/8989ab4c81ad8887359c8428eb8c3e3b5d7cc458))
* Parse top-level tool events in behavioral transcripts ([31fe8e1](https://github.com/dyphn1/Harness-everything/commit/31fe8e1cb6b193d21079dcc2c64edb712b40ac6d))
* **plugin:** align public long description with submission listing ([ab2e283](https://github.com/dyphn1/Harness-everything/commit/ab2e283424c34328f57b0373e9bc7ebab894f96a))
* **plugin:** match plugin.json manifest schema for repository and agents ([ab770ad](https://github.com/dyphn1/Harness-everything/commit/ab770ad1e9ec5489e83dbd06228fc10bd875806a)), closes [#86](https://github.com/dyphn1/Harness-everything/issues/86)
* **plugin:** Point agents at individual .md files, not a directory ([10e7512](https://github.com/dyphn1/Harness-everything/commit/10e75129ee5b19ee5c5d8872ee73195cc6c4109d))
* **release:** initialize conventional commits preset ([a0dbbf9](https://github.com/dyphn1/Harness-everything/commit/a0dbbf96f87a79de6674c95c7b99dd549d62809b))
* **release:** keep release commit compatible with commitlint ([#116](https://github.com/dyphn1/Harness-everything/issues/116)) ([27b1595](https://github.com/dyphn1/Harness-everything/commit/27b1595aef715aa696a67eaa58fc1367f0f3eba4)), closes [#115](https://github.com/dyphn1/Harness-everything/issues/115)
* **release:** make version rules explicit ([469a4ed](https://github.com/dyphn1/Harness-everything/commit/469a4edc3e2402cfd124c7764cc1b41e3387b319))
* **release:** remove beta from active skill metadata ([df2201c](https://github.com/dyphn1/Harness-everything/commit/df2201cd6508335d44fb5b14c0879808016ac742))
* **release:** use compatible changelog preset for [#113](https://github.com/dyphn1/Harness-everything/issues/113) ([9a181cf](https://github.com/dyphn1/Harness-everything/commit/9a181cf607797cd35a84a7b0e540387feda2f196))
* **release:** version changed skills during release ([333bb33](https://github.com/dyphn1/Harness-everything/commit/333bb33ceacbd5bc20be546d751bd98468e74db9))
* **release:** version only skills changed since last release ([6c74155](https://github.com/dyphn1/Harness-everything/commit/6c741557150c9156a0b31ed5713353f5a15ed21e))
* **router:** preserve invariant-first human-readable contract ([5a9baf0](https://github.com/dyphn1/Harness-everything/commit/5a9baf02e906c29e027affc9b735366526b54c3e))
* **router:** serialize unsafe explicit parallel requests ([fd02c97](https://github.com/dyphn1/Harness-everything/commit/fd02c977607b7400d9a61cbdc6648b79770a5a0b))
* **self-evolve:** Stop gating simple-rule persistence on the meta-repo's own CI ([4ab1bd8](https://github.com/dyphn1/Harness-everything/commit/4ab1bd88e11f55194e25f6bb636b164a57794eea)), closes [#54](https://github.com/dyphn1/Harness-everything/issues/54) [#52](https://github.com/dyphn1/Harness-everything/issues/52)
* **self-heal:** Identify the harness repo by package name, not source path ([f7ad891](https://github.com/dyphn1/Harness-everything/commit/f7ad891940cfa18b951d41ea3bcac80a98972e9c)), closes [#40](https://github.com/dyphn1/Harness-everything/issues/40)
* **skill-creator:** Require USE FOR/DO NOT USE FOR in the Quality Checklist ([68d9923](https://github.com/dyphn1/Harness-everything/commit/68d992350001d97fd3258a37dcc1e0d894a86c0b)), closes [#55](https://github.com/dyphn1/Harness-everything/issues/55)
* **skill:** Keep workspace contract within token budget ([7cd7956](https://github.com/dyphn1/Harness-everything/commit/7cd7956146be01221bc5e6b8bbf0d2fe21b027a0))
* **skill:** Keep workspace contract within token budget ([d360b8c](https://github.com/dyphn1/Harness-everything/commit/d360b8c70d89eaca8687821f616fe3cd9007f5ba))
* **skills:** Close Issue [#44](https://github.com/dyphn1/Harness-everything/issues/44) disclosure and path normalization defects ([27cb486](https://github.com/dyphn1/Harness-everything/commit/27cb486d0b7fbb0148df711bcfa8a1d6a355077d))
* **skills:** Trim SKILL.md bodies to fit waza's real 500-token budget ([3eeadf5](https://github.com/dyphn1/Harness-everything/commit/3eeadf5cf49ae4b00967a7901e6e157a2256ce20))
* **state:** Converge Claude/opencode runtime state onto a single global root ([ee348cd](https://github.com/dyphn1/Harness-everything/commit/ee348cdab972e2cfe08ec3277f1a89e86ecb2a74)), closes [#42](https://github.com/dyphn1/Harness-everything/issues/42)
* **state:** Fix zero-walk and cwd-default scatter in fable-mode and multi-agent-workspace ([6ac579e](https://github.com/dyphn1/Harness-everything/commit/6ac579e95632e9119a81260d4965974118c199be)), closes [#42](https://github.com/dyphn1/Harness-everything/issues/42)
* **state:** Harden workspace identity and migration ([0f3149d](https://github.com/dyphn1/Harness-everything/commit/0f3149da848b931d0c575311396b7f747122f452)), closes [#42](https://github.com/dyphn1/Harness-everything/issues/42)
* **state:** stabilize workspace identity and migration ([9dd2e3d](https://github.com/dyphn1/Harness-everything/commit/9dd2e3df3c4bfe91d8651c8344f568842687fbc1))
* **state:** stabilize workspace identity and migration ([d28a055](https://github.com/dyphn1/Harness-everything/commit/d28a055c1822a35ecc0ee96e7f578d8cb1363e96))
* **test:** close Codex Stop hook assertion ([ac1a8b6](https://github.com/dyphn1/Harness-everything/commit/ac1a8b600abc399cfa217e63a9c22ea8f08df362))
* **uninstall:** normalize global skill scope protection ([ab7ae46](https://github.com/dyphn1/Harness-everything/commit/ab7ae460a2cbf3abcf7f0da35436883d72fd0856))
* **uninstall:** remove orphaned Harness reference artifacts ([0a4d5b2](https://github.com/dyphn1/Harness-everything/commit/0a4d5b2caf0883f48aa3a22cdb97ade1f2d59823))
* **verifier:** export normalizeRepoPath for behavioral runner ([3e7b580](https://github.com/dyphn1/Harness-everything/commit/3e7b58024e9bef78299349e75f35f0c7cee37ea8))
* **verifier:** Harden consumer boundaries and mutation gates ([ef010ba](https://github.com/dyphn1/Harness-everything/commit/ef010bae835dcef736231ff07f9f09e0a6a886e8))
* **workspace:** keep skill contract compact and references explicit ([cce02bc](https://github.com/dyphn1/Harness-everything/commit/cce02bc4a1273428eae4dad586ab0a42eda2b2a7))
* **workspace:** preserve state mutation contract wording ([4cc11be](https://github.com/dyphn1/Harness-everything/commit/4cc11be2b8d94c7388320af4421e568ca51857d2))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Changed
- **Action gate defers to Claude Code permission modes** (#107): on Claude Code, a matched destructive command no longer returns a forced `permissionDecision: "ask"`, which prompted even in auto mode. The gate returns no decision, so the session's permission mode, rules and auto-mode classifier decide. It still records the matched rule and the command SHA-256 (`deferred-to-host`, then `executed` or `rejected`). An internal error on Claude also defers and shows a `systemMessage` warning. `HARNESS_ACTION_GATE_POLICY=always-ask` restores the forced prompt. Hosts without an ask decision keep the exit-2 block.

## [0.3.7-beta] - Unreleased

### Changed
- Prepare the next beta for the reviewed open-issue implementations (#20, #37, #42, #43, #44, #52, #56, #74, #75, #78, #82). Individual changes and verification evidence are recorded as they are integrated.

---

### Added
- **Portable Agent Plugin compatibility and platform matrix** (#75, #82): added the portable root `plugin.json`, official-source compatibility data for standalone skills versus plugins across eight agent platforms, explicit installer-target contracts, conservative status vocabulary, and deterministic gates that keep package/mechanism evidence separate from live-host evidence.
- **OpenAI/Codex lifecycle runtime compatibility** (#72): extended the local `.codex-plugin` package from session/prompt hooks to mechanism-tested `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`, and `Stop` adapters, including portable state dependencies and `apply_patch` edit tracking. Package synchronization now normalizes text EOLs for reproducible Windows/Unix output.
- **OpenAI/Codex plugin packaging and public Skills-only submission** (#74): added the repository marketplace (`.agents/plugins/marketplace.json`), local `.codex-plugin` package, synchronized copies of all 26 canonical skills, local `SessionStart` / `UserPromptSubmit` invariant hooks, OpenAI package/submission tests, deterministic Skills-only ZIP generation, and reviewer listing/test-case inputs. The local plugin mechanism boundary is explicitly separate from the public Skills-only artifact, which does not include the local lifecycle hooks.
- **Progressive disclosure and explicit skill paths** (#44): require short routed skill contracts, lazy-loaded workflow/reference detail, meaningful Mermaid coverage, and explicit `<this-skill-dir>/`, `<skills-repo-root>/`, or `<workspace>/` path bases.
- **Behavioral-eval evidence triage** (`behavioral-evals/`, #56): added structural case validation, ordered execution-evidence grading, sanitized historical archives with current-versus-historical hashes, and paired-rerun status tracking for old failures and never-run cases.
- **Shared verifier boundary contracts** (`scripts/lib/path-boundary.js`, `scripts/lib/execution-contract.js`): physical containment checks reject traversal and junction/symlink aliases, while execution evidence uses exact command/argv matching and all-or-nothing patch authorization. Deterministic mechanism coverage protects the contract for downstream verifier, workspace, installer, and plugin fixes.
- **Machine-verifiable TDD scoring gate** (`tdd/`, #58): the TDD skill routes behavior through a Mermaid path to separate unit or integration standards. Added profile-tagged source evidence, published canonical weights and calculation inputs, per-requirement and aggregate scores, mandatory PASS/FAIL gates, strict integration rerun comparison, auditable skip/N/A handling, and separate `NON_CONFORMANT`, `SOURCE_DEFECT`, and `SOURCE_CONFLICT` outcomes. `npm run tdd:quality -- <evidence.json> --output <report.json>` is the agent self-check; CI fixtures lock exact Unit and Integration scores plus malformed, incomplete, conflicting, skipped, and nondeterministic failures.
- **`--model` support for the `claude` engine in `behavioral-evals/run.js`**: `BEHAVIORAL_MODEL` now also passes `--model <value>` to the `claude -p` invocation (previously only the `opencode` engine read it). Lets a live run target a specific model, e.g. `BEHAVIORAL_MODEL=haiku node behavioral-evals/run.js run --case <id> --arm both`.
- **Full behavioral-eval skill coverage** (`behavioral-evals/cases/`, #34): added a fixture-bound baseline case for each of the 14 root skills that previously had only routing-precision coverage (`environment-detection`, `eval-harness`, `fable-discipline`, `find-skills`, `install-cognitive-os`, `multi-agent-workspace`, `rewrite-commits`, `self-evolve`, `skill-creator`, `skill-style`, `todo-driven-workflow`, `to-spec`, `to-tickets`, `using-git-worktrees`). `npm run eval:behavioral:validate` now covers all 26 shipped root skills instead of 12/26; `npm run eval:behavioral run` remains on-demand/token-costing, never CI. Live-verified on Haiku (`--engine claude`, see the harness-bug fix below) after two correction rounds: 5 EFFECTIVE (`eval-harness`, `skill-style`, `using-git-worktrees`, `to-tickets`, `to-spec`), 2 legitimate INCONCLUSIVE (`install-cognitive-os`, `fable-discipline`), 2 genuine INEFFECTIVE findings not rubric bugs (`self-evolve` treatment never wrote anything; `skill-creator` treatment wrote the Skill Contract table but omitted the required `USE FOR` section), and 5 still open (`environment-detection`, `todo-driven-workflow`, `multi-agent-workspace`, `rewrite-commits`, `find-skills` - blocked on #52 and/or an unverified prompt/turn-budget edit made after the last live run; see each case file's own note). Post-merge correction (2026-09-04): `find-skills` was briefly reported EFFECTIVE from a pre-permission-fix run where a denied tool call's permission-request text happened to mention the search command; re-run after the fix shows the skill actually works (a real search, presented correctly, never auto-applied) but #52 hides that from the grader - moved to the open/blocked list.

### Fixed
- **Verifier consumer boundary repair** (`behavioral-evals/`, `multi-agent-workspace/`, `opencode-plugin/`, `scripts/installer.js`): reject historical refs that cannot resolve, protect archive and legacy migration writes from junction/symlink aliases, require exact command evidence and atomic reflection patches, reject fixture traversal, and make global installation work outside a git checkout. Added a focused mutation gate so these protections are required by executable tests.
- **Issue #20 deterministic gate hardening**: behavioral case parsing now preserves block scalars from CRLF files, malformed skill YAML fails closed in collision detection, negative controls execute the real gates against bad fixtures, the opencode plugin runner's validation path works, and local routing checks gracefully skip when waza is unavailable. Live opencode loading and paid behavioral evidence remain explicitly unverified.
- **Claude behavioral-eval transcript measurement** (`behavioral-evals/run.js`, `behavioral-evals/transcript-parser.js`, #52): switched headless Claude runs to verbose `stream-json`, preserved legacy JSON parsing with unavailable tool visibility, and added structured tool-attempt/completion/denial evidence with fail-closed grading for partial or unrecognized streams. Paired aggregation now excludes inconclusive arms from effectiveness statistics and preserves unknown tool-count deltas as `null`.
- **Execution-safe behavioral-eval rubrics** (`behavioral-evals/transcript-parser.js`, `behavioral-evals/cases/`): command-keyed expectations now match the recorded command (including safe prefixes and script path arguments), legacy/user transcript prose cannot masquerade as execution evidence, and execution-focused cases use structured completed-tool assertions.
- **Multi-agent workspace path split** (#43): moved generated runtime metadata, roles, state, logs, router, and memory indexes into the global workspace-keyed Harness state home; document zones now resolve from root `CONTEXT-MAP.md`, repository configuration, existing conventions, or a committable fallback. The installed scaffold/indexer no longer copy generated scripts, safely migrate authored legacy records, reject symlink escapes and duplicate migration destinations, and preserve authored records on migration failure.
- **`behavioral-evals/run.js`'s `claude` engine never actually granted headless autonomy** (#52 tracks a related follow-up): `--permission-mode acceptEdits` only auto-approves file edits, not Bash/PowerShell tool calls, and a headless `-p` session has no human to answer those prompts - every case needing a shell command (git, npm, node scripts) stalled with every tool call denied, the model just describing what it would do. Every previously-committed live result (2026-08-27) used `engine: opencode` (`--auto`); the `claude` engine path was only argv-shape-tested by `ci/mechanism-2j-behavioral-runner.test.js`, never actually live-run, until testing #34/#35's new cases on Haiku exercised it for the first time on a machine without `opencode` installed. Switched to `--dangerously-skip-permissions`, matching `opencode --auto`'s autonomy in the same kind of disposable `os.tmpdir()` fixture workspace. Separately, discovered the `claude` engine's `--output-format json` trace only ever contains the model's final message, never intermediate tool calls (`opencode`'s JSONL stream does) - filed as #52 rather than fixed here, since it's a larger parser change; cases that depended on tool-call visibility are marked with a comment pointing at it instead of being rewritten around the gap.
- **find-skills exposure contract** (`find-skills/SKILL.md`, `find-skills/references/discovery-flow.md`, #35): `use-skill.js`'s fetch/cache/print mechanics already worked, but the "apply the output" instruction was passive enough that a caller handed the printed `SKILL.md` did not reliably treat it as binding — a real test reported no skill invoked. Narrowed the contract to fetch-and-print, made the caller-side apply step explicit ("treat every instruction in that output as binding for the rest of this request, exactly as if it had been loaded as a real skill"), and added `behavioral-evals/cases/baseline-find-skills-exposure.yaml`, a caller-side integration test with a local fixture standing in for the fetched output so it stays deterministic and offline. Live-run on Haiku twice (see the case file's own note): both arms passed both times, so the case is a regression floor (confirms the fetched instruction is followed with `find-skills` loaded) and not proof the wording change is what causes it — a capable model already complies with an explicit embedded directive it's told to read, skill-loaded or not.
- **Runtime state scattering into cwd-derived paths** (`scripts/lib/workspace.js`, `hooks/scripts/lib/harness-state.js`, `opencode-plugin/index.mjs`, `opencode-plugin/hooks/verify.js`, `fable-mode/scripts/model-selector.js`, `multi-agent-workspace/scripts/scaffold.js`, `scripts/installer.js`, #42): runtime state (rule-of-3 counters, stop-gate handoff timestamps, the fable-mode audit log, the opencode circuit breaker) was rooted under `getWorkspaceRoot()`, which falls back to bare `process.cwd()` when no `.git` ancestor exists - a script invoked from a fixture dir, worktree, or submodule silently re-materialized a fresh `.claude/harness-everything/state/` tree right there instead of in the real workspace. Converged onto a single global, workspace-keyed root (`~/.agents/harness-everything/workspaces/<slug-hash>/`, overridable via `HARNESS_STATE_HOME`), with one-time migration of any state a pre-fix install already scattered. The opencode plugin's own state was worse pre-fix (one flat `~/.harness-state` shared by every project on the machine - a circuit-breaker trip in one project hard-locked all the others); it now keys per workspace too. `fable-mode/scripts/model-selector.js` had zero workspace-root walk at all (the worst case in the issue's inventory) and now has one. Left alone, deliberately: five skill-owned CLI scripts (`persist-memory.js`, `register-dynamic-skill.js`, `audit-secrets.js`, `check-project-docs.js`, `evaluate.js`) that ship standalone into every install target and can't depend on the source repo's `scripts/lib/workspace.js` - their write targets are project artifacts by design, not ephemeral state. `ci/mechanism-2o-state-home-isolation.test.js` covers the issue's own repro plus the migration path.
- **Issue #42 adversarial corrections** (`scripts/lib/workspace.js`, `multi-agent-workspace/scripts/scaffold.js`, the standalone project writers, `find-skills/scripts/use-skill.js`, `opencode-plugin/index.mjs`, #42): no-context calls now use a stable unbound global bucket instead of cwd-derived identity, Windows case variants hash identically, non-git invocations refuse project writes, `.harness/multi-agent` and flat opencode state migrate even when destinations already exist, and find-skills uses the unified state home. `ci/mechanism-2u-issue-42-regressions.test.js` proves each regression against isolated fixtures.
- **Session-stable workspace identity and recoverable migration** (`scripts/lib/workspace.js`, `hooks/scripts/lib/harness-state.js`, `fable-mode/scripts/model-selector.js`, #42): hook payloads now bind a host/session identity to the first trusted workspace context so later cwd changes, nested repositories, symlink paths, and hostless follow-ups do not silently fork runtime state. Legacy platform trees are merged without overwriting newer destination files; conflicts and unsupported entries remain available for a later retry, while independent platform sources continue migrating. `ci/mechanism-2t-workspace-identity.test.js` covers host/session binding, cwd changes, conflicts, symlinks, and retry.
- **Self-repo detection** (`scripts/lib/workspace.js`): bootstrap and self-heal now identify the harness repo by `package.json` name instead of comparing against the running script's own directory, so an npx or global install no longer reports the harness checkout as drifted and recommends a repair that self-heal refuses to run. The audit also distinguishes an absent integration file from one that exists without the Harness advisory block.
- **opencode plugin, ported to the real API** (`opencode-plugin/index.mjs`, #37): the previous `plugin.json` manifest mapping `postEdit`/`preComplete` to standalone scripts was never invoked by opencode - it has no manifest-to-script mechanism and no such events. Replaced with a single ESM module exporting `tool.execute.before` (circuit-breaker hard lock), `tool.execute.after` (edit tracking) and `event` (verification gate on `session.idle`, which pushes a follow-up message via `client.session.prompt()` on failure since the event can't be blocked directly) - all three verified against opencode's plugin source. Reflection now has a tokenized report artifact lifecycle: code edits are blocked while pending, report writes are accepted through the real `(input, output)` hook arguments, read tools remain available, and repeated idle or failed prompt delivery are idempotent and retry-safe. State is isolated by workspace and session, unsafe IDs cannot escape reset containment, and the module contract and installation are documented. `ci/mechanism-2n-opencode-plugin.test.js` covers the full lifecycle, session isolation, reset safety, and hard-lock enforcement. Not yet verified: a live opencode session actually loading and firing the plugin (opencode requires Bun, not installable in this repo's environment).
- **opencode reflection enforcement hardening** (`opencode-plugin/index.mjs`, #37): reflection directives are now scoped to the `## Decision` section, corrupt breaker state fails closed, and `apply_patch` marker paths are recognized from `output.args.patchText`. The mechanism test covers each regression and restores repository-inventory parity for the remaining standalone helper.
- **Release baseline** (`ci/release-consistency-check.js`): the comparison tag is derived from the latest tag (or `--tag` / `HARNESS_RELEASE_TAG`) instead of being pinned to `v0.3.3-beta`, which had been three releases stale while still reporting PASSED.

### Changed
- **Release gate** (`.github/workflows/release.yml`): a tag push now runs the same job set as a pull request - including `test:references`, `test:release`, the waza skill-quality gate, and the windows matrix - instead of a weaker ubuntu-only subset.
- **Changelog/tag consistency** (`ci/consistency-check.js`): every released changelog heading must have a matching git tag; versions that were never tagged must say so in the heading.

### Documentation
- **Platform capability documentation consistency** (#78): centralized current enforcement/install/evidence claims in `docs/platform-capabilities.md`, aligned README/architecture/verification/mechanism/troubleshooting/audit/benchmark/agent/OpenCode documentation, and added `test:docs:capabilities` as a deterministic drift gate chained into `test:consistency` on Linux and Windows CI.
- **opencode plugin status** (`README.md`, `opencode-plugin/README.md`): updated to describe the real `index.mjs` plugin and its installation (drop into `.opencode/plugins/`, no `opencode.json` entry needed). opencode is now listed alongside Claude Code as a hard-enforcement platform, flagged as unverified in a live session pending #37's remaining step.

---

## [0.3.6] - 2026-09-01

### Added
- **Unified multi-agent workspace**: Merged launcher and workspace scaffolding into the routed `multi-agent-workspace` skill with six zones, an immutable router, a local memory indexer, selected-role launcher, and structured handoff manifest.
- **agency-agents catalog integration**: Added read-only source discovery with division metadata, specialist selection, frontmatter validation, duplicate-name/slug checks, source-revision drift protection, supported-platform validation, and explicit missing-source fallback.
- **Fresh-workspace integration coverage**: Added fixture tests for fallback, real catalog selection, idempotence, malformed catalog paths, drift, and unsupported platforms.

### Changed
- **Routing and distribution**: Replaced the two overlapping routed skills with one canonical skill, retained historical release mappings and canonical migration guidance, updated plugin/marketplace manifests, docs, and routing eval coverage.
- **Strict catalog audit**: Removed obsolete compatibility directories and stale workflow, added the missing `find-skills` workflow, aligned all 26 skill contracts/eval descriptions, and added deterministic 34-case route coverage.
- **Documentation alignment**: Corrected README/registry layer labels, per-session state paths, and unimplemented workflow claims; waza remains an explicit CI gate when unavailable locally.
- **Waza readiness**: Compressed five skill contracts below the CI token budget while retaining their routing, workflow, and enforcement semantics.
- **Self-evolve boundary**: Clarified that the host agent supplies authorized session evidence and root-cause analysis; self-evolve validates and persists the lesson without scanning host transcripts.
- **Release history cleanup**: Reworded historical entries at the capability level so the changelog does not route agents toward retired skill names.
- **Provenance**: Recorded the local agency-agents snapshot (18 divisions, 258 agents, 14 converter targets) and preserved the upstream MIT attribution without vendoring agent bodies.

---

## [0.3.5-beta] - 2026-09-01 (unreleased - never tagged; shipped in 0.3.6)

### Added
- **Fable v3 model modes**: Added explicit Haiku, Sonnet, and Opus entrypoints, named agent distribution, a deterministic model matrix/selector, required stage audit records, and visible inline fallback or blocked escalation behavior.
- **Fable routing and contract coverage**: Added positive/negative mode routing evals and deterministic selector tests for model availability, alias normalization, audit persistence, and unsupported-runtime handling.

### Changed
- **Native workflow tracking**: Removed the repository TODO CLI and its legacy behavioral test; active workflow guidance now uses the host TODO tracker or Markdown checklists.
- **Harness distribution and documentation**: Updated plugin manifests, version metadata, routing guides, audit notes, and workflow references for the Fable v3 integration.

---

## [0.3.4-beta] - 2026-08-23 (unreleased - never tagged; shipped in 0.3.6)

### Added
- **A/B Eval Harness** (`eval-framework/ab-test-harness.js`): automated with/without skill comparison to prove method effectiveness. Takes a skill + test prompt, spawns baseline (no skill) and treatment (with skill) agent sessions, grades both against a rubric, and produces a verdict (EFFECTIVE / INCONCLUSIVE / INEFFECTIVE / HARMFUL). Run `npm run test:ab` (validate, free) or `npm run test:ab:run` (costs tokens). First run on gpt-5-mini: 4/4 INCONCLUSIVE — model already performs tested behaviors by default. Results in `benchmarks/ab-test-<date>/`.
- **Word-Count Budget Check** (`consistency-check.js` section 5d): flags SKILL.md files exceeding 330 words (~500 tokens at 1.55 tokens/word). Catches token-budget violations before waza runs.
- **Installer E2E CI Job** (`.github/workflows/ci.yml`): tests `node bin/cli.js install --all -y` on a fresh temp directory on both ubuntu-latest and windows-latest.
- **CRLF frontmatter regression test** (`eval-framework/mechanism-2i-crlf-frontmatter.test.js`): copies the repo to a temp dir, converts every SKILL.md to CRLF, asserts consistency and collision gates both pass — plus a negative control that plants a duplicate description under CRLF and asserts the collision check detects it (protects against the pre-fix silent no-op failure mode). Auto-discovered by `mechanism-test.js`; runs as part of `npm test`.
- **Plugin Distribution (`.claude-plugin/`)**: Added `plugin.json` and `marketplace.json` so Harness installs as a Claude Code plugin (`/plugin marketplace add dyphn1/Harness-everything`) with the full skill catalog, hooks, and version pinning — previously only `npx github:` was supported.
- **Benchmark Evidence Infrastructure (`benchmarks/`)**: BENCHMARK_SOP.md scenarios are now executable: `benchmarks/run.js scaffold <scenario>` builds fixture workspaces (Test A–F) and prints the exact prompt; `record` commits schema-validated results (`schema.json`) bound by content hash to exported session logs ("no log, no result"); `status` prints a coverage matrix that openly reports empty cells instead of implying evidence exists.
- **Behavioral Eval Framework (`behavioral-evals/`)**: LLM-behavior-level evaluation via headless `claude -p` in throwaway workspaces with Harness fully installed. Six cases covering tier routing, circuit-breaker zoom-out, verify-before-claim, and scope discipline — including two pressure variants (deadline pressure to skip verification; sunk-cost pressure to blind-retry). Grader verdicts are auditable from recorded transcripts. Token-costing by design; never wired into CI.
- **Full Routing-Eval Coverage**: Added trigger/routing evals for all remaining 22 skills (`evals/<skill>/eval.yaml` + positive/negative tasks), bringing catalog coverage from 5/27 to 27/27.
- **Benchmark Evidence (Test A–F)**: First recorded A/B runs of all six BENCHMARK_SOP scenarios (vanilla vs Harness, opencode + gpt-5-mini, evidence logs hash-bound to records). Results: 5/6 harness cells pass; Test C (Tier 3 attention loss) graded partial — discover-first and grill-before-edit held but fable-mode milestone orchestration did not trigger. Circuit breaker (Test B) unexercised: no 3-failure loop occurred in either variant.
- **Description Collision Detection** (`eval-framework/description-collision.js`): Pairwise stemmed-Jaccard similarity over skill descriptions; fails at ≥0.75 overlap where the router cannot distinguish two skills. Guards against description drift as the catalog grows.
- **Consistency Check** (`eval-framework/consistency-check.js`): Validates SKILL.md frontmatter names match directories, both trigger sections exist, `.claude-plugin/*` manifests list exactly the on-disk skills, versions agree across package.json/plugin.json/marketplace.json, every skill has a routing eval, and every local link in README/docs resolves. A stale manifest is a router that lies.

### Changed
- **Evidence and install integrity**: Added a 12-case tier-routing matrix, hard skill-reference and release-catalog checks, paired randomized A/B metadata, explicit pressure categories, and `harness verify-install` tree/version verification. The behavioral runner now has a true no-Harness control arm and passes Windows prompts as one argv value.
- **Task tracking**: Removed the redundant `todo-cli.js` state machine and its simulation test. `todo-driven-workflow` now uses the host agent's native TODO tracker or a workspace Markdown checklist.

### Fixed
- **Token Budget Violation**: `fable-mode/execution-guardrails/SKILL.md` trimmed from 335 to 187 words (removed redundant Skill Contract table, compressed USE FOR sections). Now passes the new word-count gate.
- **CRLF-hostile frontmatter parsing**: the frontmatter regex in `eval-framework/consistency-check.js` (4 call sites: skill discovery, version-ceiling gate, nested sub-skill parent/child checks) and `eval-framework/description-collision.js` hardcoded `\n`, so any workspace with CRLF line endings (e.g. a Windows clone with `core.autocrlf=true`) reported 83 spurious consistency failures — and, worse, the collision check silently degraded to comparing 27 empty descriptions and passed as a no-op. All five sites now tolerate `\r?\n`; a new `.gitattributes` pins LF for fresh clones; and the CI `consistency` job now runs on both ubuntu-latest and windows-latest instead of ubuntu-only.
- **Corrupt AGENTS.md**: Root AGENTS.md contained only a dangling `description: "` fragment; rewritten as a full operating guide (layout, change rules, quality gates, version policy).
- **Skill Version Drift**: All skills modified after the 0.3.3-beta release now carry frontmatter version 0.3.4 (two were stale at 0.2.0); package/plugin/marketplace realigned from 0.4.0-beta to 0.3.4-beta so no version exceeds the release base.
- **Nested Sub-Skill Version Lockstep**: `fable-mode/fable-haiku` (stale at 0.3.3) and `fable-mode/execution-guardrails` (no version) now carry version 0.3.4. consistency check discovers nested `<skill>/<sub>/SKILL.md` files and requires them to match their parent skill's version; AGENTS.md rule 4 amended to codify that nested sub-skills inherit the parent version.

### Added
- **Version Ceiling Gate**: consistency check now parses every skill's metadata.version and fails if it is missing, unparseable, or numerically above the package.json version base.

### Changed
- **Legacy multi-agent description correction**: Removed claims that the legacy multi-agent scaffolding shipped runtime components; the memory indexer is generated by the agent at runtime, not distributed. Reworded the skill, authoring guidance, workflow, and routing eval to match the actual capability. No version bump: 0.3.4-beta was unreleased, so these edits landed under its heading.
- **CHANGELOG ordering repair**: the `[0.2.0-beta]` and `[0.2.0-alpha]` sections (dated 2026-07-22) sat below `[0.1.0-*]`; moved to their reverse-chronological position after `[0.2.0]`. Recorded governance exception to rule 6 (append-only): section content is unaltered; only placement changed.
- **CI**: New `consistency` job running manifest/doc-link/eval-coverage checks and collision detection on every push.
- **Version Alignment**: package.json, plugin.json, and marketplace.json now share one version string, enforced by the consistency check.

---
## [0.3.3-beta] - 2026-08-13

### Added
- **Cognitive OS Enhancements**: Implemented zero-trust evidence-driven context in `to-spec` and `to-tickets` and added comprehensive documentation.
- **Reference Checklists**: Added `security-checklist.md`, `performance-checklist.md`, and `definition-of-done.md` to the `references/` directory.
- **Mandatory Design Audit**: Enforced mandatory design audit verification step in specification skills.

### Fixed
- **Installer `--skill` flag**: Fixed `--skill` flag argument parsing in the installer script and ensured the `references` directory is copied when installing skills.

### Changed
- **Fable Mode & Specs**: Updated `fable-mode`, `to-spec`, and `to-tickets` skills to integrate the cognitive OS enhancements.

---
## [0.3.3-alpha] - 2026-08-13

### Added
- **CLI Commands (`harness next` & `harness verify`)**: Added `harness next "<prompt>"` and `harness verify` subcommands to `bin/cli.js` as thin wrappers around `tier-router.js` and `verify-gate.js`, enabling `npx github:dyphn1/Harness-everything next/verify` across all platforms (`7625a2f`).
- **Expressive CLI `--help` Interfaces**: Added CLI `--help`/`-h` options to agent-facing scripts (`todo-cli.js`, `persist-memory.js`, `register-dynamic-skill.js`, `check-project-docs.js`, and `evaluate.js`) to expose parameter schemas directly from code logic (`f1f4f11`).
- **OWASP & STRIDE Guides in Security Review**: Added OWASP patterns, STRIDE threat model guides, and `audit-secrets` script to `security-review` (`5df5844`).
- **Report Template Files**: Extracted report structures into dedicated template files for `zoom-out` (`zoom-out/templates/zoom-out-report.template.md`) and `verification-loop` (`verification-loop/templates/verification-report.template.md`) (`8b6724e`).
- **Git Worktree Concurrency Guidance**: Added Git Worktree concurrency isolation rules and cross-platform compatibility guidelines to `todo-driven-workflow` (`c3df2b3`, `c031aa1`).

### Fixed
- **Hookless Platform Routing Paths**: Fixed dead path issue in advisory text by updating hookless platforms (Codex, Cursor, Copilot, Continue, Hermes) to use `npx github:dyphn1/Harness-everything next/verify` (`7625a2f`).
- **Orchestrator Discoverability**: Surfaced `fable-orchestrator` as a discoverable sub-skill in `fable-mode/SKILL.md` and tier-router logic (`4ea61eb`).
- **Cross-Platform & Windows Compatibility**:
  - `find-skills`: Fixed Windows execution by invoking `npx.cmd` and enabling shell execution option (`2b678d6`).
  - `environment-detection`: Resolved Git Bash shell misidentification on Windows (`97c2f48`).
  - `rewrite-commits`: Prevented terminal hangs during interactive rebase by requiring explicit rebase abort on conflict (`c51a091`).
  - `verification-loop`: Removed POSIX pipeline (`head`/`tail`/`grep`) dependencies for cross-platform compatibility (`5f9c580`).
  - `execution-guardrails`: Replaced raw `sed` command suggestions with cross-platform native edit tools (`9a2fc78`).
- **Compliance Theater Prevention**: Updated `verify-gate.js` to output an explicit `UNCHECKED` warning when tests are missing instead of silently passing (`fb8c851`).
- **Self-Evolve & Path Fixes**:
  - Auto-create repo manifest directories and resolve script path references in `self-evolve` (`e0f0295`).
  - Resolved stale memory paths and relative agent definition references in `fable-haiku` (`962ff39`, `9975063`).
- **Circuit Breaker Deadlock**: Resolved tool name matching and session path deadlock in `zoom-out` (`46b4798`).
- **Manifest Loading in `to-spec`**: Fixed manifest helper module loading in `check-project-docs.js` (`142c668`).
- **Unlinked specialized-agent files**: Linked orphaned workflow/template files for multi-agent orchestration and unbound hard tool dependencies (`dbf075f`).

### Changed
- **Progressive Disclosure & Gentle Guidance**: Streamlined the commit, multi-agent orchestration, and cognitive-OS skills to follow progressive disclosure, replacing rigid commands with adaptable entrypoints (`5df5844`, `8a6a48f`, `b53d9d5`, `d84147b`, `a1234da`).
- **Path Portability**: Standardized script path invocation references across `SKILL.md` files to use `<this-skill-dir>` and `npx` commands (`30bc368`).
- **Single Source of Truth for Platform Notes**: Centralized platform availability notes across `zoom-out`, `todo-driven-workflow`, and `install-cognitive-os` to link to README's supported tools table (`8b6724e`).
- **Subagent Scope Guard Awareness**: Integrated `subagent-scope-guard` awareness across `fable-mode` and launcher workflows (`b9a4a42`).
- **Gitignore Auto-Rules**: Added auto-generated comment banner for Harness OS ignore rules in `.gitignore` (`30bc368`).

### Removed
- **Unverified Platform References**: Removed dangling, unverified Gemini CLI references and deleted the orphaned `platform-gemini.md` guideline (`e427bee`).
- **Obsolete Style Docs**: Removed obsolete `STYLE.md` and updated missing single-skill templates in `repo-docs` (`2d98ceb`).

---
## [0.3.2-alpha] - 2026-07-28

### Fixed
- **Platform Self-Heal Overkill**: Completely redesigned the environment and workspace detection algorithm in `self-heal.js` and `bootstrap.js`. Replaced the overly-broad binary if-else check (which fell back to auditing and generating files for all other 5 non-Claude platforms when Claude Code env was absent) with a precise dual-track platform detection strategy based on environment variables (like `TERM_PROGRAM`, `CURSOR_SANDBOX`, and `GITHUB_COPILOT_CHAT`) and existing configuration files. This ensures that the self-healing and bootstrap processes only target and audit platforms that are actively used or pre-configured in the project, eliminating accidental file pollution for other platforms.
- **Gitignore Suffix Matching**: Appended `.github/harness-everything/state/` to the ignore rules to prevent tracking state files for the Copilot integration.

---
## [0.3.1-alpha] - 2026-07-28

### Added
- **Expanded Routing Keywords**: Expanded routing keywords derived from user history and resolved regex preemption in `tier-router.js`.
- **Adjusted Default Skills**: Adjusted default skills configuration and unified command-line option indicators within the installer.

### Fixed
- **Legacy Hook Identification**: Supported robust legacy hook identification during global uninstallation.

### Changed
- **Pipeline Refactoring**: Integrated `grill-me` and `grill-with-docs` into a cohesive companion pipeline.

---
## [0.3.0-beta] - 2026-07-27

### Added
- **Modular Mechanism Tests**: Completely split the monolithic mechanism-test suite into 8 isolated, highly cohesive `.test.js` modules (`mechanism-2a` through `mechanism-2h` under `eval-framework/`) for superior traceability and ease of debugging.
- **Unified Test Helper**: Created `eval-framework/test-helper.js` managing mock execution directories, teardown life cycles, and child processes safely across all mechanism test runs.
- **Selective Gitignore Exclusion Tests (`mechanism-2g`)**: Added full validation tests for selective `.gitignore` exclusion algorithms across different developer platforms.
- **Installer & Manifest Serialization Tests (`mechanism-2h`)**: Implemented complete testing coverage for the installer manifest, metadata parsing, dynamic-skill registration, and automatic cleanup of empty manifest files.

### Fixed
- **Platform Gitignore Exclusion Overkill**: Fixed a critical bug in `hooks/scripts/lib/platforms/*.js` where the installer incorrectly added the entire workspace-level `.claude/skills` (or `.cursor/skills`, `.github/skills`, etc.) to `.gitignore`, silently blocking developers from committing their custom project-specific skills to version control. It now dynamically reads each skill's `SKILL.md` frontmatter and only ignores verified Harness core/system skills, keeping custom skills fully trackable.
- **Redundant Gitignore Suffix Matches**: Optimized platform ignore matching (`isMatch` in platform helper modules) to prevent appending redundant nested directories to `.gitignore` when parent directories (e.g. `.claude/` or `.cursor/`) are already broadly ignored.

### Changed
- Refactored `eval-framework/mechanism-test.js` to serve as a dynamic test orchestration runner. It auto-discovers all mechanism test suites, executes them sequentially under isolated environments, and outputs a clean console summary table at the end.
- Updated `VERIFICATION.md` and `docs/audit.md` to reflect the newly modularized test suites, raising the system-wide test coverage and capability scorecard to 9.0/10.

---
## [0.3.0-alpha] - 2026-07-26

### Added
- **`to-spec`**: adaptive spec/doc skill (feature spec, CLI/API reference, schema-doc, or dev-doc shape) chained after `grill-with-docs`/`grill-me`, advisory-only, with a one-time `check-project-docs.js` setup gate persisted in this repo's own `manifest.json`.
- **`to-tickets`**: breaks a `to-spec` doc (or an already-settled plan/conversation) into tracer-bullet tickets with declared blocking edges, reusing `to-spec`'s project-docs gate rather than a second interview.
- **`find-skills`**: external skill discovery via skills.sh/`npx skills`, defaulting to a zero-footprint ephemeral apply (content-addressed OS-temp cache) instead of caching third-party metadata in `manifest.json`; permanent install (`npx skills add`) remains an explicit, rare opt-in.
- Self-evolve's dynamic skills now register in `manifest.json` and get precise trigger matching from `tier-router.js`, so a lesson learned in one session is auto-surfaced in later ones.
- CI: `.github/workflows/ci.yml` runs `npm test` on push/PR across `ubuntu-latest` and `windows-latest`.
- `verify-gate.js` now runs the target project's real `lint`/`test` scripts (via the detected package manager) instead of a simulated stub, with a self-recursion guard (`HARNESS_SKIP_PROJECT_CHECKS`).

### Fixed
- `tier-router.js` resolved `workspaceRoot` via a `__dirname` offset that only ever worked inside this source repo — real installs could never find their `manifest.json`, silently killing dynamic-skill auto-discovery outside of development. Now walks up from `cwd` to the nearest `.git`.
- Installer's legacy-skills cleanup deleted `self-evolve`'s entire `skills/generated/` directory on every install/uninstall of Claude Code skills. Now only removes non-generated legacy subdirectories.
- `self-regression`'s syntax-check phase didn't cover `to-spec`/`to-tickets` scripts.
- Dynamic skill registration: removed an unconditional manifest rescan firing on every memory persist, tightened fallback trigger inference, made `triggers:` a required dynamic-skill frontmatter field, and fixed a broken Mermaid fence in `docs/workflows/skill-creator.md`.

### Changed
- Cognitive OS "iron laws" decoupled from one shared file and woven directly into the specific skill phase each governs.
- `tier-router.js`'s keyword/guide tables extracted into a sibling `routing-keywords.json` (fails open to Tier 1 if the file is missing or invalid).
- README and `docs/reflection.md` updated to describe six core modules (was five) and both `self-evolve` persistence paths (simple rule vs. dynamic skill).

### Documentation
- README restructured to be user-facing; audit scorecards, the 2026-07-23 mis-measurement incident, and the per-cycle change log moved to new `docs/audit.md`.
- New "What Gets Installed (and How to Remove It)" README section.
- `harness-everything/SKILL.md` section numbering fixed (§5 registry now precedes §6) and tier-following wording aligned with the router's actual output.

---
## [0.2.1] - 2026-07-24

### Fixed
- **Global skill installs landed one directory too deep**: `--global`/`-g` installs (all platforms share this one code path) copied skills to `~/.agents/harness-everything/skills/` instead of the documented `~/.agents/skills/` (see `bin/cli.js`'s own `-g, --global` help text, and the legacy-fallback scan `scripts/lib/skills.js` already expected at that path). Corrected in `scripts/installer.js` to match the same convention already used locally: `harness-everything/` holds manifest bookkeeping only, skill content lives in the native/shared `skills/` folder next to it. `~/.agents/harness-everything/manifest.json` is unchanged; uninstall's final global sweep was updated to match.
- **Duplicate lines could accumulate in `.gitignore`**: `ensureHarnessStateIgnored` (`hooks/scripts/lib/harness-state.js`) runs once per hook-invoked subprocess with no cross-process lock around its read-then-append, so two invocations firing close together could both decide the same ignore pattern was missing and both append it. It (and the installer's own `scripts/lib/gitignore.js` writer, which shares the identical shape) now collapses exact-duplicate non-comment/non-blank lines on every write, so a duplicate from a lost race self-heals on the next invocation instead of accumulating.

---
## [0.2.0] - 2026-07-23

### Added
- **Multi-Platform State Isolation Strategy**: Designed and created a registry for developer platforms (`claude.js`, `cursor.js`, `copilot.js`, `continue.js`, `codex.js`, `hermes.js`, `worktrees.js`) dynamically managing state folders (`getStateDir`) under respective tool namespaces (e.g. `.github/harness-state/`, `.cursor/harness-state/`) instead of hardcoding `.claude/harness-state/`.
- **Runtime and Install-Time Auto-Ignore Defense**: Automated self-exclusion by writing active platform patterns directly to `.gitignore` seamlessly during both runtime execution checkpoints and local setup/installation.
- **Per-platform install manifest**: every install now writes `<platform-dir>/harness-everything/manifest.json` (e.g. `.claude/harness-everything/manifest.json`, and a shared `~/.agents/harness-everything/manifest.json` for global scope), recording exactly which skill directories this package put where. All 23 `SKILL.md` files now carry `author`/`version` frontmatter, which the manifest cross-checks against before ever removing a directory.

### Fixed
- **Uninstall could delete content it didn't install**: `uninstall --skills`/interactive "Remove ALL" used to list every subdirectory under shared skill folders (`~/.agents/skills`, `.harness/skills`, …) as "installed," including a user's own manually-placed skills and `self-evolve`'s locally-generated `skills/generated/*`. Global uninstall additionally `rm -rf`'d all of `~/.agents` outright. Removal is now manifest-driven and author-marker-verified per skill, and global uninstall only ever touches its own `harness-everything/` subfolder — never `~/.agents` itself.
- **Claude hook removal false-positive**: the fallback matcher removed any hook whose command merely *contained the substring* "harness," which could catch an unrelated hook from another tool. Removal now keys solely off the `harness:` id namespace every hook this package ships already carries.

### Changed
- **`scripts/installer.js` split into `scripts/lib/`**: the single ~1200-line file (TUI, hook merge, advisory-text injection duplicated twice, skill copy, gitignore upkeep all mixed together) is now an orchestrator over `lib/manifest.js`, `lib/skills.js`, `lib/claude-hooks.js`, `lib/advisory-text.js`, `lib/gitignore.js`, `lib/prompts.js`, and `lib/workspace.js`.
- **Local runtime state relocated under `<platform-dir>/harness-everything/`**: the self-invented top-level `.harness/` root (Claude's manifest + skill copies) is retired in favor of `.claude/harness-everything/{state,skills,manifest.json}` — a subfolder of Claude's own directory that nothing else creates, so it can be added/removed as a unit. Each other platform's own `harness-state/` similarly moves to `<platform-dir>/harness-everything/state/`, alongside its own new `manifest.json`. Skill locations for Cursor/Copilot/Continue (`.cursor/skills`, `.github/skills`, `.continue/skills`) are unchanged. A one-time migration step removes any leftover `.harness/` on next local uninstall.
- **Codex skill target corrected from `.agents/skills/` to `.codex/skills/`**: `.agents/` was never a real Codex CLI convention — Codex's actual project-scoped home is `.codex/` (`.codex/skills/` for project skills, `.codex/config.toml` for CLI/sandbox config), confirmed against OpenAI's own docs. This bug predated this release. `getInstalledSkills` still scans the old `.agents/skills/` location as a legacy fallback so existing wrong-location installs remain discoverable and cleanly removable.
- **Author attribution**: `author` frontmatter across all 23 `SKILL.md` files, `package.json`, and the `HARNESS_AUTHOR` constant `scripts/lib/skills.js`'s uninstall safety check matches against, updated from `Harness Core Team` to `Miya Daniel | Harness Core Team`.

### Documentation
- Removed dangling `docs/reports/` links from `README.md`, `VERIFICATION.md`, `harness-everything/SKILL.md`, `skill-creator/SKILL.md`, and `skill-creator/references/quality-principles.md` — the referenced audit report files were removed from the repo; `VERIFICATION.md`'s own instruction to store *future* reports under `docs/reports/` is unaffected.

## [0.2.0-beta] - 2026-07-22

### Fixed
- **`uninstall` command unreachable via CLI**: `bin/cli.js`'s command dispatcher never had a `case 'uninstall'` - `scripts/installer.js` has handled `uninstall` internally since it was added, but the CLI entrypoint's `switch` fell through to `default` and printed `[Error] Unknown command: "uninstall"` before ever reaching it, making `npx github:dyphn1/Harness-everything uninstall` unusable regardless of flags. Added the missing case (routes to the same `runInstaller` path as `install`, since `installer.js` reads the command off `process.argv` itself) and documented `uninstall`'s flags in `--help`.

### Added
- **Continue.dev and Hermes Agent platform support**: `scripts/installer.js` now accepts `--continue` and `--hermes` (also included in `--all`). Continue.dev gets a dedicated `.continue/rules/harness.md` rule file (YAML frontmatter, `alwaysApply: true` — Continue's native rules format is one Markdown file per rule rather than a single shared file, so unlike Cursor/Copilot/Codex, Harness never appends into an arbitrary pre-existing file); global scope writes to `~/.continue/rules/harness.md`. Hermes Agent ([Nous Research](https://hermes-agent.nousresearch.com/)) gets `.hermes.md`, which Hermes auto-loads into its system prompt alongside `AGENTS.md`/`CLAUDE.md`/`.cursorrules` if present — project scope only, since Hermes has no documented global project-instructions equivalent (`--global --hermes` is a deliberate no-op with an explanatory message, not a guess). Both platforms are advisory-only (no hook/exit-code mechanism), matching Cursor/Copilot/Codex. `harness-everything/scripts/self-heal.js` and the uninstall path cover both new touchpoints. Updated `README.md`, `docs/architecture.md`, `VERIFICATION.md`, and `BENCHMARK_SOP.md` accordingly.

### Fixed
- **Runtime state scattered across the tree**: 4 of the 12 scripts that touch `.harness/*` state (`context-compact.js`, `rule-of-3.js`, `rule-of-3-tracker.js`, `harness-everything/scripts/todo-cli.js`) resolved their state directory from `process.cwd()` directly instead of walking up to the git root the way the other 8 did — a hook firing with a `cwd` that wasn't the repo root would create a fresh, orphaned `.harness/` wherever it stood. All state-path resolution is now centralized in one helper (`hooks/scripts/lib/harness-state.js`), so every script agrees on where state lives.

### Changed
- **Runtime state moved to `.claude/harness-state/`, scoped per Claude Code session**: `.harness/` mixed two unrelated things — the installer's local skill-copy target (`.harness/skills/`, a peer of `.cursor/skills`/`.github/skills`, untouched by this change) and pure runtime state (handoff/verification timestamps, circuit-breaker counters). The latter now lives at `.claude/harness-state/`. Hook-owned files (`handoff-state.json`, `stop-gate-state.json`, `subagent-scope-state.json`, `rule-of-3-state.json`, `context-compact-state.json`, `atomic-commit-state.json`, `zoom-out-report.md`) are scoped under `sessions/<session_id>/`, so two Claude Code sessions open on the same repo no longer share — and stomp — each other's edit/verify timestamps or breaker counts. `contracts/*.json` (written proactively by fable-orchestrator, which has no clean way to learn its own `session_id`) and `todo-state.json` (written via a plain CLI call, not a hook) stay shared across sessions, matching prior behavior — collision there is a narrower, lower-stakes edge case than the timestamp/counter files. `rule-of-3.js` keeps its no-stdin fast path for the common case (nobody's breaker tripped anywhere) via a cheap scan across session directories, only paying to read the hook payload once some session actually trips. `bootstrap.js` now also prunes session directories untouched for 14+ days, since nothing else purges them the way an OS temp directory would. `scripts/installer.js uninstall` removes `.claude/harness-state/` alongside the existing `.harness/` cleanup. Updated `VERIFICATION.md`, `docker-verify.sh`, `docs/architecture.md`, `fable-mode/CONTRACT-FORMAT.md`, `fable-mode/agents/fable-orchestrator.md`, and all affected `SKILL.md` state-mutation references accordingly.

## [0.2.0-alpha] - 2026-07-22

### Added
- **`skill-creator` skill**: merges principles from `mattpocock-skills/writing-great-skills` (predictability, information hierarchy, pruning, leading words, failure modes) and Anthropic's `skill-creator` (anatomy, progressive disclosure, testing workflow) into a Harness-native authoring/audit/testing workflow, reconciled against the existing Skill Contract convention rather than replacing it. Ships with a Quality Checklist and a Dynamic Skill Generation Contract that `self-evolve` now requires before packaging a session insight into a durable skill (written to `.harness/skills/generated/`, with `draft -> active -> deprecated` lifecycle metadata). Registered in `harness-everything/SKILL.md` §5 and `tier-router.js`'s skill-authoring keyword block.
- `docs/workflows/skill-creator.md`, matching the existing per-skill workflow-diagram convention (Behavior Workflow / Triggering & Routing Path / Real-World Use Case / Verification Check).
- **Skill Contract coverage**: All 25 `SKILL.md` files now carry a `📋 Skill Contract` table (Trigger/Input, Expected Output, State Mutations, Enforcement Gate) - up from 10/25.
- **Behavioral test wiring**: `eval-framework/behavioral-test.js` (the `todo-cli.js` state-machine E2E test) is now actually executed as Phase 3 of `npm test` / `self-regression.js`. It previously existed but was never invoked by any script, so it never ran automatically.

### Fixed
- **Installer uninstall safety**: `scripts/installer.js uninstall -y` no longer implicitly wipes global state (`~/.agents`, VS Code global prompts, global `.claude`/`.cursorrules`) just because it happens to detect a prior global install. Global removal now requires an explicit `--global`/`-g` flag, matching the interactive flow's existing unchecked-by-default behavior. The bug spanned two independent code paths (config removal and skill removal); both are fixed. Found via live testing on 2026-07-21 - a bare `uninstall -y` run from an unrelated test repo deleted real global Harness state.
- **Cross-file duplication**: the 33-line "ADHD-Friendly Output Shaping" block was duplicated verbatim across `install-cognitive-os/SKILL.md`, `harness-everything/SKILL.md`, and `AGENTS.md`. Consolidated to a single source (`install-cognitive-os`), with the other two replaced by a one-line pointer.
- **`tier-router.js` description drift**: six skills (`environment-detection`, `verify-before-claim`, `verification-loop`, `using-git-worktrees`, `fable-mode`, `grill-with-docs`) had inconsistently reworded one-line descriptions across the file's separate keyword blocks - including one outright inaccurate description of `verify-before-claim` (mislabeled as validating test assertions instead of external framework/API claims). Unified to one wording per skill everywhere it appears.
- `skill-style/SKILL.md`: removed a large copy-paste duplication of its own Skill Contract format example and Tone & Voice section.
- `AGENTS.md`: fixed a mislabeled `# Copilot Instructions` heading (the file is Codex's `AGENTS.md`, not Copilot's `.github/copilot-instructions.md`).
- `harness-everything/SKILL.md`: fixed a dangling pointer to a non-existent `harness-everything/adhd-output-shaping` path.

### Documentation
- **Skill quality audit**: Added `docs/reports/skill-quality-audit-writing-great-skills-2026-07-22.md`, a rule-based audit of all `SKILL.md` files against `mattpocock-skills/writing-great-skills` and Anthropic's `skill-creator`, with file:line evidence for every finding, a routing-consistency verification for the `install-cognitive-os` / `todo-driven-workflow` / `self-evolve` triad, and a record of the fixes applied above.
- **External evaluation report**: Added `docs/reports/evaluation-report-gemini-3.1-pro-2026-07-21.md`, an independent strict audit scoring the system 2-4/10 across the five core verification criteria (skill contract completeness, routing accuracy, test coverage, configuration balance, workflow conformance). The router fix (`f87bf34`) and the Skill Contract rollout (`7b2d04f`, completed above) were made in direct response to its findings.

### Corrected
- Removed a changelog entry from 2026-07-21 that claimed a self-authored "9.0/10 (Excellent)" evaluation and referenced `docs/reports/evaluation-report-harness-strict-2026-07-21.md`. That report was only ever committed on an unmerged branch (`test-fresh-env`) and never existed on `main`; several of its "PASS" rows were self-reported as untestable ("stdin not a TTY, cannot test directly") rather than actually run - an excuse that doesn't hold, since the same mechanism checks run fine over stdin in practice (see VERIFICATION.md §2). The external Gemini audit above is the only evaluation report that exists on `main`.

## [0.1.0-beta] - 2026-07-20

### Added
- Implemented strict boundaries and self-healing mechanisms for Harness core.
- Added interactive setup and modular skill installation to the installer.

### Changed
- Promoted to beta release for broader testing and validation of the Harness OS capabilities.
- Renamed references from `harness-skills` to `harness-everything` across the codebase.

### Documentation
- Updated `git-commit` guidelines to disallow blank lines between bullet points in the Angular style guide.

## [0.1.0-alpha] - 2026-07-20

This is the initial alpha release of **Harness OS** — a lightweight, local behavior and orchestration runtime that wraps around AI development sessions to enforce self-regulation, prevent token-wasting infinite loops, and eliminate environment hallucinations.

### Added

#### 1. Core Behavior Layer & Guards (Circuit Breaker & Context Safety)
- **`rule-of-3`**: Fail-safe circuit breaker. Tracks command failure signatures. If a command/test fails 3 times with the exact same signature, it locks mutating tools and triggers the **Zoom-Out Reflection Protocol**, requiring a structured diagnosis report (`zoom-out-report.md`) to release or escalates to a human.
- **`boundary-guard`**: Limits oversized file reads (preventing >600KB reads) and logs warnings to shield the model from "lost-in-the-middle" context degradation.
- **`stop-gate`**: Bounces the end of an edit turn once to ensure that file changes are always verified by a compiler/test command.
- **`subagent-scope-guard`**: Protects out-of-scope files from being accidentally modified by background or subagent processes.
- **`state-persist` (WAL)**: Write-Ahead Logs that preserve agent failure signatures and recovery status across tool invocations.

#### 2. Task Routing Engine
- **`tier-router`**: Triages user requests into three precise execution tiers:
  - **Tier 1 (Direct Edit)**: Small bugfixes, typos, or single-file changes.
  - **Tier 2 (TDD Red-Green-Refactor)**: Standard features requiring tests and validation loops.
  - **Tier 3 (Macro Multi-Agent Flow)**: Comprehensive architectural refactoring requiring multi-agent delegation.

#### 3. Environment Detection & Preflight Audit
- **`preflight`**: Automatically executes at session startup to print a diagnostic block identifying the Host OS (Windows/macOS/Linux), active shell, and package managers, neutralizing path and shell command hallucinations.

#### 4. Multi-Agent Scaffolding & Specialized Workflows
- **Multi-agent scaffolding**: Templates and workflows for spinning up context-specific specialized subagents (`backend-developer`, `memory-keeper`, `requirement-analyzer`, etc.).
- **`fable-mode`**: Specialized multi-agent orchestrator for bulk text processing, validation, and verification (with Orchestrator, Verifier, and specialized Worker agent roles).

#### 5. Evaluation & Verification Suite
- **`eval-framework`**: Automated evaluation cases (case 1 to 5) covering multiple complexity levels and support for multi-language (en/zh) prompt classification.
- **`VERIFICATION.md` & `docker-verify.sh`**: A comprehensive mechanism verification test suite that locally executes sandbox environment simulations to prove terminal blocking and self-recovery behaviors.
