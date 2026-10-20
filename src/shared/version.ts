/** Eva's version, from `package.json`, which the release workflow checks against the tag. */
import packageJson from "../../package.json" with { type: "json" };

export const evaVersion: string = packageJson.version;

/** Eva's own GitHub repository: the source of her updates, and the reference of the setup report. */
export const evaRepository = "guplem/eva";
