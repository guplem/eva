import { stateFaces, type Face } from "./visor-faces.ts";

/** The states of the login page that show one face. The waiting page rotates faces instead. */
export type LoginState = "asking" | "token" | "denied" | "expired";

const loginFaces: Record<LoginState, Face> = {
  asking: stateFaces.searching,
  token: stateFaces.idle,
  denied: stateFaces.failed,
  // An expired request is not a failure: nobody answered in time, so EVE doubts instead.
  expired: stateFaces.conflict,
};

export function loginFace(state: LoginState): Face {
  return loginFaces[state];
}
