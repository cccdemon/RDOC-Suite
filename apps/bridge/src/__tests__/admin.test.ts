import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { disconnectPrisma, getPrisma } from "@rdoc-suite/db";
import { buildApp } from "../app.js";
import { resetEnvCache } from "../config/env.js";
import {
  consumeInviteLink,
  listInviteLinks,
  mintAdminInviteLink,
  revokeInviteLink,
} from "../services/adminInviteLinks.js";
import { addAdmin, isAdmin } from "../services/admins.js";

const GUILD_ID = "888777666555444333";
const ISSUER_ID = "100100100100100100";
const INVITEE_ID = "200200200200200200";

const OAUTH_ENV = {
  DISCORD_CLIENT_ID: "100000000000000000",
  DISCORD_CLIENT_SECRET: "test-secret",
  DISCORD_BOT_TOKEN: "test-bot-token",
  OAUTH_REDIRECT_URI: "http://localhost:8787/auth/callback",
};

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  for (const [k, v] of Object.entries(OAUTH_ENV)) process.env[k] = v;
  resetEnvCache();
  app = await buildApp();
  baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  for (const k of Object.keys(OAUTH_ENV)) delete process.env[k];
  resetEnvCache();
  await app.close();
  await disconnectPrisma();
});

async function cleanup(): Promise<void> {
  await getPrisma().adminInviteLink.deleteMany({ where: { guildId: GUILD_ID } });
  await getPrisma().adminUser.deleteMany({ where: { guildId: GUILD_ID } });
}
beforeEach(cleanup);
afterEach(cleanup);

