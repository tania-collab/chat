// Sign-in through Cloudflare Access: verifies the Cf-Access-Jwt-Assertion header Access adds to
// every request it lets through, and returns the signed-in person's email.
//
// Settings: ACCESS_TEAM_DOMAIN (e.g. "zinspector.cloudflareaccess.com") and ACCESS_AUD (the Access
// application's "Application Audience (AUD) Tag").

const KEY_CACHE_MS = 60 * 60 * 1000;
let cache = { domain: null, at: 0, keys: [] };

export function accessConfigured(env) {
  return Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
}

export async function accessEmail(request, env) {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  let header, payload;
  try {
    header = JSON.parse(textFromBase64Url(parts[0]));
    payload = JSON.parse(textFromBase64Url(parts[1]));
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;

  const domain = teamDomain(env.ACCESS_TEAM_DOMAIN);
  const jwk = await signingKey(domain, header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, bytesFromBase64Url(parts[2]), signed);
  if (!valid) return null;

  const now = Date.now() / 1000;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(env.ACCESS_AUD)) return null;
  if (payload.iss !== `https://${domain}`) return null;
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) return null;
  return typeof payload.email === "string" && payload.email ? payload.email.toLowerCase() : null;
}

async function signingKey(domain, kid) {
  const find = () => cache.keys.find((k) => k.kid === kid);
  const fresh = cache.domain === domain && Date.now() - cache.at < KEY_CACHE_MS;
  if (fresh && find()) return find();
  // Unknown key id: Access may have rotated its keys, so fetch them again.
  const res = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!res.ok) return null;
  const { keys = [] } = await res.json();
  cache = { domain, at: Date.now(), keys };
  return find() || null;
}

function teamDomain(value) {
  return String(value).trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function bytesFromBase64Url(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function textFromBase64Url(s) {
  return new TextDecoder().decode(bytesFromBase64Url(s));
}
