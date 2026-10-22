// Sign-in through Cloudflare Access: verifies the Cf-Access-Jwt-Assertion header Access adds to
// every request it lets through, and returns the signed-in person's email.
//
// Settings: ACCESS_TEAM_DOMAIN (e.g. "zinspector.cloudflareaccess.com") and ACCESS_AUD (the Access
// application's "Application Audience (AUD) Tag"). After a team rename, Access can keep signing people in
// under the old name, so ACCESS_TEAM_DOMAIN may list both names, comma-separated.

const KEY_CACHE_MS = 60 * 60 * 1000;
const cache = new Map(); // team domain -> { at, keys }

export function accessConfigured(env) {
  return Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
}

// Returns {email} for a valid sign-in, or {problem}: a plain-language reason for the person setting it up.
export async function accessCheck(request, env) {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    return { problem: "Cloudflare Access didn't sign you in. Check that the chat app's Access policy is Allow, not Bypass." };
  }
  const parts = token.split(".");
  let header, payload;
  try {
    if (parts.length !== 3) throw new Error("not a JWT");
    header = JSON.parse(textFromBase64Url(parts[0]));
    payload = JSON.parse(textFromBase64Url(parts[1]));
  } catch {
    return { problem: "The sign-in token from Cloudflare Access couldn't be read." };
  }
  if (header.alg !== "RS256") return { problem: "The sign-in token uses an unexpected signature type." };

  const domains = teamDomains(env.ACCESS_TEAM_DOMAIN);
  const issuer = String(payload.iss || "").replace(/^https:\/\//, "");
  if (!domains.includes(issuer)) {
    const now = domains.join(", ");
    return {
      problem: `ACCESS_TEAM_DOMAIN is "${now}", but this sign-in comes from "${issuer}". If ${issuer} is your Cloudflare team, set ACCESS_TEAM_DOMAIN to "${now}, ${issuer}" and deploy.`,
    };
  }
  // The issuer's own keys first; a renamed team may only publish them under its other name.
  let jwk = null;
  for (const domain of [issuer, ...domains.filter((d) => d !== issuer)]) {
    jwk = await signingKey(domain, header.kid);
    if (jwk) break;
  }
  if (!jwk) return { problem: `Couldn't get Cloudflare Access's signing keys for "${domains.join(", ")}". Check ACCESS_TEAM_DOMAIN.` };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, bytesFromBase64Url(parts[2]), signed))) {
    return { problem: "The sign-in token's signature is not valid." };
  }

  // The token is genuine from here on, so its audience can be shown as a hint.
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(String(env.ACCESS_AUD).trim())) {
    return { problem: `ACCESS_AUD doesn't match this Access application. Set ACCESS_AUD to ${audiences[0]} and deploy.` };
  }
  const now = Date.now() / 1000;
  if (typeof payload.exp !== "number" || payload.exp < now) return { problem: "Your sign-in has expired. Reload the page." };
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) return { problem: "Your sign-in isn't valid yet. Check your computer's clock." };
  if (typeof payload.email !== "string" || !payload.email) {
    return { problem: "The sign-in has no email address. Sign in with an email, not a service token." };
  }
  return { email: payload.email.toLowerCase() };
}

async function signingKey(domain, kid) {
  const cached = cache.get(domain);
  const find = () => cache.get(domain)?.keys.find((k) => k.kid === kid) || null;
  if (cached && Date.now() - cached.at < KEY_CACHE_MS && find()) return find();
  // Unknown key id: Access may have rotated its keys, so fetch them again.
  try {
    const res = await fetch(`https://${domain}/cdn-cgi/access/certs`);
    if (!res.ok) return null;
    const { keys = [] } = await res.json();
    cache.set(domain, { at: Date.now(), keys });
  } catch {
    return null;
  }
  return find();
}

function teamDomains(value) {
  return String(value)
    .split(",")
    .map((d) => d.trim().replace(/^https?:\/\//, "").replace(/\/+$/, ""))
    .filter(Boolean);
}

function bytesFromBase64Url(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function textFromBase64Url(s) {
  return new TextDecoder().decode(bytesFromBase64Url(s));
}
