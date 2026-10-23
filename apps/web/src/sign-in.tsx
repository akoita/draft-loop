import { type FormEvent, useState } from "react";

import { ownerTokenProblem } from "./session.js";

export interface SignInProps {
  /** Why the last session ended, such as a token the API refused. */
  readonly notice?: string;
  readonly onSignIn: (token: string) => void;
}

/** Asks for the owner token; phase 2 replaces it with sign-in through the identity provider. */
export function SignIn({ notice, onSignIn }: SignInProps) {
  const [token, setToken] = useState("");
  const [problem, setProblem] = useState<string | undefined>(undefined);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = token.trim();
    const found = ownerTokenProblem(trimmed);
    setProblem(found);
    if (found === undefined) onSignIn(trimmed);
  }

  return (
    <main className="sign-in">
      <h1>DraftLoop</h1>
      <p>
        Sign in with the owner token of this deployment. It stays in this tab until you close it.
      </p>
      {notice === undefined ? null : (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <form onSubmit={submit}>
        <label htmlFor="owner-token">Owner token</label>
        <input
          id="owner-token"
          type="password"
          autoComplete="current-password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        {problem === undefined ? null : (
          <p className="problem" role="alert">
            {problem}
          </p>
        )}
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
