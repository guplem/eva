# Plan: keep the last location in `Life/About me.md` (#689)

## Goal

The hub writes the person's last location into the header of `Life/About me.md`, as `lastLocation`. Every computer reads it from there. The hub writes at most once every 15 minutes, and only after a move of more than 50 m or when the stored time is more than 6 hours old.

## Shape

```yaml
lastLocation: { latitude: 41.39, longitude: 2.17, accuracy: 30, at: "2026-01-01T09:30:00.000Z", source: telegram }
```

- `accuracy` stays, so #691 can serve the widget contract of `docs/widgets.md` (`{ latitude, longitude, accuracy, at }`).
- `source` stays, so the location card can still say where the point came from.
- One line in flow form, so a write changes one line of the note.

## Parts

1. `src/core/vault/about-me.ts`: read `lastLocation` tolerantly, and set one top-level header field in place. The rest of the header stays byte for byte. The skill and `aboutMeHeaderKeys` name the key. `readAboutMe` reports no problem for it: the code fixes it.
2. `src/core/location/last-location.ts`: a `LocationKeeper`. It keeps the newest point in memory, applies the write rules, writes only when the note did not change since the read, and moves the old instance file into the note once.
3. `src/core/vault/vault-sync.ts` and `vault-upkeep.ts`: a way to run a file edit in the sync queue, so no sync step runs at the same time.
4. `src/core/eva.ts`: only the hub writes. It writes after a new point, at each background tick, and after an Assistant turn before the snapshot after it. It never writes while another Assistant turn runs. A problem alert reaches the phone when the note is missing or its header is broken.
5. API and web: `GET /api/location` sends `latitude` and `longitude`, and still `lat` and `lon` for one release. `POST /api/location` reads both names. The card and the guide say the new home of the location.

## Gaps and decisions

- **Accuracy and source in the key.** Decided: store both (see above).
- **The 50 m rule indoors.** Decided: the move must also be larger than the accuracy radius of the new point, when the point has one.
- **The one-time copy of the old file.** A machine migration cannot write the vault, and a vault migration would stop older computers (`vault_ahead`). Decided: no migration. The hub's location code adopts the old file as its newest point in memory. The next write puts it in the note, unless the note has a newer point. Then the hub deletes the old file. So the change is not breaking.
- **The 15-minute gate after a restart.** The time of the last write lives in memory. A restart allows one write at once, but only when a rule says yes. Restarts are rare, so this costs at most one more commit.
- **A note with no header.** Eva adds a header with only `lastLocation`, as the `about-me` skill does for other fields.
- **No vault.** The point stays in memory, and no alert goes out: a hub with no vault has bigger problems that other alerts name.
- **The once-a-minute rule for a live stream.** It stays, for the point in memory, so the behavior of `saveLocation` stays.
