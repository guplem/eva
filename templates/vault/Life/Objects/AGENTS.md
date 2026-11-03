# Objects

An object is a thing that the person owns or uses, even when someone else owns it: a car, a phone, a bike, a home, a rented flat.

**Name:** each object is a folder `Life/Objects/Type - Model - ID/`. The main file is `Object.md`.

- **Type** is a common English noun, such as `Car`, `Phone` or `Home`. **Model** is the brand and the model. For a home, it is the short address.
- **ID** is the plate or the serial number. Of an IMEI or a MAC address, use only the last 4 characters. With no ID, use the year of purchase, or the year the person moved in.

```yaml
---
status: in-use # in-use, stored, lent, sold or gone
type: car
owner: Life/People/Sam Example # empty when the person owns it
ids: { plate: 1234ABC, vin: EXAMPLEVIN0000000 }
aliases: [the car, the blue car]
summary: Sam's car. The insurance ends on 2027-03-01.
---
```

- **Beside `Object.md`:** photos, manuals, warranties, invoices, and each contract that it regulates, such as car insurance, the rent or the utilities.
- **A password goes beside what it opens,** in a file that Eva encrypts, such as `Wi-Fi.secrets` in the home folder.
- **Nest only what stays when the person moves.** A home holds `Fixtures.md` for the landlord's appliances. A thing that the person would take along, such as a printer, gets its own folder in `Life/Objects/`.

**Not here:**

- A repair, a claim or a return that needs follow-up → `Life/Cases/`, with `about:` linking the object. A finished repair → a dated line here.
- A subscription or a phone line → `Life/Finances/`.

**Closing:** when the object is sold, lost or thrown away, set `status: sold` or `status: gone`, and put the date in `summary`. Never move or delete the folder.
