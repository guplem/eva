# 775: one way to change the vault password

Issue: #775. The issue went through two reviews, so its gaps are filled there.

## Plan

1. **Key chain** (`src/core/vault/vault-crypto.ts`): `VaultKeyFile` gets an optional `chain`, a list of older keys. Each link holds an older key's two public keys and its Ed25519 signature over the next key's public keys. `chainTrusts(file, fingerprint)` checks the links from the trusted key to the current one. The list keeps the last 20 links.
2. **Reading** (`src/core/vault/secret-state.ts`): the schema reads `chain` tolerantly. A bad chain counts as none.
3. **Trust** (`src/core/vault/vault-secrets.ts`): a key that changed but that the chain trusts is no change. The next round pins it.
4. **One change** (`src/core/vault/vault-encryption.ts`): `changePassword` makes a new key, signed by the old one, after a pull that works. `newKey` stays as the same call, for an older page. `rewrapVaultKey` goes.
5. **The route and the page**: `change-password` answers as `new-key` does, and the page forgets its unlock. One form. The key-changed texts say that someone else may have changed the key.
6. **The guide**: "Encrypted files" says what a change does, and that a leaked password needs new secrets.

## Decisions

- The issue's assumptions stand: one form, a pull that works first, all or nothing, the `new-key` route kept.
- The chain signs `"eva vault key v1\n" + publicKey + "\n" + signingKey` of the next key, so a signature cannot serve another record.
- A trusted key's position anywhere in the chain counts, so a computer that missed several changes trusts the newest key.
