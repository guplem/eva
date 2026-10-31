/**
 * A vault key for tests (#707). A vault with no key raises the "no password" alert, which a test of
 * other alerts does not expect. The low scrypt cost keeps each test fast.
 */
import { createVaultKey } from "../../src/core/vault/vault-crypto.ts";

export const testVaultPassword = "a long test vault password";

/** The text of `.eva/vault-key.json`, the same for every test. */
export const testVaultKeyText = `${JSON.stringify(await createVaultKey(testVaultPassword, { logN: 10 }), null, 2)}\n`;
