---
# The basic identity of the person, for Eva and her scripts. The about-me skill says how to fill each field.
pinned: full # full, summary or false. full: Eva reads this whole note in every Assistant chat
summary: # one line about the person, which Eva reads when pinned is summary
name: "{{nameInQuotes}}"
givenName:
familyName:
aliases: # other names people call the person, such as [Lex]
pronouns:
birthDate: # YYYY-MM-DD
contact: # the person's own phone and email
places: # home is the main home, with city, address, region (ISO 3166 code such as US or US-CA, it picks the local days), lat and lon. Another residence gets its own key
work: # a list of the open jobs and studies. Each has period (a link to Life/Periods/) and its work hours from, to and days
languages: # each with a level, such as native or B2
# Eva's code fills lastLocation from your phone. Keep it as it is.
lastLocation:
---

# About {{name}}

This note holds only the basic identity of {{name}}. Everything else has its own place, as `AGENTS.md` says.

## Main topics

{{topics}}
