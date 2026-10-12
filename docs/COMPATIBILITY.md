# Compatibility manifest

Recorded 2026-09-14. Digests are multi-platform manifest digests; deployments should also record the selected platform digest.

2026-10-12 publication preparation: the table below records the original build
baseline, not production certification. The local community stack and its
classic/modern browser features were subsequently tested; see VERIFICATION.md.
NAS playback, backup restoration and live Seerr requests remain pending. The
NAS template deliberately leaves requests disabled. Never infer current
dependency security from the original audit results.

| Component | Version / immutable source | Container manifest | Evidence |
| --- | --- | --- | --- |
| Jellyfin Web | v12.0 / `0e83c6a724b31f3e9b5a499244331a288c060a4a` | built locally | Typecheck and production build passed; live browser gate pending |
| Jellyfin Server | v12.0 / `6c073e19ddf604b2369c638716164fdab4c952dc` | `ghcr.io/jellyfin/jellyfin:12.0@sha256:74f4d87d9cf262c52d62be6be265c0355c6a7e21d0477ab6c654a49a4f8b1fd4` | Proposed; mocked only |
| Seerr | v3.4.1 / `69f73a6f1486fdb51b8ddae9a94a8dfb629f461c` | `ghcr.io/seerr-team/seerr:v3.4.1@sha256:f4768de5f616248d723e05891f3345a1402123775d03bf0890dbfedc0831bda1` | Proposed; mocked only |
| Sonarr | v4.0.19.2979 / `4ff1b780010d3d9ec76a4864dce96b6494e9caea` | externally managed | Proposed; not integrated |
| Radarr | v6.3.0.10514 / `7827e5368947f158ad06f757334f5cde6c406411` | externally managed | Proposed; not integrated |
| Node | 24.11.0, npm 11.6.1 | slim `sha256:76d0ed0ed93bed4f4376211e9d8fddac4d8b3fbdb54cc45955696001a3c91152`; full `sha256:e5bbac0e9b8a6e3b96a86a82bbbcf4c533a879694fd613ed616bae5116f6f243` | Successful builds/tests |
| Caddy | 2.10.2 | `sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d` | Compose parsed; stack not live-tested |

Jellyfin Web's `.nvmrc` says Node 24, but its v12.0 lock includes a package requiring Node 24.11.0 or newer. This project therefore pins 24.11.0.
