# Add tag

A reusable JavaScript action for GitHub.com. It creates an annotated tag at a full commit SHA without requiring `actions/checkout`. There are no runtime dependencies or build steps.

If a tag already resolves to the requested commit, the action succeeds and leaves it untouched. If it resolves to another commit or another object type, the action fails. Existing lightweight and annotated tags are both supported.

## Usage

Replace `OWNER/action-add-tag@v1` with the published location and version of this action.

```yaml
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: OWNER/action-add-tag@v1
        id: tag
        with:
          tag: v1.2.3
          commit_sha: ${{ github.sha }}
      - run: echo "Run release steps here"
```

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `tag` | Yes | | Git tag name without `refs/tags/` |
| `commit_sha` | Yes | | Full 40-character commit SHA in the target repository |
| `repository` | No | `${{ github.repository }}` | Target `owner/repo` |
| `token` | No | `${{ github.token }}` | Token with contents write access to the target repository |
| `message` | No | Tag name | Annotated tag message |

Tags use name `github-actions[bot]` and email `41898282+github-actions[bot]@users.noreply.github.com` as the tagger.

For another repository, supply a token with access to that repository; the default workflow token is scoped to its own repository:

```yaml
- uses: OWNER/action-add-tag@v1
  with:
    tag: v1.2.3
    commit_sha: 0123456789abcdef0123456789abcdef01234567
    repository: another-owner/another-repo
    token: ${{ secrets.TARGET_REPOSITORY_TOKEN }}
```

Outputs: `created` is `true` only when this invocation created the tag reference, otherwise `false`; `commit_sha` is the lowercase target SHA.

## Cleanup

The native post-job hook runs on job failure or cancellation. It deletes the tag reference only if this invocation successfully created it. Existing tags and tags created by competing invocations are never marked for cleanup. As requested, cleanup does not check whether a tag was subsequently moved or replaced. A tag already deleted is treated as successful cleanup.

Cleanup is best effort: a terminated runner, forced cancellation, loss of API access, or interruption between remote creation and recording its success can prevent deletion. Errors during deletion fail the post step. Removing a reference does not delete the underlying annotated Git object.

The action uses Node.js 24. Run the unit tests with `node --test`. Tests mock GitHub requests; they do not create tags in a live repository.
