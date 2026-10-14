import { useState, type ReactElement, type SyntheticEvent } from "react";
import { api } from "./api.ts";

/** The token goes in a form, never in a URL; the server answers with a cookie (plan §12). */
export function LoginView({ onLoggedIn }: { onLoggedIn: () => void }): ReactElement {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (token.trim() === "") {
      setError("Enter the token first.");
      return;
    }
    try {
      await api.login(token.trim());
      onLoggedIn();
    } catch {
      setError("This token is not valid.");
    }
  };

  return (
    <form className="login" onSubmit={(event) => void submit(event)}>
      <h1>Eva</h1>
      <label htmlFor="token">Token (from the localApiToken in your instance's secrets.json)</label>
      <input
        id="token"
        type="password"
        autoComplete="current-password"
        value={token}
        onChange={(event) => {
          setToken(event.target.value);
          setError(null);
        }}
      />
      {error !== null && (
        <span role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>
          {error}
        </span>
      )}
      <button className="primary" type="submit">
        Log in
      </button>
    </form>
  );
}
