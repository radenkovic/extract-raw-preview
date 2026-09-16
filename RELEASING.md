# Releasing

[`extract-raw-preview`](https://www.npmjs.com/package/extract-raw-preview) is published to npm from GitHub Actions. Version numbers and `CHANGELOG.md` come from [Changesets](https://changesets.dev). Do not bump `package.json` by hand.

## Routine release

1. On the feature branch, record the bump:

   ```bash
   npx changeset
   ```

   Pick **patch** (fix), **minor** (new format or API), or **major** (breaking). Write a summary in the past tense; it becomes the changelog line.

2. Commit the file under `.changeset/` with the rest of the PR.

3. Merge the PR to `main`. The [Release](.github/workflows/release.yml) workflow opens (or updates) a **Version packages** PR. That PR runs `changeset version`: it deletes the changeset files, bumps `package.json`, and prepends `CHANGELOG.md`.

4. Merge **Version packages**. The same workflow runs `changeset publish`, tags the commit, creates a GitHub Release, and publishes to npm with provenance.

Tooling-only PRs (CI, docs, deps) should not bump the package. Use `npx changeset add --empty` if you want to record that explicitly. An empty changeset alone does **not** open a Version packages PR and does **not** publish.

## One-time setup

These are already described in GitHub and npm UIs. Both are required before a Version packages PR can land and before CI can publish.

### GitHub

Actions must be allowed to open the Version packages PR. This is **off** by default on new personal repos.

1. Open [Settings → Actions → General](https://github.com/radenkovic/extract-raw-preview/settings/actions) (not Runners).
2. Scroll to **Workflow permissions**.
3. Check **Allow GitHub Actions to create and approve pull requests**.
4. Save.

Leave the default token permission as-is. The workflow already requests `contents: write` and `pull-requests: write`.

### npm trusted publisher

Later publishes use GitHub OIDC. No `NPM_TOKEN` secret. The package must **already exist** on npm before you can attach a trusted publisher, so do this **after** the first publish below.

On [the package settings](https://www.npmjs.com/package/extract-raw-preview) → **Trusted publishing**:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `radenkovic` |
| Repository | `extract-raw-preview` |
| Workflow filename | `release.yml` (filename only, not a path) |
| Environment | leave empty |
| Allowed actions | `npm publish` |

The workflow name, branch (`main`), and filename must match exactly. Wrong workflow name is a common 404 on publish.

## First publish (`0.1.0`)

npm trusted publishing cannot create a package. Publish `0.1.0` once from a logged-in machine, then add the trusted publisher.

```bash
npm login
npm run check
npm publish --access public --no-provenance
```

`--no-provenance` is required locally: `publishConfig.provenance` is for CI OIDC. `prepublishOnly` builds `dist/` before the tarball is packed.

After npm shows `extract-raw-preview@0.1.0`, add the trusted publisher table above. Every later version goes through the routine flow, with provenance.

## Commands

| Command | When |
| --- | --- |
| `npx changeset` | User-facing change that should ship |
| `npx changeset add --empty` | Change that must not bump the version |
| `npx changeset status` | See pending bumps vs `main` |
| `npm run release` | `changeset publish` (CI after a Version packages merge) |

## If something fails

- **Version packages PR never appears.** The only changeset on `main` is empty, or Release did not run on the merge. Check the [Release workflow](https://github.com/radenkovic/extract-raw-preview/actions/workflows/release.yml). Enable the GitHub checkbox above if the log mentions creating or approving pull requests.
- **Publish 404 / ENEEDAUTH in CI.** The package is missing, the trusted publisher is missing, or the workflow filename does not match. First version must be published locally; later versions need the trusted publisher row.
- **Provenance error on a laptop.** Use `--no-provenance` for that one local publish. Do not turn off `publishConfig.provenance` in git.
