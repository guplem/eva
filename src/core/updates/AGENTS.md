# Updates

- The release key has two halves: the `EVA_RELEASE_SIGNING_KEY` repository secret and `releasePublicKey`. Change both together.
- A `v*` tag must equal the `package.json` version.
- Install an update only when no chat runs a turn.
- A source checkout only fast-forwards.
