# Changesets

Versioning and changelog entries for this package are managed with [`@changesets/cli`](https://github.com/changesets/changesets). Read the documentation at [changesets.dev](https://changesets.dev).

On a branch that should land in a release:

```bash
npx changeset
```

That writes a markdown file in this folder. Merging to `main` opens a Version packages pull request; merging that PR publishes to npm.
