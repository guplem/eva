import { describe, expect, test } from "bun:test";
import {
  cleanGoogleClientId,
  cleanGoogleClientSecret,
  googleClientIdProblem,
} from "../../../../src/core/google/google-client.ts";

const id = "123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com";

describe("a pasted Google client id (#323)", () => {
  test("loses what a phone or a page adds around it", () => {
    expect(cleanGoogleClientId(id)).toBe(id);
    expect(cleanGoogleClientId(`https://${id}/`)).toBe(id);
    expect(cleanGoogleClientId(`http://${id}`)).toBe(id);
    expect(cleanGoogleClientId(`  "${id}"  `)).toBe(id);
    expect(cleanGoogleClientId(`'${id}'\n`)).toBe(id);
  });

  test("is refused, with what a client id looks like, when it is still not one", () => {
    expect(googleClientIdProblem(id)).toBeNull();
    for (const wrong of ["", "GOCSPX-a-secret", "abc.apps.googleusercontent.com", `${id}/extra`, "my-project-123"])
      expect(googleClientIdProblem(wrong)).toContain(".apps.googleusercontent.com");
  });

  test("a secret loses spaces and quotes around it", () => {
    expect(cleanGoogleClientSecret('  "GOCSPX-abc"  ')).toBe("GOCSPX-abc");
  });
});
