"use client";

import { useSyncExternalStore } from "react";
import { LOGIN_HINT_COOKIE_NAME } from "@/utils/auth-cookies";

type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type AuthState = { user: AuthUser | null; loading: boolean };

/**
 * Resolve the signed-in user for client components.
 *
 * Cost reductions over a naive per-component fetch:
 *
 * 1. GUEST SHORT-CIRCUIT — a non-httpOnly `adore_logged_in` hint cookie is
 *    written by the server ("1" signed in, "0" signed out). A confirmed "0"
 *    means no session, so guests (the bulk of traffic) never call
 *    /api/auth/me at all. The hint carries no data and grants nothing:
 *    authorization is still done server-side from the httpOnly access token,
 *    so a forged value costs at most one wasted 401.
 *
 *    An ABSENT hint is treated as "unknown", not as "guest", and is verified
 *    once — otherwise every session that predates this cookie would silently
 *    render as signed out.
 * 2. ONE SHARED LOOKUP — this hook is used by the header, the cart drawer and
 *    the review form, so a single page used to fire 2-3 identical requests.
 *    The result now lives in module scope and is read through
 *    `useSyncExternalStore`, so every caller shares one request and one value.
 *
 * The module state is never stale in a way that matters because login, signup,
 * admin-login and logout all hard-navigate via `window.location.href`
 * (verified), which reloads the page and resets this module.
 *
 * Implemented via useSyncExternalStore rather than useState + useEffect so the
 * initial render reads the store directly instead of synchronously setting
 * state from an effect (which would cause a cascading second render pass).
 */

// Server/hydration snapshot: identical for every visitor, so the ISR-cached
// HTML never depends on a cookie and cannot cause a hydration mismatch.
const SERVER_STATE: AuthState = { user: null, loading: true };

let state: AuthState = SERVER_STATE;
let started = false;
const listeners = new Set<() => void>();

function setState(next: AuthState) {
  state = next;
  for (const listener of listeners) listener();
}

/**
 * Read the login hint: `"1"` signed in, `"0"` confirmed signed out, `null`
 * when the cookie is absent (state unknown — must be verified).
 */
function readLoginHint(): "1" | "0" | null {
  const prefix = `${LOGIN_HINT_COOKIE_NAME}=`;
  const part = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(prefix));
  if (!part) return null;
  return part.slice(prefix.length) === "1" ? "1" : "0";
}

/**
 * Kick off the single shared lookup, on the first client subscribe — so it
 * never runs during SSR or before mount.
 */
function ensureStarted() {
  if (started) return;
  started = true;

  // The server has confirmed this browser is signed out — nothing to ask.
  if (readLoginHint() === "0") {
    setState({ user: null, loading: false });
    return;
  }

  fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin" })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as { user?: AuthUser | null } | null;
      return data?.user ?? null;
    })
    .catch(() => null)
    .then((user) => setState({ user, loading: false }));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Concurrent mounts share this module's state, so they share one request.
  ensureStarted();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): AuthState {
  return state;
}

function getServerSnapshot(): AuthState {
  return SERVER_STATE;
}

export function useAuthUser(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

