# Changelog

All notable changes to this project will be documented in this file.

## 1.16.2 (2026-09-11)

### Chores 🧹

- chore(`ci`): release from main pushes to restore Actions cache writes ([#646](https://github.com/transformteamsg/onward/pull/646)) ([cfd6f0f](https://github.com/transformteamsg/onward/commit/cfd6f0f))

## 1.16.1 (2026-09-10)

### Bug Fixes 🐛

- fix(`unit`): empty sources array bypasses the minimum-one-source rule when publishing ([#642](https://github.com/transformteamsg/onward/pull/642)) ([90a4da8](https://github.com/transformteamsg/onward/commit/90a4da8))
- fix(`admin`): unbounded pageSize query parameter is passed directly to Prisma take ([#641](https://github.com/transformteamsg/onward/pull/641)) ([b20b78f](https://github.com/transformteamsg/onward/commit/b20b78f))
- fix(`auth`): logout is a state-changing GET with no CSRF validation ([#637](https://github.com/transformteamsg/onward/pull/637)) ([ab594d8](https://github.com/transformteamsg/onward/commit/ab594d8))
- fix(`api`): subscribe and onboarding endpoints require a csrfToken but never validate it ([#635](https://github.com/transformteamsg/onward/pull/635)) ([cbb2316](https://github.com/transformteamsg/onward/commit/cbb2316))
- fix(`auth`): OAuth callbacks redirect to unvalidated return_to allowing open redirect ([#634](https://github.com/transformteamsg/onward/pull/634)) ([faa2048](https://github.com/transformteamsg/onward/commit/faa2048))
- fix(`api`): learning journey checkpoint endpoint accepts client-supplied isCompleted ([#633](https://github.com/transformteamsg/onward/pull/633)) ([b724e3a](https://github.com/transformteamsg/onward/commit/b724e3a))
- fix(`quiz`): server records client-supplied isQuizPassed instead of grading answers ([#632](https://github.com/transformteamsg/onward/pull/632)) ([7c87c1a](https://github.com/transformteamsg/onward/commit/7c87c1a))
- fix(`unit`): javascript: URLs pass source URL validation and render into a live href ([#631](https://github.com/transformteamsg/onward/pull/631)) ([ac044c1](https://github.com/transformteamsg/onward/commit/ac044c1))
- fix(`hooks`): admin guard skipped for URL-encoded admin paths because dispatch reads the raw pathname ([#630](https://github.com/transformteamsg/onward/pull/630)) ([bf2e953](https://github.com/transformteamsg/onward/commit/bf2e953))
- fix(`ci`): PR title interpolated into release.yaml run block allows command injection ([#629](https://github.com/transformteamsg/onward/pull/629)) ([26eba14](https://github.com/transformteamsg/onward/commit/26eba14))
- fix(`auth`): learner session accepted as admin via shared session namespace and missing admin identity check ([#628](https://github.com/transformteamsg/onward/pull/628)) ([be49758](https://github.com/transformteamsg/onward/commit/be49758))
- fix(docker): add dedicated migrate image stage ([#627](https://github.com/transformteamsg/onward/pull/627)) ([99cd861](https://github.com/transformteamsg/onward/commit/99cd861))

### Chores 🧹

- chore: update vulnerable dependencies ([#644](https://github.com/transformteamsg/onward/pull/644)) ([9f0db20](https://github.com/transformteamsg/onward/commit/9f0db20))
- chore(`auth`): bind Google ID token verification to the OAuth client audience ([#643](https://github.com/transformteamsg/onward/pull/643)) ([36d8bfb](https://github.com/transformteamsg/onward/commit/36d8bfb))
- chore(`docker`): verify checksums for pnpm binary and RDS CA bundle downloaded in the image build ([#640](https://github.com/transformteamsg/onward/pull/640)) ([ca59e8c](https://github.com/transformteamsg/onward/commit/ca59e8c))
- chore(`cache`): bound the avatar fetch with a timeout, size cap, and host allowlist ([#639](https://github.com/transformteamsg/onward/pull/639)) ([14440bb](https://github.com/transformteamsg/onward/commit/14440bb))
- chore(`config`): drop the hardcoded POSTGRES_URL fallback and fail fast when it is unset ([#638](https://github.com/transformteamsg/onward/pull/638)) ([b08d6f8](https://github.com/transformteamsg/onward/commit/b08d6f8))
- chore(`api`): add per-user rate limiting to the OpenAI-backed messages endpoint ([#636](https://github.com/transformteamsg/onward/pull/636)) ([2b427d2](https://github.com/transformteamsg/onward/commit/2b427d2))
- chore: update vulnerable dependencies ([#610](https://github.com/transformteamsg/onward/pull/610)) ([81af3ec](https://github.com/transformteamsg/onward/commit/81af3ec))

## 1.16.0 (2026-07-01)

### Features ✨

- feat(auth): support multiple Google hosted domains ([#605](https://github.com/String-sg/onward/pull/605)) ([d30cc2e](https://github.com/String-sg/onward/commit/d30cc2e))

### Chores 🧹

- chore: update vulnerable dependencies ([#607](https://github.com/String-sg/onward/pull/607)) ([3d1f10d](https://github.com/String-sg/onward/commit/3d1f10d))

## 1.15.1 (2026-06-25)

### Bug Fixes 🐛

- fix(onboarding): source topic list from DB to stop selections being silently dropped ([#599](https://github.com/String-sg/onward/pull/599)) ([0eb6d4e](https://github.com/String-sg/onward/commit/0eb6d4e))

## 1.15.0 (2026-06-11)

### Features ✨

- feat: streaming report exports ([#584](https://github.com/String-sg/onward/pull/584)) ([b450359e](https://github.com/String-sg/onward/commit/b450359e))
- feat: improve ask ai retrieval ([#572](https://github.com/String-sg/onward/pull/572)) ([2bad386f](https://github.com/String-sg/onward/commit/2bad386f))

### Chores 🧹

- chore: resolve npm audit vulnerabilities ([#591](https://github.com/String-sg/onward/pull/591)) ([1b95745e](https://github.com/String-sg/onward/commit/1b95745e))

## 1.14.1 (2026-05-12)

### Bug Fixes 🐛

- fix: handle missing picture claim in google oauth login ([#567](https://github.com/String-sg/onward/pull/567)) ([4cdb9489](https://github.com/String-sg/onward/commit/4cdb9489))

## 1.14.0 (2026-05-11)

### Features ✨

- feat: improve google oauth error logs ([#565](https://github.com/String-sg/onward/pull/565)) ([0a8ce0f0](https://github.com/String-sg/onward/commit/0a8ce0f0))

## 1.13.3 (2026-05-11)

### Bug Fixes 🐛

- fix: malformed CloudFront policy for content ([#563](https://github.com/String-sg/onward/pull/563)) ([a511b6cc](https://github.com/String-sg/onward/commit/a511b6cc))

## 1.13.2 (2026-05-11)

### Bug Fixes 🐛

- fix: podcast delivery to CDN ([#561](https://github.com/String-sg/onward/pull/561)) ([f09b804d](https://github.com/String-sg/onward/commit/f09b804d))

## 1.13.1 (2026-05-08)

### Bug Fixes 🐛

- fix: S3 socket exhaustion for podcast delivery ([#558](https://github.com/String-sg/onward/pull/558)) ([74b6ae71](https://github.com/String-sg/onward/commit/74b6ae710d2566492caba59bae3c0d1a4fc204fa))

## 1.13.0 (2026-05-05)

### Features ✨

- feat: add help link to login page ([#555](https://github.com/String-sg/onward/pull/555)) ([47ab05a](https://github.com/String-sg/onward/commit/47ab05a0))

## 1.12.0 (2026-04-29)

### Features ✨

- feat: update Player buttons UI ([#552](https://github.com/String-sg/onward/pull/552)) ([3755323](https://github.com/String-sg/onward/commit/37553233ec84c719ce91b3ad434e9cff55b30ed5))
- feat: update Quiz Incorrect answer UI ([#551](https://github.com/String-sg/onward/pull/551)) ([65788ec](https://github.com/String-sg/onward/commit/65788ec929276d3fa87ce646341b633858206188))

### Chores 🧹

- chore: fix vulnerabilities ([#554](https://github.com/String-sg/onward/pull/554)) ([d015194](https://github.com/String-sg/onward/commit/d015194c460ffbb3ce0ad79d30c3eba1b08ebce8))

## 1.11.0 (2026-04-23)

### Features ✨

- feat: add Collections section in Home page ([#546](https://github.com/String-sg/onward/pull/546)) ([e3304d9](https://github.com/String-sg/onward/commit/e3304d9a80e79120ca49abb35d554cb5da792f8b))
- feat: update video delivery using AWS Cloudfront ([#542](https://github.com/String-sg/onward/pull/542)) ([daebb84](https://github.com/String-sg/onward/commit/daebb84396b91cde00362f6cbbc5a239b7ea54ee))

### Bug Fixes 🐛

- fix: Now Playing View transcript scroll behavior ([#543](https://github.com/String-sg/onward/pull/543)) ([082f4ad](https://github.com/String-sg/onward/commit/082f4ad8295c1d1b5aee80cd8f483f96696e3e0b))

### Chores 🧹

- chore: bump dependencies to fix vulnerabilities ([#547](https://github.com/String-sg/onward/pull/547)) ([e74ca6e](https://github.com/String-sg/onward/commit/e74ca6e4d5ea716a9717054d0d6ca26d29968acd))
- chore: update dependencies ([#541](https://github.com/String-sg/onward/pull/541)) ([3b40908](https://github.com/String-sg/onward/commit/3b40908f71eeb99ac9c31f7a6560a4921d2511a1))
- chore: update prisma dependencies for security patch ([#536](https://github.com/String-sg/onward/pull/536)) ([d5c28a5](https://github.com/String-sg/onward/commit/d5c28a51decc29c1923f0cf97108a6b34c178347))
- chore(deps-dev): bump vite from 7.1.12 to 7.3.2 ([#537](https://github.com/String-sg/onward/pull/537)) ([c98dd9a](https://github.com/String-sg/onward/commit/c98dd9a5067c01a0ad0a9ede8c3d48623363ce6d))
- chore(deps-dev): bump dompurify from 3.2.7 to 3.3.2 ([#529](https://github.com/String-sg/onward/pull/529)) ([680f238](https://github.com/String-sg/onward/commit/680f2380da7825622091795daa85e162d3954f7e))
- chore(deps): bump picomatch from 2.3.1 to 2.3.2 ([#524](https://github.com/String-sg/onward/pull/524)) ([565fa93](https://github.com/String-sg/onward/commit/565fa932aa85f52824ef9ef2ee9ea21b70feadb3))
- chore(deps): bump flatted from 3.3.3 to 3.4.2 ([#519](https://github.com/String-sg/onward/pull/519)) ([f4f201f](https://github.com/String-sg/onward/commit/f4f201f0403aaef6147ab963bebe30c6bced0d14))

## 1.10.0 (2026-03-27)

### Features ✨

- feat: first time pass rate tracking ([#526](https://github.com/String-sg/onward/pull/526)) ([4f644a1](https://github.com/String-sg/onward/commit/4f644a1eb7daf661bd67a26352f6b09edd07b41f))
- feat: add video content ([#523](https://github.com/String-sg/onward/pull/523)) ([e3366ba](https://github.com/String-sg/onward/commit/e3366ba9e9fd0f8e2ca3980115ab8eb77488ce4b))
- feat: update onboarding ui ([#509](https://github.com/String-sg/onward/pull/509)) ([925fe63](https://github.com/String-sg/onward/commit/925fe6340ef797f954e677ce89008b6a1990f737))
- feat: add markdown support for quiz questions ([#510](https://github.com/String-sg/onward/pull/510)) ([3bd66d8](https://github.com/String-sg/onward/commit/3bd66d8c4e9b3dc8bbc7e997a55bd8b10fb037a7))
- feat: add learning unit states ([#498](https://github.com/String-sg/onward/pull/498)) ([43b86d8](https://github.com/String-sg/onward/commit/43b86d87a422ea2ba3cbd35bf0d58c3bdd5a644e))
- feat: mandatory collection ([#500](https://github.com/String-sg/onward/pull/500)) ([c2a1980](https://github.com/String-sg/onward/commit/c2a19805a19d8d2de968c641570d9038d82ca3cf))
- feat: update copy and image formatting for onboarding page ([#501](https://github.com/String-sg/onward/pull/501)) ([5380cdc](https://github.com/String-sg/onward/commit/5380cdc5ef4a271b458b96f75eb380a34c730703))
- feat: onboarding flow ([#484](https://github.com/String-sg/onward/pull/484)) ([100a3bd](https://github.com/String-sg/onward/commit/100a3bd9d817fd14b7084ecdf9cb99120b7f0938))
- feat(admin): add admin app ([#476](https://github.com/String-sg/onward/pull/476)) ([7ae8600](https://github.com/String-sg/onward/commit/7ae8600d9697f7e3ab3249aec5148ba20a3de793))
- feat: add GA profile click ([#493](https://github.com/String-sg/onward/pull/493)) ([da9073d](https://github.com/String-sg/onward/commit/da9073dd722cc4f2a1015e4b843a1e118e2f0f8f))

### Bug Fixes 🐛

- fix: allow resume playback on home page learning bites ([#521](https://github.com/String-sg/onward/pull/521)) ([a4a27d3](https://github.com/String-sg/onward/commit/a4a27d30d987c49b9cade45331d8d340c9451711))
- fix: prevent revert of completion status when user re-visit learning bites ([#520](https://github.com/String-sg/onward/pull/520)) ([05883cc](https://github.com/String-sg/onward/commit/05883cc97fe504e8ccab289e29648418dd59f18a))
- fix: update query of condition to filter collection data ([#517](https://github.com/String-sg/onward/pull/517)) ([2c06928](https://github.com/String-sg/onward/commit/2c069282768c495af2e76cf2d2d10f5ef2d977ae))
- fix: Quiz SSR error ([#512](https://github.com/String-sg/onward/pull/512)) ([8479eaf](https://github.com/String-sg/onward/commit/8479eaf8c308674399384f26fb17e4aadc2585da))
- fix: load chip bags for onboarding view ([#508](https://github.com/String-sg/onward/pull/508)) ([3ff33d7](https://github.com/String-sg/onward/commit/3ff33d7657bd11a40a094747064eeeda043c5746))
- fix: error pages for main and admin pages ([#505](https://github.com/String-sg/onward/pull/505)) ([04bd375](https://github.com/String-sg/onward/commit/04bd37557a7ecaf8ef7af07893a52d7246ccd5c4))
- fix: correct page states ([#503](https://github.com/String-sg/onward/pull/503)) ([e955f94](https://github.com/String-sg/onward/commit/e955f94d514567396d63b2c1bc51d539db0db966))
- fix: correct variable naming, add missing curly braces ([#499](https://github.com/String-sg/onward/pull/499)) ([5e38890](https://github.com/String-sg/onward/commit/5e3889086b1db23f6f0b6f91466b6c31dcb71252))
- fix: leave podcast modal closed when there's no quiz present ([#495](https://github.com/String-sg/onward/pull/495)) ([42e290d](https://github.com/String-sg/onward/commit/42e290d0d369e070a94ffd79e3cd492eecb84933))
- fix: enable quiz only upon all prerequisites completed ([#532](https://github.com/String-sg/onward/pull/532)) ([c8595a4](https://github.com/String-sg/onward/commit/c8595a47761f04aede698ebd5add5766fbb09bd7))
- fix: video content type migration ([#531](https://github.com/String-sg/onward/pull/531)) ([da1bfa5](https://github.com/String-sg/onward/commit/da1bfa52a46261aa543c649f541372d77bb66dad))
- fix: add missing migration file ([#527](https://github.com/String-sg/onward/pull/527)) ([1d0cd6f](https://github.com/String-sg/onward/commit/1d0cd6fea6d7fa4e3e532c6657b618b22e99883e))

### Chores 🧹

- chore: update dependencies ([#502](https://github.com/String-sg/onward/pull/502)) ([f28c77a](https://github.com/String-sg/onward/commit/f28c77a5f3e368613a4eb838a05177388df2d1be))
- chore: update node to 24.14.0 ([#504](https://github.com/String-sg/onward/pull/504)) ([826991e](https://github.com/String-sg/onward/commit/826991ec6f4ab50455895568b9864496265e3408))
- chore: update svelte dependencies ([#497](https://github.com/String-sg/onward/pull/497)) ([d754b54](https://github.com/String-sg/onward/commit/d754b54a06d3725bcb12b6faca78e22f32f401ae))
- chore: update js-yaml ([#496](https://github.com/String-sg/onward/pull/496)) ([9de0e55](https://github.com/String-sg/onward/commit/9de0e554aecbc10c64ae09c67c01ea6c4dcbe0bb))
- chore: upgrade aws sdk dependency ([#494](https://github.com/String-sg/onward/pull/494)) ([45c3b0e](https://github.com/String-sg/onward/commit/45c3b0e6f871e6fbcaf37419876a29edfeee264f))
- chore: upgrade dependencies ([#488](https://github.com/String-sg/onward/pull/488)) ([0e37c11](https://github.com/String-sg/onward/commit/0e37c114e2656e0ee7e987c4eb3b12c3ecf0dfe4))
- chore: bump node to v24 ([#487](https://github.com/String-sg/onward/pull/487)) ([4c52351](https://github.com/String-sg/onward/commit/4c52351325976875c2c564982245139dc2fc82f4))

### CI 🤖

- ci: move codeql to a separate workflow ([#490](https://github.com/String-sg/onward/pull/490)) ([a2cec99](https://github.com/String-sg/onward/commit/a2cec9954f31f73db7967f6af73c4e6fb7e9d6a6))
- ci: sast using codeql ([#486](https://github.com/String-sg/onward/pull/486)) ([2aad153](https://github.com/String-sg/onward/commit/2aad15366c724a745623fec78dddc4cf0706b835))

## 1.9.0 (2026-01-28)

### Features ✨

- feat: Add GA Events ([#470](https://github.com/String-sg/onward/pull/470)) ([baa322f](https://github.com/String-sg/onward/commit/baa322f))

### Bug Fixes 🐛

- fix: align bites page layout ([#481](https://github.com/String-sg/onward/pull/481)) ([b36813b](https://github.com/String-sg/onward/commit/b36813b))
- fix: use native arm runners for building and pushing image actions ([#475](https://github.com/String-sg/onward/pull/475)) ([dcd3b5b](https://github.com/String-sg/onward/commit/dcd3b5b))

### Chores 🧹

- chore: add unit tests for components ([#477](https://github.com/String-sg/onward/pull/477)) ([8b6c774](https://github.com/String-sg/onward/commit/8b6c774))

## 1.8.0 (2026-01-09)

### Features ✨

- feat: add masthead to root layout ([#472](https://github.com/String-sg/onward/pull/472)) ([d5cc13f](https://github.com/String-sg/onward/commit/d5cc13ffbf22abdf6d9e52ca2dec0f6261bbf942))
- feat: add footer ([#473](https://github.com/String-sg/onward/pull/473)) ([8f3526b](https://github.com/String-sg/onward/commit/8f3526b3a35c172364c032f8a911cf21e6b23cee))
- feat: update home page routing ([#466](https://github.com/String-sg/onward/pull/466)) ([c52b7cc](https://github.com/String-sg/onward/commit/c52b7ccd1ec19c924970acf0ce8a1cfb8ff94215))

## 1.7.0 (2025-12-23)

### Features ✨

- feat: order by due_date and created_at for To-dos ([#468](https://github.com/String-sg/onward/pull/468)) ([a6f88d0](https://github.com/String-sg/onward/commit/a6f88d0))
- feat: update logo ([#467](https://github.com/String-sg/onward/pull/467)) ([03bf753](https://github.com/String-sg/onward/commit/03bf753))

### Chores 🧹

- chore: setup svelte testing library ([#465](https://github.com/String-sg/onward/pull/465)) ([487e9a5](https://github.com/String-sg/onward/commit/487e9a5))

## 1.6.0 (2025-12-10)

### Features ✨

- feat: update tracking learning journey ui on profile page ([#461](https://github.com/String-sg/onward/pull/461)) ([490d1d0](https://github.com/String-sg/onward/commit/490d1d046106bc63cdb75d786f2be5f6b3e962df))
- feat: Homepage UX adjustment ([#455](https://github.com/String-sg/onward/pull/455)) ([8892cc2](https://github.com/String-sg/onward/commit/8892cc23593d4dc0f554fe07f4a2c51f001273c7))

### Bug Fixes 🐛

- fix: get correct date range ([#463](https://github.com/String-sg/onward/pull/463)) ([bc0fb0a](https://github.com/String-sg/onward/commit/bc0fb0a03708503508bd3851a320e2f0e34be52d))
- fix: update colour mapping for new collections ([#462](https://github.com/String-sg/onward/pull/462)) ([0ee487a](https://github.com/String-sg/onward/commit/0ee487a8442f011954065291f1090ec9756317ef))

## 1.5.0 (2025-12-04)

### Features ✨

- feat: add ga analytics for 50% and 80% podcast play ([#459](https://github.com/String-sg/onward/pull/459)) ([6a32c9e](https://github.com/String-sg/onward/commit/6a32c9e4a17cd7ad55e4af9c301ca2975a4e83fe))
- feat: update failed quiz modal ([#457](https://github.com/String-sg/onward/pull/457)) ([3d37252](https://github.com/String-sg/onward/commit/3d37252db771ece6150038307cabaf2239944bf8))
- feat: add Terms, Privacy, and Report Vulnerability links ([#458](https://github.com/String-sg/onward/pull/458)) ([0427d6e](https://github.com/String-sg/onward/commit/0427d6e041b308e7eed734a471d61ff247b23cd7))
- feat: add new bites types ([#456](https://github.com/String-sg/onward/pull/456)) ([619824b](https://github.com/String-sg/onward/commit/619824bfd8d8b5f5741c4dda8512e322ce950918))
- feat: mandatory quiz ([#443](https://github.com/String-sg/onward/pull/443)) ([7a11516](https://github.com/String-sg/onward/commit/7a11516d095615272e8c781e4a4f155e593789cc))
- feat: add ga events for 20 and 100 percent podcast play ([#432](https://github.com/String-sg/onward/pull/432)) ([ab497e2](https://github.com/String-sg/onward/commit/ab497e21ebdc7a286079b5721d7b7e17f790d4b1))

### Bug Fixes 🐛

- fix: update Dockerfile to copy prisma config ([#454](https://github.com/String-sg/onward/pull/454)) ([064874f](https://github.com/String-sg/onward/commit/064874f1304a250399898c412cf148656cca1795))

### Chores 🧹

- chore: upgrade prisma ([#453](https://github.com/String-sg/onward/pull/453)) ([e0b19f1](https://github.com/String-sg/onward/commit/e0b19f183b2b331df7a31c1c3587ae35a3c28af1))

## 1.4.0 (2025-11-07)

### Features ✨

- feat: add css positioning to make img touch done button ([#427](https://github.com/String-sg/onward/pull/427)) ([7696746](https://github.com/String-sg/onward/commit/7696746))
- feat: add background shade to `Collection` component ([#428](https://github.com/String-sg/onward/pull/428)) ([144df62](https://github.com/String-sg/onward/commit/144df62))
- feat: update error message to be more concise ([#419](https://github.com/String-sg/onward/pull/419)) ([921bafd](https://github.com/String-sg/onward/commit/921bafd))
- feat: add orange background to login page ([#425](https://github.com/String-sg/onward/pull/425)) ([5bdd788](https://github.com/String-sg/onward/commit/5bdd788))
- feat: add CSRF protection for chatbot ([#426](https://github.com/String-sg/onward/pull/426)) ([85678df](https://github.com/String-sg/onward/commit/85678df))

### Bug Fixes 🐛

- fix: chat error message padding ([#417](https://github.com/String-sg/onward/pull/417)) ([9689ce5](https://github.com/String-sg/onward/commit/9689ce5))
- fix: chat error handling ([#423](https://github.com/String-sg/onward/pull/423)) ([819a61c](https://github.com/String-sg/onward/commit/819a61c))

### Chores 🧹

- chore(deps): bump `@sveltejs/vite-plugin-svelte` from `6.1.0` to `6.2.1` ([#430](https://github.com/String-sg/onward/pull/430)) ([cea31b4](https://github.com/String-sg/onward/commit/cea31b4))
- chore(deps): bump `vite` from `7.1.1` to `7.1.12` ([#429](https://github.com/String-sg/onward/pull/429)) ([b9a98e3](https://github.com/String-sg/onward/commit/b9a98e3))
- chore: remove unused favicons ([#424](https://github.com/String-sg/onward/pull/424)) ([873372a](https://github.com/String-sg/onward/commit/873372a))

## 1.3.0 (2025-10-30)

### Features ✨

- feat: add custom header to Weaviate request ([#420](https://github.com/String-sg/onward/pull/420)) ([624b4cc](https://github.com/String-sg/onward/commit/624b4ccd77d0a48ea6c7a2ebde022bb90f0a022f))
- feat: enhance recommendation of learning units logic ([#415](https://github.com/String-sg/onward/pull/415)) ([4f2e3d0](https://github.com/String-sg/onward/commit/4f2e3d00c123668b8bdde45fe9ea34d9297cb0ef))
- feat: update text for quiz completion modal ([#413](https://github.com/String-sg/onward/pull/413)) ([d6ee6c3](https://github.com/String-sg/onward/commit/d6ee6c3a2290a3574fc3cd40d02398a5782a201b))
- feat: add nps feedback survey links on learning and explore page ([#411](https://github.com/String-sg/onward/pull/411)) ([7c89f6e](https://github.com/String-sg/onward/commit/7c89f6e668fed769f110e8beedbaf7624f34ba77))
- feat: update learning page empty state ([#410](https://github.com/String-sg/onward/pull/410)) ([c2d9084](https://github.com/String-sg/onward/commit/c2d90845801657dfd710285ba2546777958a5d39))

### Bug Fixes 🐛

- fix: prevent shrink on quiz option letters ([#412](https://github.com/String-sg/onward/pull/412)) ([7149469](https://github.com/String-sg/onward/commit/714946997471d406cc37d9299fcfe10d3d5bca80))

## 1.2.0 (2025-10-23)

### Features ✨

- feat: update form link for nps feedback survey ([#407](https://github.com/String-sg/onward/pull/407)) ([5be968f](https://github.com/String-sg/onward/commit/5be968f21776a20f4244372d7e645faf4bda6ddb))

## 1.1.0 (2025-10-23)

### Features ✨

- feat: add nps feedback survey ([#403](https://github.com/String-sg/onward/pull/403)) ([6c5268e](https://github.com/String-sg/onward/commit/6c5268ec969fd277c3a4c09e59477b0f77e0f13d))
- feat: upgrade AI system prompt ([#401](https://github.com/String-sg/onward/pull/401)) ([87d5481](https://github.com/String-sg/onward/commit/87d5481b9dc35a47d8d1ce42e2dfb6c60d1725f4))
- feat: add more events for tracking in ga analytics ([#332](https://github.com/String-sg/onward/pull/332)) ([7a624dc](https://github.com/String-sg/onward/commit/7a624dcfe1fa9892952e7e962a0b9fc0a9baa453))
- feat: sort collections based on last updated time on learning journey ([#368](https://github.com/String-sg/onward/pull/368)) ([13ec6ae](https://github.com/String-sg/onward/commit/13ec6ae9a3795ccad84ec94c5457379fe35efb68))

## 1.0.0 (2025-10-22)

### Features ✨

- feat: update quiz completion modal ([#395](https://github.com/String-sg/onward/pull/395)) ([85db236](https://github.com/String-sg/onward/commit/85db236727535aededaa42117cf7958114701b26))
- feat: new UI changes ([#396](https://github.com/String-sg/onward/pull/396)) ([c5e11dc](https://github.com/String-sg/onward/commit/c5e11dc1ceb50d1a560656795bb7c76b08bf5de2))

## 0.10.0 (2025-10-21)

### Features ✨

- feat: rename `MLUs` to `bites` ([#369](https://github.com/String-sg/onward/pull/369)) ([7a26a15](https://github.com/String-sg/onward/commit/7a26a157edde7f8d523f62149d96d3eb4a4d33e3))
- feat: switch database primary keys from `bigint` to `uuidv7` ([#371](https://github.com/String-sg/onward/pull/371)) ([6802ad9](https://github.com/String-sg/onward/commit/6802ad93696b665d8152dd9626b08b2893861cc4))
- feat: update collection types and tag codes ([#372](https://github.com/String-sg/onward/pull/372)) ([26d68b8](https://github.com/String-sg/onward/commit/26d68b80ca0874a1588dffca9eec51b6eab50dee))
- feat: disable clear button when AI is responding ([#375](https://github.com/String-sg/onward/pull/375)) ([e84ac7e](https://github.com/String-sg/onward/commit/e84ac7ec39cfbea9d617394b2aa84a3b108331f7))

### Bug Fixes 🐛

- fix: use standard function with `arguments` when declaring `gtag` function ([#370](https://github.com/String-sg/onward/pull/370)) ([ff60630](https://github.com/String-sg/onward/commit/ff60630673b4d5bea8d5cbe51caf8f710e3f509c))
- fix: learning unit objectives width for bigger screens ([#382](https://github.com/String-sg/onward/pull/382)) ([4c245dc](https://github.com/String-sg/onward/commit/4c245dc98e8c188363e49edb48687b8163ee986b))

### Chores 🧹

- chore: squash database migrations ([#373](https://github.com/String-sg/onward/pull/373)) ([0b19ad6](https://github.com/String-sg/onward/commit/0b19ad6ce8be6a38bfb05bef4b00c62d5cd27b3b))

## 0.9.0 (2025-10-17)

### Features ✨

- feat: sort learning journeys in descending order of creation ([#365](https://github.com/String-sg/onward/pull/365)) ([d61e742](https://github.com/String-sg/onward/commit/d61e74236fc6b6c77d9db03fd957178f825e8bdc))
- feat: always show full objectives in learning unit page ([#364](https://github.com/String-sg/onward/pull/364)) ([a97faa3](https://github.com/String-sg/onward/commit/a97faa3fe7f555a2565bf81ca9b82b7a86f054dd))
- feat: hide empty progress sections when no units to display ([#362](https://github.com/String-sg/onward/pull/362)) ([178ef4c](https://github.com/String-sg/onward/commit/178ef4ce88efa48ed80009b53a2af43a84197b3d))

### Bug Fixes 🐛

- fix: ensure `dataLayer` and `gtag` are defined before loading the `gtag` script ([#363](https://github.com/String-sg/onward/pull/363)) ([26d3e47](https://github.com/String-sg/onward/commit/26d3e47ea547df11571a4bfe914aa581b30c45b4))

## 0.8.0 (2025-10-16)

### Features ✨

- feat: add collection description in learning collection page view ([#355](https://github.com/String-sg/onward/pull/355)) ([494f0c9](https://github.com/String-sg/onward/commit/494f0c923420eb3cb5c9fde20c127ec3939b6464))

### Bug Fixes 🐛

- fix: always remove `overflow` property when closing modal ([#353](https://github.com/String-sg/onward/pull/353)) ([d706a52](https://github.com/String-sg/onward/commit/d706a528438a19a3dbd4638286eb86ba77762b28))
- fix: add default for updated_at column for learning unit sources ([#338](https://github.com/String-sg/onward/pull/338)) ([141bd80](https://github.com/String-sg/onward/commit/141bd805dd606b2c0f105beb78c4a817f786d3c9))

## 0.7.2 (2025-10-16)

### Features ✨

- feat: set reasoning effort to `minimal` ([#347](https://github.com/String-sg/onward/pull/347)) ([60203fd](https://github.com/String-sg/onward/commit/60203fda7e60a2e51c8f99e18602d6ffc1224398))

### Bug Fixes 🐛

- fix: update thumbs up padding size ([#348](https://github.com/String-sg/onward/pull/348)) ([9d95fab](https://github.com/String-sg/onward/commit/9d95fab2daf0b2f6ac4800703ffe1ce3aa6b2774))
- fix: remove temperature property ([#345](https://github.com/String-sg/onward/pull/345)) ([93dbb58](https://github.com/String-sg/onward/commit/93dbb587f55e60e5cd0042da390650cf432cd522))
- fix: remove likes count when it is zero ([#343](https://github.com/String-sg/onward/pull/343)) ([4bc4ddb](https://github.com/String-sg/onward/commit/4bc4ddb43716ec41d87810b43b75bc18846be708))
- fix: username in greeting message of chatbot ([#339](https://github.com/String-sg/onward/pull/339)) ([2bb670e](https://github.com/String-sg/onward/commit/2bb670eb717ac6ada77304e287bfc2577181126d))

## 0.7.1 (2025-10-16)

### Bug Fixes 🐛

- fix: place the learning unit objectives container into it's proper position ([#337](https://github.com/String-sg/onward/pull/337)) ([bff0210](https://github.com/String-sg/onward/commit/bff021084a57173310f0ee39b149a213469ca176))

## 0.7.0 (2025-10-15)

### Features ✨

- feat: use streaming for chatbot ([#293](https://github.com/String-sg/onward/pull/293)) ([bf18164](https://github.com/String-sg/onward/commit/bf18164e01d4d1a46666778d9d405e9e81bc827d))

## 0.6.0 (2025-10-15)

### Features ✨

- feat: add new collection types ([#334](https://github.com/String-sg/onward/pull/334)) ([ea8391d](https://github.com/String-sg/onward/commit/ea8391db5af46c5558a496ff4930eabdefd6f37b))
- feat: add learning units sources ([#331](https://github.com/String-sg/onward/pull/331)) ([ac89334](https://github.com/String-sg/onward/commit/ac89334004dd73526f078aa44893bec50d0fccc8))
- feat: update `updatedAt` to default now ([#333](https://github.com/String-sg/onward/pull/333)) ([bedacde](https://github.com/String-sg/onward/commit/bedacde8e9455fda260797a387f118ffafaa9ea5))
- feat: add learning units sentiments ([#325](https://github.com/String-sg/onward/pull/325)) ([9276a7c](https://github.com/String-sg/onward/commit/9276a7ca4b30f0e71e68097bdda98cb2213fcc14))
- feat: add summary in player view ([#328](https://github.com/String-sg/onward/pull/328)) ([b9ba6b8](https://github.com/String-sg/onward/commit/b9ba6b88c1f69a9b68c02edb8e85c6e70a5dc2e3))
- feat: display username and a generic placeholder message in chat view ([#302](https://github.com/String-sg/onward/pull/302)) ([0467bff](https://github.com/String-sg/onward/commit/0467bff495e96f2c2472440de0cee3c9ecc8b323))
- feat: rename `Learning` tab to `My Learning` ([#324](https://github.com/String-sg/onward/pull/324)) ([e36e8e2](https://github.com/String-sg/onward/commit/e36e8e23628742d7f9d52719040683f2f212eb92))
- feat: add new collection types ([#322](https://github.com/String-sg/onward/pull/322)) ([b1a8407](https://github.com/String-sg/onward/commit/b1a84076ad8f48c72bbfaa0b4e0d788920ada2fe))

### Chores 🧹

- chore(deps): bump `pino` from `9.9.0` to `10.0.0` ([#327](https://github.com/String-sg/onward/pull/327)) ([c19cb53](https://github.com/String-sg/onward/commit/c19cb53b1eddb65db167253d9f094a370786f0c9))
- chore(deps): bump `nanoid` from `5.1.5` to `5.1.6` ([#326](https://github.com/String-sg/onward/pull/326)) ([83c4a93](https://github.com/String-sg/onward/commit/83c4a93fe646bde734d02110fbd1194bcaf39056))

## 0.5.0 (2025-10-14)

### Features ✨

- feat: track podcast play event ([#321](https://github.com/String-sg/onward/pull/321)) ([c37d60f](https://github.com/String-sg/onward/commit/c37d60f7c9d291dff5a2f0874b21d17bf838203a))
- feat: add recommendation section to home page ([#318](https://github.com/String-sg/onward/pull/318)) ([1f46be0](https://github.com/String-sg/onward/commit/1f46be0758fae00f447593648dd4f967e412ba39))

## 0.4.0 (2025-10-14)

### Features ✨

- feat: cache user's avatar in Valkey ([#286](https://github.com/String-sg/onward/pull/286)) ([5b67b5c](https://github.com/String-sg/onward/commit/5b67b5ce171fa3dc0cefa1d8ae3b4db6c6caa49e))

### Bug Fixes 🐛

- fix: chat window for IOS Safari ([#313](https://github.com/String-sg/onward/pull/313)) ([c1fd12c](https://github.com/String-sg/onward/commit/c1fd12c6f1798633ab8bd2241c24a7275ec9d4a9))
- fix: reposition badge on quiz ([#312](https://github.com/String-sg/onward/pull/312)) ([8bc2467](https://github.com/String-sg/onward/commit/8bc246706a4af4213d9fa8cc2068c869addbbf43))
- fix: prevent quiz page from showing chat modal ([#311](https://github.com/String-sg/onward/pull/311)) ([39a8926](https://github.com/String-sg/onward/commit/39a892633341e954d2124669ded7f5e28f48c351))

### Chores 🧹

- chore: remove spinner and time in LearningUnit for now ([#315](https://github.com/String-sg/onward/pull/315)) ([01c8643](https://github.com/String-sg/onward/commit/01c864359f1619ece6fc8ee2ad80c55d4df77171))
- chore: remove default max width from tailwind typography ([#298](https://github.com/String-sg/onward/pull/298)) ([c7f064b](https://github.com/String-sg/onward/commit/c7f064b34358d32702758b5d8a817e87611dec4d))
- chore: update `pre-push` script to just run `pnpm check` ([#299](https://github.com/String-sg/onward/pull/299)) ([8f3bd47](https://github.com/String-sg/onward/commit/8f3bd47d8a8dd0c1c74333c540700c691ec38541))

## 0.3.0 (2025-10-13)

### Features ✨

- feat(learner): remove share icon ([#289](https://github.com/String-sg/onward/pull/289)) ([1dfd52d](https://github.com/String-sg/onward/commit/1dfd52d820f8d766305158315e2294e7e16b01bf))
- feat: add markdown support for Learning Unit summary ([#274](https://github.com/String-sg/onward/pull/274)) ([17667b3](https://github.com/String-sg/onward/commit/17667b3e5131c09e9823672a9a83a0628dd73ad1))
- feat(learner): move logout button to top ([#273](https://github.com/String-sg/onward/pull/273)) ([a53d1b9](https://github.com/String-sg/onward/commit/a53d1b9352f63ae9ab8f20c60e5d21ecb623173a))

### Bug Fixes 🐛

- fix: patch `vite-imagetools` to use synchronous file writes ([#290](https://github.com/String-sg/onward/pull/290)) ([18a5728](https://github.com/String-sg/onward/commit/18a57284a4995580f4b2695d84524d6a0ccec80a))
- fix: correct naming for action ([#294](https://github.com/String-sg/onward/pull/294)) ([3098574](https://github.com/String-sg/onward/commit/309857464c9dd646b6c8fc4256d93073da2a6262))

## 0.2.2 (2025-10-09)

### Bug Fixes 🐛

- fix: remove unnecessary slash in the key when getting podcast object ([#271](https://github.com/String-sg/onward/pull/271)) ([f428eef](https://github.com/String-sg/onward/commit/f428eeff))

### Chores 🧹

- chore(learner): center text in empty state ([#270](https://github.com/String-sg/onward/pull/270)) ([f682481](https://github.com/String-sg/onward/commit/f682481))
- chore(learner): add anchor tag to home when logo and text are clicked ([#269](https://github.com/String-sg/onward/pull/269)) ([746ab9c](https://github.com/String-sg/onward/commit/746ab9c))
- chore(learner): fix typo on empty state ([#268](https://github.com/String-sg/onward/pull/268)) ([69ad2b2](https://github.com/String-sg/onward/commit/69ad2b2))

## 0.2.1 (2025-10-09)

### Bug Fixes 🐛

- fix: update dockerfile path ([#266](https://github.com/String-sg/onward/pull/266)) ([53d2e3a](https://github.com/String-sg/onward/commit/53d2e3a554aaeac0c0ae7c9d6a495346c8838c7f))

## 0.2.0 (2025-10-09)

### Features ✨

- feat(learner): add playback support for player ([#262](https://github.com/String-sg/onward/pull/262)) ([d9ffba3](https://github.com/String-sg/onward/commit/d9ffba30f22ae2ffb7ce4b25f10f649c041ae9c7))
- feat(learner): Add Podcast Completion Modal ([#258](https://github.com/String-sg/onward/pull/258)) ([fdb16dc](https://github.com/String-sg/onward/commit/fdb16dc73e17973624f7e1b2dc2d49bd08996195))
- feat(learner): add dynamic data for home page and update empty state ([#263](https://github.com/String-sg/onward/pull/263)) ([678175e](https://github.com/String-sg/onward/commit/678175e4042cbcfb8d751aac7f69e7581fe92225))
- feat(learner): Create learning journey record ([#254](https://github.com/String-sg/onward/pull/254)) ([e5801bd](https://github.com/String-sg/onward/commit/e5801bd75505607af82b931749b788999b97bc69))
- feat(learner): add avatarURL in layout and profile page ([#260](https://github.com/String-sg/onward/pull/260)) ([a192c1b](https://github.com/String-sg/onward/commit/a192c1b837d257de8afa22728e521c6a2d951fc6))
- feat(learner): update quiz completion status after finishing quiz ([#251](https://github.com/String-sg/onward/pull/251)) ([96d9099](https://github.com/String-sg/onward/commit/96d9099c2402e34d88c8f1ff9d252ed1d6bb709f))

### Chores 🧹

- chore(learner): update support email ([#264](https://github.com/String-sg/onward/pull/264)) ([a75b846](https://github.com/String-sg/onward/commit/a75b84698a74828d36c0e89623f2811ab07430d8))
- chore(learner): rename app to glow ([#261](https://github.com/String-sg/onward/pull/261)) ([79586b7](https://github.com/String-sg/onward/commit/79586b7da1cd224934288660d3986dcfee57ef83))
- refactor: revert to single-repo structure ([#259](https://github.com/String-sg/onward/pull/259)) ([fc9bab4](https://github.com/String-sg/onward/commit/fc9bab480d0107c5851f0a9acf28fa51f2e8f757))

## 0.1.0 (2025-10-06)

### Features ✨

- feat: add S3 proxy endpoint for podcasts ([#255](https://github.com/String-sg/onward/pull/255)) ([3450f78](https://github.com/String-sg/onward/commit/3450f7895f31cc36a87b5d16048fd26705d93fa4))
- feat: create favicon for glow ([#256](https://github.com/String-sg/onward/pull/256)) ([d122686](https://github.com/String-sg/onward/commit/d122686d712c6f0d8def21988079563d092719fd))
- feat: customize the Tailwind typography prose-slate for chat markdown UI ([#243](https://github.com/String-sg/onward/pull/243)) ([d2e8c73](https://github.com/String-sg/onward/commit/d2e8c73597cf7d9c07860c4e86ede1eeb70a77f1))
- feat: add `CLUSTER_HOSTNAME` env to weaviate container ([#252](https://github.com/String-sg/onward/pull/252)) ([7af4cec](https://github.com/String-sg/onward/commit/7af4cec764925021c306361fb2ea9f66940e16cd))
- feat(learner): update empty states and error page ([#250](https://github.com/String-sg/onward/pull/250)) ([28f50c4](https://github.com/String-sg/onward/commit/28f50c44a26bdf974e21fdf0cc04fc6168130c67))
- feat(learner): add dynamic `learning collection page` with content data ([#230](https://github.com/String-sg/onward/pull/230)) ([853dad7](https://github.com/String-sg/onward/commit/853dad75ab25859d86db28465bbe71470433fc4f))
- feat(learner): integrate quiz content with backend ([#238](https://github.com/String-sg/onward/pull/238)) ([18aa067](https://github.com/String-sg/onward/commit/18aa067e05293921d2fe4d7cef290190afdc8c9e))
- feat(learner): sanitize chat assistant message ([#237](https://github.com/String-sg/onward/pull/237)) ([920c626](https://github.com/String-sg/onward/commit/920c626ddc77079bb51f1bc72d324ba0f35e56ad))

### Bug Fixes 🐛

- fix(learner): use `sessionStorage` to store origin path when navigating to learning unit page ([#211](https://github.com/String-sg/onward/pull/211)) ([bba2030](https://github.com/String-sg/onward/commit/bba2030cbb46e950e107c83d31adcf5a7e62735d))

### Chores 🧹

- chore(learner): add ssl cert to docker ([#248](https://github.com/String-sg/onward/pull/248)) ([2fce719](https://github.com/String-sg/onward/commit/2fce719f8cad036deb86180b6d918dfac7698ba8))
- chore: add OpenAI env variables ([#247](https://github.com/String-sg/onward/pull/247)) ([94b9d44](https://github.com/String-sg/onward/commit/94b9d442bcf654be88a32fda1c07484d9da896c8))

## 0.0.2 (2025-09-30)

### CI 🤖

- ci: add missing permission to release workflow ([#245](https://github.com/String-sg/onward/pull/245)) ([b774ef7](https://github.com/String-sg/onward/commit/b774ef7b336ad5c13e13c8a767749aac9b8f57d3))

## 0.0.1 (2025-09-30)

### Experimental 🧪

- Initial release to validate the release workflow
- Test deployment to staging to verify image and rollout
