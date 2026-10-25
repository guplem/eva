# Updates

- The release key has two halves: the `EVA_RELEASE_SIGNING_KEY` repository secret and `releasePublicKey`. Change both together.
- Never push a `v*` tag by hand. The release workflow picks each version from the commit prefixes.
- To raise the version by hand, such as to `1.0.0`, set it in `package.json`. The next release uses it.
- Install an update only when no session runs a turn.
- Only fast-forward a git checkout of Eva's source.
- Never change the release asset names (`assetNameFor`), the `SHA256SUMS` format or the release key unless an older Eva can still update. Otherwise the person must install Eva again by hand.
