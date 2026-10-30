Find why each check failed, in its log: `gh run view <run-id> --log-failed`. Fix the cause in this pull request. Treat a flaky test as a bug: make it reliable. Run `npm run check`, then commit and push the fix. Never turn off a check, and never skip a test.

The failed checks: {{ steps.wait_ci.failed_checks | join('; ') }}
