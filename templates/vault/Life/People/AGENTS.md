# People

One folder for each person who matters to the person.

**Name:** a folder `Life/People/<Full Name>/` with `Person.md`. Nicknames, and how the person calls them, such as "mum", go in `aliases`.

```yaml
---
contact: https://contacts.google.com/person/c1234567890 # optional: their entry in the contacts app
relation: cousin of Life/People/Marta Example # see the rules below
aliases: [Sam, Sammy] # optional
summary: Lives in Berlin. Vegetarian.
---
```

**`relation`** says who they are to the person, in plain words:
- **Family:** the name of the bond, such as `mother`, `brother` or `aunt`. Add the side when it helps: `aunt, mother's side`.
- **Through someone else:** the bond, then `of`, then the path of that person's folder: `partner of Life/People/Marta Example`, `sister of Life/People/Alex Example`.
- **Work:** the role and the place: `colleague at Example Corp`, `manager at Example Corp`.
- **Others:** `friend`, `neighbour`, `doctor`. Add where from when it helps: `friend from university`.
- **When it changes,** such as a colleague who becomes a friend, update it and keep the old one as a dated line.

**What goes here:**
- **Everything the person knows about them** except contact data: tastes, allergies, gift ideas, history, and agreements made with them, such as a rule a couple sets.
- **Short facts go under the front matter.** A long or repeated kind of note goes beside it, such as `Gift ideas.md`, or in a subfolder, such as `Meetings/`.
- **Something about several people at once,** such as a family tradition, goes in a note directly in `Life/People/`, such as `Life/People/Family Christmas.md`, linked from each of them.
- **Create a folder as soon as there is something to keep** beyond the contact data.

**Not here:**
- Phone, email, address and birthday → the contacts app. Eva reads them through `contact`.
- A day spent together → `Life/Diary/`.
- A pet → `Life/Pets/`.
- A matter with steps, such as organizing a party for them → `Life/Cases/`. The case links their folder in its text.
- Day-to-day work with a colleague → the employer's folder in `Projects/`.

**Closing:** a person has no status. When a relation changes or ends, update `relation` and `summary`. Never move or delete the folder.
