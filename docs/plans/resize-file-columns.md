# Resize the columns of Files

Issue: #626.

## Goal

The person drags the divider between two columns of the Files page to make the column at its left wider or narrower.

## Decisions

- Each divider changes only the column at its left. The person decided this.
- The widths live in the state of the Files page, by path. A reload forgets them. The person decided this.
- The divider is a child of each folder column. It sits in the gap at the right of the column, so the layout does not change.
- The divider is a `role="separator"` with a value, so a screen reader reads the width. The arrow keys move it by 16 px.
- A double click gives the column its usual width again.
- A column keeps the minimum of `.files-pane`: 180 px.
- The width is a CSS variable on the column. The one folder view keeps its own rule, which wins over the variable.
- A phone, the one folder view and the large file mode hide the divider.
- No shared divider component exists. The new one lives in its own file, so another page can reuse it.

## Gaps

None left: the person answered the two open choices, and the code gives the rest.
