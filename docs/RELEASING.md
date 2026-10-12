# Release checklist

Main-branch pushes run backend checks and rebuild/test the patched web tree.
Version-tag pushes also publish prerelease images and their matching source.
Only tag reviewed commits. GitHub Actions needs permission to publish packages;
make both GHCR packages public after their first publication so TrueNAS can pull
them without credentials. The workflow publishes only linux/amd64 initially.

Before a tag:

1. Run backend checks, the focused Community tests, typecheck and production
   build. Confirm the patch applies to the exact pinned upstream source.
2. Review current dependency/security advisories. The older verification record
   is not a current security pass. Resolve material findings before exposing
   the build publicly as a production service.
3. Confirm no credentials, configuration databases, messages, logs, backups or
   private server details are tracked. Keep source licences and attribution.
4. For production promotion, complete the TrueNAS guide's live checks and
   backup/restore gate. Requests additionally require the Seerr live gate.

After a reviewed version tag is pushed, the release workflow:

- Publishes the complete modified web/dependency source, backend dependency
  source and this repository's build/deployment source as release assets.
- Publishes two versioned images only after those source assets are available.
- Attaches `IMAGES.txt` with the immutable digests for the TrueNAS template.

All automatically created releases are prereleases until manually reviewed.
Do not deploy a source-only tag or a partial/failed workflow as a release.
Retain the source assets while images remain available. A failed release can
leave source assets or one image available; inspect and finish both images
before deployment. There are no automatic NAS upgrades or domain switches.

GitHub Actions are pinned to exact upstream commits resolved during preparation.
Review their updates explicitly rather than replacing pins with moving tags.
