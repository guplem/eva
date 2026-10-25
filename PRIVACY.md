# Privacy

Eva is a program that each person runs on a computer of their own. Nobody runs a central Eva service, so no company or developer receives your data through Eva.

## Google data

When you connect Eva to your Google account, Eva reads and, when you allow it, changes your Calendar, Drive, Contacts and Tasks. She does this only to answer your own requests.

- **Storage:** your Google login stays on your own computer, in Eva's home folder. Eva keeps no copy of your Google data, except what you ask her to save in your own vault, your private folder of notes.
- **AI provider:** Eva sends the Google data that a request needs to the AI service that you chose, such as Claude or ChatGPT, with your own account. That provider's privacy policy applies to it.
- **Sharing:** Eva gives your Google data to nobody else, and never sells or uses it for ads.
- **Removal:** remove Eva's access at any time in your Google account, under [Third-party connections](https://myaccount.google.com/connections).

## Location

When you share your location, Eva keeps the last one, so that scripts on your computer, such as a weather forecast, can use it.

- **Sources:** a location that you share with Eva's bot in Telegram, or the location of a device where you turn it on in Eva's web page.
- **Storage:** Eva keeps only the last location, in `state/location.json` in her home folder on the hub computer. It never goes into your vault or its history.
- **Sharing:** Eva sends your location to nobody. A script that you run decides what it does with it.
- **Removal:** stop the sharing in Telegram, or turn it off on the device. Delete `state/location.json` to remove the last location.

## Contact

Open an issue in [this repository](https://github.com/guplem/eva/issues).
