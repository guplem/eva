/** The arm64 `apply-seccomp` helper. Only an arm64 Linux build loads this file, so only it carries the helper. */
import helper from "@anthropic-ai/sandbox-runtime/vendor/seccomp/arm64/apply-seccomp" with { type: "file" };

export const helperPath = helper;
