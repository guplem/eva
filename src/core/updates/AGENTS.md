# Updates

- The release key has two halves: the `EVA_RELEASE_SIGNING_KEY` repository secret and `releasePublicKey`. Change both together.
- Never push a `v*` tag by hand. The release workflow picks each version from the commit prefixes.
- To raise the version by hand, such as to `1.0.0`, set it in `package.json`. The next release uses it.
- Install an update only when no chat runs a turn.
- A source checkout only fast-forwards.
- The update policy reads only the version numbers. A breaking change must raise the major number, even before 1.0.
