/** Eva's version, from `package.json`, which the release workflow checks against the tag. */
import packageJson from "../../package.json" with { type: "json" };

export const evaVersion: string = packageJson.version;
