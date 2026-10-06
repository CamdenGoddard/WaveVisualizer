// Helpers for the OAuth 2.0 Authorization Code flow with PKCE (RFC 7636).
// PKCE lets a browser-only app sign in to Spotify without a client secret.

const VERIFIER_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function base64UrlEncode(buffer) {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomVerifier(length = 64) {
  const values = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const v of values) out += VERIFIER_CHARS[v % VERIFIER_CHARS.length];
  return out;
}

export async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(digest);
}
