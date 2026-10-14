# Owner to-do

Steps that only the owner can do. The implementing agent adds a line when it reaches such a step, and continues with fakes. Tick a line when it is done.

## Machines

- [ ] **Server laptop:** turn it on, then stop and disable the v1 service (`systemctl --user disable --now walli-server`), point its clone at the vault (`git -C ~/Wall-I remote set-url origin git@github.com:guplem/vault.git`), and push any notes it holds.
- [ ] **Other machines with a vault clone:** list them, and point each one at `guplem/vault`.

## Logins and tokens

- [ ] **Claude login on this PC:** the standalone `claude` is not logged in (the desktop app uses its own login). Run `claude` once and log in, or run `claude setup-token` and give the token to Eva in `eva setup`.

## Decisions with a default

- [ ] **`online-sync`:** its own project, or part of Ghana Ludo (default)?
