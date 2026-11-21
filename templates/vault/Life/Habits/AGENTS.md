# Habits

The habits that the person tracks day by day, of any kind: reading, exercise, meditation, a behaviour to keep or to stop.

- **One JSON file for each habit,** such as `read.json`. The name is the habit's name in lowercase, with ASCII letters, digits and hyphens only. Never `index.json`.
- **The Habits widget of the home page reads and writes these files.** When the widget is on, Eva writes `DATA_FORMAT.md` in this folder. Read it before you write a habit file, and follow it.
- **Keep each field that you do not know.** Read the file, change your fields, and write the whole object back.
- **When the person says that they did a habit,** add a check for that day to its file.
- **Before you create a habit file, ask the person once.**

**Not here:**
- The steps of a routine or a training plan → `Methods/`. A habit file can name the method in its `note`.
- A health goal, a measurement or a condition → `Life/Health/`.
- A one-off task or a reminder → the task app or the calendar.
