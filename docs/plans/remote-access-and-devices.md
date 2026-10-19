# Plan: remote access, devices and the new-device notice in the EVE style (#177)

## Why

The remote access card, the device list and the new-device dialog still use the old look. The design (`docs/design/eve/`, section "Remote access and devices") shows step rows, a device list with icons, and a notice with EVE and the large login code. A person allows a new phone from this notice, so it must be clear on a phone too.

## What changes

- Add `client/device-words.ts`: the name, the browser and the icon of a device, from its stored label. It is plain logic, so a unit test covers it.
- `client/RemoteAccessPanel.tsx`: a globe icon, the title, "Only through Tailscale…" and a status pill. Then two step rows: "On this machine" and "On each phone or computer". Keep the link, Share, the QR code and the action buttons.
- `client/DevicesPanel.tsx`: "Log out every device" as a danger button at the top. One row per device: an icon, the name, the browser and the date. The current device has a "This one" pill instead of Remove.
- Add `client/NewDeviceDialog.tsx`: the searching face, the question, the code in the large monospace of the login page, the account, Allow and Deny. After Allow, the delighted face shows for a moment.
- `client/App.tsx`: show the new dialog, and keep it open for the delighted face after Allow.
- Add `devices.css` with the styles. A phone shows the notice as a bottom sheet.
- Update the end-to-end tests.

## Gaps and decisions

1. **Last use of a device.** Eva stores only the date when a device was allowed. A last-use date needs a write at each request, and a new stored field. Decision: show "Allowed today" or "Allowed 12 Oct". Write the gap in the PR.
2. **Device name and browser.** The stored label is "account, user agent". Decision: read the system and the browser from the user agent, such as "iPhone" and "Safari". The detail line shows the browser, the account and the date. An unknown label shows "Device" and the label text.
3. **Remove for the current device.** The issue says "This one" replaces Remove. The Log out button of Settings logs out this browser, so nothing is lost. Decision: no Remove on the current device. Replace the end-to-end test that removed it.
4. **Status pill words.** Decision: "Connected" (done) when the address works, "Failed" when Tailscale fails, and "Needs you" otherwise.
5. **"On this machine" when not ready.** Decision: the row shows the mark of the step, and the numbered setup steps with their action buttons below it, as today.
6. **Delighted face time.** Decision: 1.5 s, then the notice closes. A failed answer closes it at once and shows the error.
7. **Layout on a computer.** The design puts the two cards side by side. Decision: keep one column, as every other Settings page. The Access page has four cards, and two columns would break the order of the search links.
