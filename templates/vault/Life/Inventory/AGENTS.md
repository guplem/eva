# Inventory

An item is something that the person has or uses, even when someone else owns it. It can be physical or digital, a product or a service. One question decides: "do I have it or use it?" A car, a home, a phone, a passport, a software licence, a streaming subscription, a gym membership, the phone line, a bank account, a card, an investment, a pension plan, a loan and health insurance are all items.

**Name:** each item is a folder `Life/Inventory/Type - Name - ID/`. The main file is `Item.md`.

- **Type** is a common English noun, such as `Car`, `Phone`, `Home`, `Passport`, `Software`, `Streaming`, `Gym` or `Bank account`.
- **Name** is the brand and the model, or the name of the product. For a home, it is the short address.
- **ID** is the plate or the serial number. Of an IMEI, a MAC address, an account number or a card number, use only the last 4 characters. With no ID, use the year of purchase, the year the person moved in, or the year the contract started.

```yaml
---
kind: thing # thing, document, licence, subscription, membership, line, account, card, investment, pension, loan or insurance
status: in-use # in-use, stored, lent, sold, ended or gone
type: car
owner: Life/People/Sam Example # empty when the person owns it
ids: { plate: 1234ABC, vin: EXAMPLEVIN0000000 }
aliases: [the car, the blue car]
summary: Sam's car. The insurance ends on 2027-03-01.
---
```

```yaml
---
kind: subscription
status: in-use
type: streaming
provider: Example Stream # optional: the company behind the item
cost: { amount: 9.99, currency: EUR, every: month } # optional: what the item costs each period
renews: 2027-01-15 # optional: the next day the contract renews or ends
summary: Streaming service, shared with Life/People/Sam Example. Cancel in the app settings.
---
```

- **`kind`** says how the person has the item:
  - `thing`: a physical thing, such as a car, a phone or a home.
  - `document`: a passport, an ID card or a will.
  - `licence`: software, a game or other content, bought once.
  - `subscription`: a service paid each period, such as streaming, cloud storage or a software plan.
  - `membership`: a gym, a club or an association.
  - `line`: a phone line. The internet line of a home goes in the home's folder.
  - `account`, `card`, `investment`, `pension`, `loan` and `insurance`: a money product or a policy. A loan or a policy for one thing, such as a car loan or the home insurance, is a contract of that thing instead.
  - When no kind fits, write a new lowercase word, and use the same word for each item of that kind.
- **`type`** is the type of the folder name in lowercase, such as `car` or `streaming`.
- **`owner`** is empty when the person owns the item, also with someone else, such as a joint account. The text then names each co-owner by path.
- **`status`** is `in-use` while the person has or uses the item. `stored` and `lent` are for a thing that waits. `sold` and `gone` are for a thing that left. `ended` is for a contract, a subscription or an account that ended.
- **`provider`** is the company behind the item, such as the bank, the insurer, the phone operator or the streaming service. Write it as plain text. When the company has a folder in `Life/Providers/`, such as the gym, write its path.
- **`cost`** is a cost that repeats. `amount` is a number. `currency` is a three-letter code, such as `EUR` or `USD`. `every` is `day`, `week`, `month` or `year`. Eva adds the `cost` of each item that is not `sold`, `gone` or `ended` to answer what the person spends, so never keep a separate list of costs.
- **A thing with contracts that cost money,** such as a home with its rent and electricity, has a list in `cost`. Each entry names its contract in `for`, such as `cost: [{ for: rent, amount: 850, currency: EUR, every: month }, { for: electricity, amount: 60, currency: EUR, every: month }]`.
- **A price paid once** is a dated line in the text, such as `- 2024-03-10: bought for 49 EUR at Example Software.`
- **`renews`** is the next day when the contract renews or ends. Update it after each renewal.

**What goes here:**

- **The text under the front matter** holds what the person needs to use the item: how to cancel, the last digits of a policy number, the people who share it.
- **Beside `Item.md`:** photos, manuals, warranties, invoices, the contract, and each contract that the item regulates.
- **The contract follows what it gives access to.** The car insurance, the car loan, the rent, the mortgage, electricity and the internet at home go in the folder of the car or the home. A pet's insurance goes in the pet's folder in `Life/Pets/`.
- **One tool is one item, however the person pays for it.** A software plan paid each month is an item with `kind: subscription`. When the person changes from a licence to a plan, keep the folder and change `kind`.
- **A secret of the item goes where _Where a secret goes_ in the root `AGENTS.md` says.** A login, the recovery codes of an account, a card PIN, a full card number, the Wi-Fi password and a door code go in the password manager, when the person has one. A software key, a certificate or a wallet file goes in a `.secrets` file beside `Item.md`, which Eva encrypts, such as `Licence.secrets`. Never write a secret in `Item.md`. `Item.md` says where each secret is, such as "The PIN is in the password manager."
- **The password manager is an item too.** Its recovery kit goes on paper and in `Recovery kit.secrets` beside its `Item.md`, never inside the manager. `Item.md` says where the paper copy is.
- **Software links where its installer lives,** such as the download page or the file in the cloud drive. With the key beside it, the folder holds all that a reinstall needs.
- **What is needed in a hurry on a device without Eva lives in the cloud drive,** as _Outside the vault_ in the root `AGENTS.md` says. This covers the scan of a passport or an insurance card, and quick data that is not secret, such as an IBAN. `Item.md` links it and never copies it. A key, a PIN or a full card number still goes where _Where a secret goes_ says.
- **A card gets its own item.** Its text links the account that it draws from by its path, such as `Life/Inventory/Bank account - Example Bank - 1234`.
- **A goal of an account, such as a sum to keep,** is a line in its `Item.md`.
- **Nest only what stays when the person moves.** A home holds `Fixtures.md` for the landlord's appliances. A thing that the person would take along, such as a printer, gets its own folder in `Life/Inventory/`.

**Not here:**

- A matter with steps that ends, such as a repair, a claim, a return, a refund, saving for a home, or an investment plan to carry out → `Life/Cases/`. The case links the item's folder in its text. When a case creates an item, such as a fund or a new account, create the item, and link the case in its text.
- A finished repair → a dated line here. When a provider did the repair, the line names the provider by its path, such as `- 2026-05-20: new brakes at Life/Providers/Example Garage, 240 €.`
- A business that the person deals with in person, such as the workshop, the gym or the shop that serves the thing → `Life/Providers/`. The item names it by its path in `provider`, and the provider's text links the item.
- A thing of someone else that the person does not use → a line in its owner's `Person.md`.
- How the person decides money matters, such as an investing method → `Methods/`.
- A single payment reminder → the task app.

**Closing:** when the person sells it, loses it, throws it away or ends its contract, set `status: sold`, `gone` or `ended`, and put the date in `summary`. Never move or delete the folder.
