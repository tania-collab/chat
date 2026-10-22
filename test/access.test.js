import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { memoryKv, ORIGIN, GCHAT_URL } from "./helpers.js";

const TEAM = "zinspector.cloudflareaccess.com";
const AUD = "aud-123";
const env = () => ({ RELAY: memoryKv(), ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_PASSWORD: "pw" });

let keys, publicJwk, realFetch;
before(async () => {
  keys = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  publicJwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "k1", alg: "RS256" };
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url) === `https://${TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [publicJwk] });
    throw new Error(`unexpected fetch ${url}`);
  };
});
after(() => (globalThis.fetch = realFetch));

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
async function token(claims = {}, kid = "k1") {
  const now = Math.floor(Date.now() / 1000);
  const body = { aud: [AUD], iss: `https://${TEAM}`, email: "Maria@zinspector.com", exp: now + 600, iat: now, ...claims };
  const head = b64url(JSON.stringify({ alg: "RS256", kid })) + "." + b64url(JSON.stringify(body));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(head));
  return head + "." + b64url(new Uint8Array(sig));
}

const call = (e, jwt, method = "GET", path = "/api/state", body) =>
  worker.fetch(
    new Request(ORIGIN + path, {
      method,
      headers: { Origin: ORIGIN, "Content-Type": "application/json", ...(jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }),
    e,
  );

test("a person signed in through Access gets in and is shown by email", async () => {
  const res = await call(env(), await token());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).user, "maria@zinspector.com");
});

test("refuses requests without a valid Access sign-in", async () => {
  const e = env();
  const good = await token();
  const tampered = good.slice(0, -4) + (good.endsWith("AAAA") ? "BBBB" : "AAAA");
  const cases = {
    "no token": null,
    "other app": await token({ aud: ["someone-else"] }),
    expired: await token({ exp: Math.floor(Date.now() / 1000) - 10 }),
    "other team": await token({ iss: "https://evil.cloudflareaccess.com" }),
    "unknown key": await token({}, "k2"),
    tampered,
    garbage: "not.a.jwt",
  };
  for (const [name, jwt] of Object.entries(cases)) {
    assert.equal((await call(e, jwt)).status, 403, name);
  }
});

test("says which setting to fix when the sign-in doesn't match", async () => {
  const e = env();
  const text = async (jwt) => (await call(e, jwt)).text();
  assert.match(await text(null), /policy is Allow, not Bypass/);
  assert.match(await text(await token({ aud: ["the-real-aud"] })), /Set ACCESS_AUD to the-real-aud/);
  assert.match(
    await text(await token({ iss: "https://other.cloudflareaccess.com" })),
    /set ACCESS_TEAM_DOMAIN to "zinspector\.cloudflareaccess\.com, other\.cloudflareaccess\.com"/,
  );
});

test("after a team rename, accepts sign-ins under either listed name, checked with the team's keys", async () => {
  // Access still stamps the old name, which no longer publishes keys: the current name's keys are used.
  const e = { ...env(), ACCESS_TEAM_DOMAIN: `${TEAM}, old-name.cloudflareaccess.com` };
  assert.equal((await call(e, await token({ iss: "https://old-name.cloudflareaccess.com" }))).status, 200);
  assert.equal((await call(e, await token())).status, 200);
  assert.equal((await call(e, await token({ iss: "https://evil.cloudflareaccess.com" }))).status, 403);
});

test("accepts settings pasted with https:// or stray spaces", async () => {
  const e = { ...env(), ACCESS_TEAM_DOMAIN: ` https://${TEAM}/ `, ACCESS_AUD: ` ${AUD} ` };
  assert.equal((await call(e, await token())).status, 200);
});

test("the password no longer opens the app once Access is set", async () => {
  const res = await worker.fetch(
    new Request(ORIGIN + "/api/state", { headers: { Authorization: "Basic " + btoa("me:pw") } }),
    env(),
  );
  assert.equal(res.status, 403);
});

test("records who added and who last edited a chat", async () => {
  const e = env();
  const body = { name: "Ops", platform: "google-chat", chatUrl: GCHAT_URL, token: "t" };
  const c = await (await call(e, await token(), "POST", "/api/connections", body)).json();
  assert.equal(c.createdBy, "maria@zinspector.com");
  const edited = await (await call(e, await token({ email: "sam@zinspector.com" }), "PUT", `/api/connections/${c.id}`, body)).json();
  assert.deepEqual([edited.createdBy, edited.updatedBy], ["maria@zinspector.com", "sam@zinspector.com"]);
});

test("zInspector webhooks don't need a sign-in", async () => {
  const res = await worker.fetch(new Request(`${ORIGIN}/hook/unknown`, { method: "POST", body: "{}" }), env());
  assert.equal(res.status, 404);
});
