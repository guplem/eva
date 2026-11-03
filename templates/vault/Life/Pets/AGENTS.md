# Pets

One folder for each pet of the person.

**Name:** each pet is a folder `Life/Pets/<Name>/`. Add the birth year when two pets share a name, such as `Luna 2020`. The main file is `Pet.md`.

```yaml
---
species: dog
breed: Border collie
birth: 2020-08-01 # YYYY-MM-DD, or YYYY when only the year is known
chip: "941000012345678" # the microchip number, in quotes
vet: Example Vet Clinic
aliases: [Luna, Lunita]
summary: Border collie. Allergic to chicken.
---
```

- **A pet has no `contact`.** Its vet is plain text, or a link to a folder in `Life/People/`.
- **The text under the front matter** holds care facts: food, medicines, vaccines, habits.
- **Beside `Pet.md`:** the vet records, the vaccine card, photos, adoption papers, and the pet's insurance.

**Not here:**

- A long matter, such as a surgery or a search for a lost pet → `Life/Cases/`, with `about:` linking the pet.
- How to train or care for a kind of animal in general → `Library/` or `Methods/`.

**Closing:** a pet has no status. When a pet dies or leaves, write it with its date in `summary`. Never move or delete the folder.
