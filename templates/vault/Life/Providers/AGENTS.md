# Providers

A provider is a business or a self-employed person that serves the person: the car workshop, the plumber, the dentist's clinic, the hair salon, the tax adviser, the vet. The note keeps what the person knows about the service: who to ask for, prices paid, and whether it went well. The maps app keeps the place. The note links it with `maps`.

**Name:** each provider is a folder with `Provider.md`.

- **A business:** `Life/Providers/<Trade name>/`, such as `Life/Providers/Example Garage/`.
- **A self-employed person with no trade name:** `Life/Providers/<Full Name> - <Service>/`, such as `Life/Providers/Joan Example - Plumber/`. The service in the name tells this folder apart from the folder of the same person in `Life/People/`.

```yaml
---
service: car workshop # what they do for the person, in plain words
status: current # current or former
address: Example Street 1, 00000 Example City # optional
contact: https://contacts.google.com/person/c1234567890 # optional: their entry in the contacts app
maps: https://maps.app.goo.gl/example # optional: the place in the maps app
people: [Life/People/Alex Example] # optional: each person of the provider with a folder in Life/People/
aliases: [the workshop] # optional
summary: The car's workshop since 2025. Fair prices, slow with parts.
---
```

- **`status`** is `current` while the person uses the provider. It is `former` when the person stops. Write the reason as a dated line in the text, such as `- 2026-03-02: too expensive.`
- **A verdict** is one dated line in the text that says what the provider did and whether it went well, such as `- 2026-11-14: haircut, 18 €. Good.`

**What goes here:**

- **Create a folder as soon as the person names a provider, even with only a name and a contact.** The fact "this is my workshop" is already useful. Ask no question to fill the other keys.
- **The text under the front matter holds the service:** how to book, opening hours, who to ask for and a customer number. Add one verdict for each visit or job.
- **Beside `Provider.md`:** a price list, a quote or a business card.

**The provider and its people.** One fact lives in one file:

- **A business with staff:** the business has a folder with `Provider.md`. Each staff member who the person deals with by name gets a `Person.md` in `Life/People/`, with `relation: <role> at Life/Providers/<Name>`. The provider lists them in `people`. So each file links the other.
- **A self-employed person always has both folders.** `Person.md` holds only what is personal: tastes, family, how the two get on. `Provider.md` holds the service: prices, jobs and verdicts. `Person.md` names the provider in `relation`, and the provider lists the person in `people`.
- **When a fact fits both files, treat it as a fact about the service.** Put it in `Provider.md`.

| Situation | Folders | What goes where |
| --- | --- | --- |
| The hair salon Example Salon, where the person always asks for Sam Example | `Life/Providers/Example Salon/Provider.md` and `Life/People/Sam Example/Person.md` | Provider: address, how to book, price of a haircut, verdicts. Person: `relation: hairdresser at Life/Providers/Example Salon`, a nickname, a football team. |
| The self-employed plumber Joan Example | `Life/Providers/Joan Example - Plumber/Provider.md` and `Life/People/Joan Example/Person.md` | Provider: jobs, prices, "comes within 24 hours", verdicts. Person: `relation: plumber at Life/Providers/Joan Example - Plumber`, "has two kids, likes cycling". |
| Example Garage repaired the brakes of the car | `Life/Providers/Example Garage/Provider.md` | The repair is a dated line in the car's `Object.md` that names `Life/Providers/Example Garage`. Do not copy the line into `Provider.md`. A search for the path finds every job. |
| A dispute with the workshop over a repair | A case in `Life/Cases/` | The case links the provider and the object. When the case closes, add one verdict to the provider. |
| The dentist's clinic Example Dental | `Life/Providers/Example Dental/Provider.md` | The clinic and how to book go here. Treatments and results go to `Life/Health/`, or to a case while they go on. |

**Not here:**

- A place to visit some day, such as a restaurant to try → the maps app.
- A company that serves one thing through a contract, such as the car insurer or the electricity company → the folder of that thing in `Life/Objects/`.
- A bank, a subscription or the phone operator → `Life/Finances/`.
- An employer → `Life/Periods/`.
- A client → the project in `Projects/`.
- A repair or a treatment → the note of what it was about: the object, `Life/Health/` or a case.

**Closing:** when the person stops using a provider, set `status: former`, and write the reason with its date. Never move or delete the folder.
