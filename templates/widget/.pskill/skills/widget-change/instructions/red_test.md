Write a test that fails now and passes once the change is done.

- A change of what the widget shows or does gets a Playwright test in `tests/*.spec.js`. Use the helpers of `tests/helpers.js`: `fakeWrites` for a write, and `fakeEvaLocation` for Eva's location.
- A change of `scripts/check-widget.js` gets a test in `tests/*.test.js`.
- A change of the docs or of the config only needs no test. Then return an empty list.

Run `npm test`, and check that the new test fails for the right reason.