describe("adminInviteLinks service", () => {
  it("mints + consumes a link, creating the AdminUser row atomically", async () => {
    const invite = await mintAdminInviteLink({
      guildId: GUILD_ID,
      label: "alice",
      role: "vice_admiral",
      createdBy: ISSUER_ID,
    });
    expect(invite.plaintext).toMatch(/^[0-9a-f]{64}$/);

    expect(await isAdmin({ guildId: GUILD_ID, userId: INVITEE_ID })).toBe(false);

    const result = await consumeInviteLink({
      rawToken: invite.plaintext,
      discordUserId: INVITEE_ID,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.guildId).toBe(GUILD_ID);

    // Invitee is now an admin
    expect(await isAdmin({ guildId: GUILD_ID, userId: INVITEE_ID })).toBe(true);
  });

  it("rejects an already-used invite on second click", async () => {
    const invite = await mintAdminInviteLink({
      guildId: GUILD_ID,
      label: "alice",
      role: "vice_admiral",
      createdBy: ISSUER_ID,
    });
    await consumeInviteLink({ rawToken: invite.plaintext, discordUserId: INVITEE_ID });
    const second = await consumeInviteLink({
      rawToken: invite.plaintext,
      discordUserId: "300300300300300300",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("already_used");
  });

  it("rejects an expired invite", async () => {
    const invite = await mintAdminInviteLink({
      guildId: GUILD_ID,
      label: "alice",
      role: "vice_admiral",
      createdBy: ISSUER_ID,
      ttlDays: 1,
    });
    // Force-expire by editing the row backwards
    await getPrisma().adminInviteLink.update({
      where: { id: invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const result = await consumeInviteLink({
      rawToken: invite.plaintext,
      discordUserId: INVITEE_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("rejects a garbage token", async () => {
    const result = await consumeInviteLink({
      rawToken: "definitely-not-a-real-token-just-random-text-here-and-this-is-long",
      discordUserId: INVITEE_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_token");
  });

  it("revokes an unused invite (delete) but leaves used ones alone", async () => {
    const i1 = await mintAdminInviteLink({
      guildId: GUILD_ID,
      label: "fresh",
      role: "vice_admiral",
      createdBy: ISSUER_ID,
    });
    const i2 = await mintAdminInviteLink({
      guildId: GUILD_ID,
      label: "consumed",
      role: "vice_admiral",
      createdBy: ISSUER_ID,
    });
    await consumeInviteLink({ rawToken: i2.plaintext, discordUserId: INVITEE_ID });

    expect(await revokeInviteLink({ id: i1.id, guildId: GUILD_ID })).toBe(true);
    expect(await revokeInviteLink({ id: i2.id, guildId: GUILD_ID })).toBe(false);

    const remaining = await listInviteLinks(GUILD_ID);
    // i1 was unused so it got deleted; i2 stayed (audit)
    expect(remaining.map((r) => r.label)).toEqual(["consumed"]);
  });

  it("scopes revoke by guildId — cannot kill another guild's invite by id", async () => {
    const invite = await mintAdminInviteLink({
      guildId: GUILD_ID,
      label: "mine",
      role: "vice_admiral",
      createdBy: ISSUER_ID,
    });
    expect(
      await revokeInviteLink({ id: invite.id, guildId: "999999999999999999" }),
    ).toBe(false);
    expect(await listInviteLinks(GUILD_ID)).toHaveLength(1);
  });
});

describe("admin routes (smoke)", () => {
  it("GET /admin/ without cookie redirects to /admin/login", async () => {
    const res = await fetch(`${baseUrl}/admin/`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/admin/login");
  });

  it("GET /admin/login returns the chaos-crew-styled login HTML", async () => {
    const res = await fetch(`${baseUrl}/admin/login`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("CONTINUE WITH DISCORD");
    expect(body).toContain("colors_and_type.css");
    expect(body).toContain("admin.css");
  });

  it("GET /admin/static/admin.css serves the stylesheet", async () => {
    const res = await fetch(`${baseUrl}/admin/static/admin.css`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(".btn");
    expect(body).toContain(".cc-nav");
  });

  it("GET /admin/static/colors_and_type.css serves the design tokens", async () => {
    const res = await fetch(`${baseUrl}/admin/static/colors_and_type.css`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("--cyan");
    expect(body).toContain("Share Tech Mono");
  });

  it("GET /admin/oauth/start returns a Discord redirect with state cookie", async () => {
    const res = await fetch(`${baseUrl}/admin/oauth/start`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc.startsWith("https://discord.com/oauth2/authorize")).toBe(true);
    expect(loc).toContain("scope=identify");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("dccc_admin_oauth_state");
  });

  it("GET /admin/invite/<unknown-token> still redirects to Discord (the token is only checked AFTER callback)", async () => {
    const res = await fetch(`${baseUrl}/admin/invite/garbage-token-yet-still-tries`, {
      redirect: "manual",
    });
    // We don't pre-validate the token at the entry point because we
    // need to encrypt the user-flow first; consume validates on the
    // callback side. Still returns a Discord redirect.
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc.startsWith("https://discord.com/oauth2/authorize")).toBe(true);
  });

  it("API endpoints require admin cookie — return 302 to login without one", async () => {
    const res = await fetch(`${baseUrl}/admin/api/live`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/admin/login");
  });
});

// Used to prove the admin gate accepts a forged-in-test session cookie
// when paired with the proper AdminUser row. We can't easily perform
// a real Discord OAuth round-trip in tests, so we mint a cookie
// directly using the same helper the prod path uses.
describe("admin gate accepts a valid session cookie", () => {
  it("dashboard renders when AdminUser exists + cookie is valid", async () => {
    // Pre-seed the admin row that the cookie will claim to represent
    await addAdmin({ guildId: GUILD_ID, userId: INVITEE_ID });
    const { issueAdminSessionCookie } = await import("../admin/cookie.js");
    const secret = process.env.SESSION_SECRET ?? "";
    const jwt = await issueAdminSessionCookie(secret, {
      sub: INVITEE_ID,
      guildId: GUILD_ID,
    });
    const res = await fetch(`${baseUrl}/admin/`, {
      headers: { cookie: `dccc_admin_session=${jwt}` },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("DASHBOARD");
    expect(body).toContain(GUILD_ID);
  });
});
