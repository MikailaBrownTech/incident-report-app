import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import * as accept from "@/app/api/invites/accept/route";
import * as invite from "@/app/api/w/[slug]/invites/[id]/route";
import * as resend from "@/app/api/w/[slug]/invites/[id]/resend/route";
import * as invites from "@/app/api/w/[slug]/invites/route";
import * as member from "@/app/api/w/[slug]/members/[userId]/route";
import * as members from "@/app/api/w/[slug]/members/route";
import * as workspace from "@/app/api/w/[slug]/route";
import * as workspaces from "@/app/api/workspaces/route";
import { prisma } from "@/server/db/client";
import { hashInviteToken } from "@/server/invites/token";
import { call, inviteTokenSentTo } from "@/test/api";
import { addMember, createTeam, createUser } from "@/test/fixtures";
import { RESERVED_SLUGS } from "./slug";

vi.mock("@/server/auth/session", async () => {
  const { currentTestUser } = await import("@/test/api");
  return { getSession: async () => (currentTestUser() ? { user: currentTestUser(), session: {} } : null) };
});
vi.mock("@/server/email/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/email/send")>();
  const { mailbox } = await import("@/test/api");
  return { ...actual, sendEmail: async (m: (typeof mailbox)[number]) => void mailbox.push(m) };
});

const uid = () => randomBytes(4).toString("hex");
const W = (slug: string) => `/api/w/${slug}`;

/** Two independent workspaces: `a` (owner, admin, member) and `b` (owner, member, a pending invite). */
async function world() {
  const a = await createTeam("alpha");
  const adminA = await addMember(a.workspace.id, "ADMIN");
  const memberA = await addMember(a.workspace.id, "MEMBER");
  const b = await createTeam("beta");
  const memberB = await addMember(b.workspace.id, "MEMBER");
  const inviteB = await prisma.invite.create({
    data: {
      workspaceId: b.workspace.id,
      email: `pending-${uid()}@example.test`,
      tokenHash: hashInviteToken(uid()),
      invitedById: b.owner.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  return { a, adminA, memberA, b, memberB, inviteB };
}

const audits = (workspaceId: string, action: string) => prisma.auditLog.findMany({ where: { workspaceId, action } });

describe("tenant isolation at the route level", () => {
  it.concurrent("a non-member gets 404, and a signed-out caller 401, on every /api/w/{slug} route", async () => {
    const w = await world();
    const slug = w.a.workspace.slug;
    const target = w.memberA.id;
    const calls: [string, Parameters<typeof call>[1], string, object?][] = [
      ["GET workspace", workspace.GET, W(slug), { params: { slug } }],
      ["PATCH workspace", workspace.PATCH, W(slug), { method: "PATCH", body: { name: "x" }, params: { slug } }],
      ["GET members", members.GET, `${W(slug)}/members`, { params: { slug } }],
      [
        "PATCH member",
        member.PATCH,
        `${W(slug)}/members/${target}`,
        { method: "PATCH", body: { role: "ADMIN" }, params: { slug, userId: target } },
      ],
      ["DELETE member", member.DELETE, `${W(slug)}/members/${target}`, { method: "DELETE", params: { slug, userId: target } }],
      ["GET invites", invites.GET, `${W(slug)}/invites`, { params: { slug } }],
      [
        "POST invites",
        invites.POST,
        `${W(slug)}/invites`,
        { method: "POST", body: { email: "x@example.test", role: "MEMBER" }, params: { slug } },
      ],
      ["DELETE invite", invite.DELETE, `${W(slug)}/invites/nope`, { method: "DELETE", params: { slug, id: "nope" } }],
      ["POST resend", resend.POST, `${W(slug)}/invites/nope/resend`, { method: "POST", params: { slug, id: "nope" } }],
    ];

    for (const [label, handler, path, options] of calls) {
      const stranger = await call(w.b.owner, handler, path, options);
      expect(stranger.status, `${label} as a non-member`).toBe(404);
      expect(stranger.body).toEqual({ error: { code: "not_found", message: expect.any(String) } });

      const signedOut = await call(null, handler, path, options);
      expect(signedOut.status, `${label} signed out`).toBe(401);
      expect(signedOut.body.error.code).toBe("unauthenticated");
    }
    // nothing changed
    expect((await prisma.membership.findFirstOrThrow({ where: { userId: w.memberA.id } })).role).toBe("MEMBER");
  });

  it.concurrent("workspace A's member cannot read or change workspace B's members or invites", async () => {
    const w = await world();
    const bSlug = w.b.workspace.slug;

    // reads through B's slug are 404 for everyone in A, including A's owner
    for (const user of [w.a.owner, w.adminA, w.memberA]) {
      expect((await call(user, members.GET, `${W(bSlug)}/members`, { params: { slug: bSlug } })).status).toBe(404);
      expect((await call(user, invites.GET, `${W(bSlug)}/invites`, { params: { slug: bSlug } })).status).toBe(404);
    }
    // A's own listings contain none of B's people or invites
    const own = await call(w.a.owner, members.GET, `${W(w.a.workspace.slug)}/members`, {
      params: { slug: w.a.workspace.slug },
    });
    const ids = own.body.members.map((m: { userId: string }) => m.userId);
    expect(ids).toContain(w.memberA.id);
    expect(ids).not.toContain(w.memberB.id);
    const ownInvites = await call(w.a.owner, invites.GET, `${W(w.a.workspace.slug)}/invites`, {
      params: { slug: w.a.workspace.slug },
    });
    expect(ownInvites.body.invites.map((i: { id: string }) => i.id)).not.toContain(w.inviteB.id);

    // A's owner cannot reach B's member or invite by routing the id through A's own slug
    const aSlug = w.a.workspace.slug;
    const patch = await call(w.a.owner, member.PATCH, `${W(aSlug)}/members/${w.memberB.id}`, {
      method: "PATCH",
      body: { role: "OWNER" },
      params: { slug: aSlug, userId: w.memberB.id },
    });
    expect(patch.status).toBe(404);
    const del = await call(w.a.owner, member.DELETE, `${W(aSlug)}/members/${w.memberB.id}`, {
      method: "DELETE",
      params: { slug: aSlug, userId: w.memberB.id },
    });
    expect(del.status).toBe(404);
    const revoke = await call(w.a.owner, invite.DELETE, `${W(aSlug)}/invites/${w.inviteB.id}`, {
      method: "DELETE",
      params: { slug: aSlug, id: w.inviteB.id },
    });
    expect(revoke.status).toBe(404);
    const resent = await call(w.a.owner, resend.POST, `${W(aSlug)}/invites/${w.inviteB.id}/resend`, {
      method: "POST",
      params: { slug: aSlug, id: w.inviteB.id },
    });
    expect(resent.status).toBe(404);

    expect((await prisma.membership.findFirstOrThrow({ where: { userId: w.memberB.id } })).role).toBe("MEMBER");
    const stillPending = await prisma.invite.findUniqueOrThrow({ where: { id: w.inviteB.id } });
    expect(stillPending.revokedAt).toBeNull();
    expect(stillPending.tokenHash).toBe(w.inviteB.tokenHash);
  });
});

describe("role rules", () => {
  it.concurrent("a plain member cannot invite, list invites, change roles or remove others", async () => {
    const w = await world();
    const slug = w.a.workspace.slug;
    const invitePost = await call(w.memberA, invites.POST, `${W(slug)}/invites`, {
      method: "POST",
      body: { email: `new-${uid()}@example.test`, role: "MEMBER" },
      params: { slug },
    });
    expect(invitePost.status).toBe(403);
    expect(invitePost.body.error.code).toBe("forbidden");
    expect((await call(w.memberA, invites.GET, `${W(slug)}/invites`, { params: { slug } })).status).toBe(403);
    const role = await call(w.memberA, member.PATCH, `${W(slug)}/members/${w.adminA.id}`, {
      method: "PATCH",
      body: { role: "MEMBER" },
      params: { slug, userId: w.adminA.id },
    });
    expect(role.status).toBe(403);
    const remove = await call(w.memberA, member.DELETE, `${W(slug)}/members/${w.adminA.id}`, {
      method: "DELETE",
      params: { slug, userId: w.adminA.id },
    });
    expect(remove.status).toBe(403);
    // members can read the roster
    expect((await call(w.memberA, members.GET, `${W(slug)}/members`, { params: { slug } })).status).toBe(200);
  });

  it.concurrent("an admin can invite and manage members but cannot touch owners or promote to owner", async () => {
    const w = await world();
    const slug = w.a.workspace.slug;
    const admin = w.adminA;

    const promoteToOwner = await call(admin, member.PATCH, `${W(slug)}/members/${w.memberA.id}`, {
      method: "PATCH",
      body: { role: "OWNER" },
      params: { slug, userId: w.memberA.id },
    });
    expect(promoteToOwner.status).toBe(403);
    const demoteOwner = await call(admin, member.PATCH, `${W(slug)}/members/${w.a.owner.id}`, {
      method: "PATCH",
      body: { role: "MEMBER" },
      params: { slug, userId: w.a.owner.id },
    });
    expect(demoteOwner.status).toBe(403);
    const removeOwner = await call(admin, member.DELETE, `${W(slug)}/members/${w.a.owner.id}`, {
      method: "DELETE",
      params: { slug, userId: w.a.owner.id },
    });
    expect(removeOwner.status).toBe(403);
    const ownerInvite = await call(admin, invites.POST, `${W(slug)}/invites`, {
      method: "POST",
      body: { email: `o-${uid()}@example.test`, role: "OWNER" },
      params: { slug },
    });
    expect(ownerInvite.status).toBe(400); // owners can't be created by invitation

    const ok = await call(admin, member.PATCH, `${W(slug)}/members/${w.memberA.id}`, {
      method: "PATCH",
      body: { role: "ADMIN" },
      params: { slug, userId: w.memberA.id },
    });
    expect(ok.status).toBe(200);
    const invited = await call(admin, invites.POST, `${W(slug)}/invites`, {
      method: "POST",
      body: { email: `fresh-${uid()}@example.test`, role: "MEMBER" },
      params: { slug },
    });
    expect(invited.status).toBe(201);
  });

  it.concurrent("only an owner can promote to owner or demote an owner", async () => {
    const w = await world();
    const slug = w.a.workspace.slug;
    const promote = await call(w.a.owner, member.PATCH, `${W(slug)}/members/${w.memberA.id}`, {
      method: "PATCH",
      body: { role: "OWNER" },
      params: { slug, userId: w.memberA.id },
    });
    expect(promote.status).toBe(200);
    const demote = await call(w.a.owner, member.PATCH, `${W(slug)}/members/${w.memberA.id}`, {
      method: "PATCH",
      body: { role: "MEMBER" },
      params: { slug, userId: w.memberA.id },
    });
    expect(demote.status).toBe(200);
  });

  it.concurrent("the last owner cannot be removed, demoted or leave", async () => {
    const w = await world();
    const slug = w.a.workspace.slug;
    const owner = w.a.owner;
    const demote = await call(owner, member.PATCH, `${W(slug)}/members/${owner.id}`, {
      method: "PATCH",
      body: { role: "MEMBER" },
      params: { slug, userId: owner.id },
    });
    expect(demote.status).toBe(409);
    expect(demote.body.error.code).toBe("last_owner");
    const leave = await call(owner, member.DELETE, `${W(slug)}/members/${owner.id}`, {
      method: "DELETE",
      params: { slug, userId: owner.id },
    });
    expect(leave.status).toBe(409);
    expect(leave.body.error.code).toBe("last_owner");

    // with a second owner, the first can step down; then the remaining one is protected
    const second = await addMember(w.a.workspace.id, "OWNER");
    expect(
      (
        await call(second, member.DELETE, `${W(slug)}/members/${owner.id}`, {
          method: "DELETE",
          params: { slug, userId: owner.id },
        })
      ).status,
    ).toBe(200);
    const lastNow = await call(second, member.DELETE, `${W(slug)}/members/${second.id}`, {
      method: "DELETE",
      params: { slug, userId: second.id },
    });
    expect(lastNow.status).toBe(409);
  });

  it.concurrent("two owners demoting each other at once still leaves an owner", async () => {
    const w = await world();
    const slug = w.a.workspace.slug;
    const second = await addMember(w.a.workspace.id, "OWNER");
    await Promise.all([
      call(w.a.owner, member.PATCH, `${W(slug)}/members/${second.id}`, {
        method: "PATCH",
        body: { role: "MEMBER" },
        params: { slug, userId: second.id },
      }),
      call(second, member.PATCH, `${W(slug)}/members/${w.a.owner.id}`, {
        method: "PATCH",
        body: { role: "MEMBER" },
        params: { slug, userId: w.a.owner.id },
      }),
    ]);
    expect(await prisma.membership.count({ where: { workspaceId: w.a.workspace.id, role: "OWNER" } })).toBeGreaterThanOrEqual(1);
  });

  it.concurrent("a member can leave on their own", async () => {
    const w = await world();
    const slug = w.a.workspace.slug;
    const res = await call(w.memberA, member.DELETE, `${W(slug)}/members/${w.memberA.id}`, {
      method: "DELETE",
      params: { slug, userId: w.memberA.id },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removed: true, left: true });
    expect(await prisma.membership.count({ where: { userId: w.memberA.id } })).toBe(0);
  });

  it.concurrent("members of a workspace see its details; only admins rename; any member can switch skin", async () => {
    const w = await world();
    const slug = w.a.workspace.slug;
    const got = await call(w.memberA, workspace.GET, W(slug), { params: { slug } });
    expect(got.body).toMatchObject({ workspace: { slug, skin: "haunted" }, membership: { role: "MEMBER" } });

    const rename = await call(w.memberA, workspace.PATCH, W(slug), { method: "PATCH", body: { name: "Hax" }, params: { slug } });
    expect(rename.status).toBe(403);
    const skin = await call(w.memberA, workspace.PATCH, W(slug), { method: "PATCH", body: { skin: "professional" }, params: { slug } });
    expect(skin.status).toBe(200);
    expect(skin.body.workspace.skin).toBe("professional");
    const renamed = await call(w.adminA, workspace.PATCH, W(slug), { method: "PATCH", body: { name: "Renamed" }, params: { slug } });
    expect(renamed.body.workspace.name).toBe("Renamed");
    const empty = await call(w.adminA, workspace.PATCH, W(slug), { method: "PATCH", body: {}, params: { slug } });
    expect(empty.status).toBe(400);
  });
});

describe("invites", () => {
  async function invited(w: Awaited<ReturnType<typeof world>>, role: "ADMIN" | "MEMBER" = "MEMBER") {
    const guest = await createUser("guest");
    const slug = w.a.workspace.slug;
    const res = await call(w.a.owner, invites.POST, `${W(slug)}/invites`, {
      method: "POST",
      body: { email: guest.email.toUpperCase(), role },
      params: { slug },
    });
    expect(res.status).toBe(201);
    return { guest, token: inviteTokenSentTo(guest.email), inviteId: res.body.invite.id as string };
  }
  const redeem = (user: Parameters<typeof call>[0], token: string) =>
    call(user, accept.POST, "/api/invites/accept", { method: "POST", body: { token } });

  it.concurrent("a valid token creates exactly one membership with the invited role", async () => {
    const w = await world();
    const { guest, token } = await invited(w, "ADMIN");

    const first = await redeem(guest, token);
    expect(first).toMatchObject({ status: 200, body: { workspace: { slug: w.a.workspace.slug } } });
    const rows = await prisma.membership.findMany({ where: { userId: guest.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("ADMIN");

    const again = await redeem(guest, token);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("invite_used");
    expect(await prisma.membership.count({ where: { userId: guest.id } })).toBe(1);
  });

  it.concurrent("two simultaneous redemptions create one membership", async () => {
    const w = await world();
    const { guest, token } = await invited(w);
    const results = await Promise.all([redeem(guest, token), redeem(guest, token)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await prisma.membership.count({ where: { userId: guest.id } })).toBe(1);
  });

  it.concurrent("rejects expired, revoked and wrong-email tokens and unknown tokens", async () => {
    const w = await world();
    const slug = w.a.workspace.slug;

    const expired = await invited(w);
    await prisma.invite.update({ where: { id: expired.inviteId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const e = await redeem(expired.guest, expired.token);
    expect(e.status).toBe(410);
    expect(e.body.error.code).toBe("invite_expired");

    const revoked = await invited(w);
    expect(
      (await call(w.a.owner, invite.DELETE, `${W(slug)}/invites/${revoked.inviteId}`, {
        method: "DELETE",
        params: { slug, id: revoked.inviteId },
      })).status,
    ).toBe(200);
    const r = await redeem(revoked.guest, revoked.token);
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe("invite_revoked");

    const wrong = await invited(w);
    const other = await createUser("other");
    const m = await redeem(other, wrong.token);
    expect(m.status).toBe(403);
    expect(m.body.error.code).toBe("email_mismatch");
    expect(await prisma.membership.count({ where: { userId: other.id } })).toBe(0);
    // the rightful person can still use it afterwards
    expect((await redeem(wrong.guest, wrong.token)).status).toBe(200);

    expect((await redeem(other, "not-a-real-token-123")).status).toBe(404);
    expect((await redeem(null, wrong.token)).status).toBe(401);
    expect((await redeem(other, "x")).status).toBe(400);
  });

  it.concurrent("an invitee who is already a member gets no duplicate membership", async () => {
    const w = await world();
    const { guest, token } = await invited(w);
    // they join through another route first
    await prisma.membership.create({ data: { workspaceId: w.a.workspace.id, userId: guest.id, role: "OWNER" } });
    const res = await redeem(guest, token);
    expect(res.status).toBe(200);
    const rows = await prisma.membership.findMany({ where: { userId: guest.id, workspaceId: w.a.workspace.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("OWNER"); // existing role kept
  });

  it.concurrent("inviting an existing member is rejected, and re-inviting replaces the earlier link", async () => {
    const w = await world();
    const slug = w.a.workspace.slug;
    const dup = await call(w.a.owner, invites.POST, `${W(slug)}/invites`, {
      method: "POST",
      body: { email: w.memberA.email, role: "MEMBER" },
      params: { slug },
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("already_member");

    const first = await invited(w);
    const email = first.guest.email;
    await call(w.a.owner, invites.POST, `${W(slug)}/invites`, { method: "POST", body: { email, role: "MEMBER" }, params: { slug } });
    const second = inviteTokenSentTo(email);
    expect((await redeem(first.guest, first.token)).body.error.code).toBe("invite_revoked");
    expect((await redeem(first.guest, second)).status).toBe(200);
  });

  it.concurrent("stores only a hash, expires in 7 days, and resend swaps in a fresh link", async () => {
    const w = await world();
    const slug = w.a.workspace.slug;
    const { guest, token, inviteId } = await invited(w);

    const row = await prisma.invite.findUniqueOrThrow({ where: { id: inviteId } });
    expect(row.tokenHash).toBe(hashInviteToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    const days = (row.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);

    await prisma.invite.update({ where: { id: inviteId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const resent = await call(w.a.owner, resend.POST, `${W(slug)}/invites/${inviteId}/resend`, {
      method: "POST",
      params: { slug, id: inviteId },
    });
    expect(resent.status).toBe(200);
    const fresh = inviteTokenSentTo(guest.email);
    expect(fresh).not.toBe(token);
    expect((await redeem(guest, token)).status).toBe(404); // old link is dead
    expect((await redeem(guest, fresh)).status).toBe(200); // new link works, expiry renewed
  });

  it.concurrent("lists pending invites with a status and hides revoked ones", async () => {
    const w = await world();
    const slug = w.a.workspace.slug;
    const a = await invited(w);
    const b = await invited(w);
    await prisma.invite.update({ where: { id: b.inviteId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await call(w.a.owner, invite.DELETE, `${W(slug)}/invites/${a.inviteId}`, { method: "DELETE", params: { slug, id: a.inviteId } });
    const list = await call(w.a.owner, invites.GET, `${W(slug)}/invites`, { params: { slug } });
    expect(list.body.invites).toEqual([expect.objectContaining({ id: b.inviteId, status: "expired" })]);
  });
});

describe("workspaces: creation, slugs and seeding", () => {
  const owner = () => createUser("founder");
  const create = (user: Parameters<typeof call>[0], body: unknown) =>
    call(user, workspaces.POST, "/api/workspaces", { method: "POST", body });

  it.concurrent("rejects malformed slugs with a field error code", async () => {
    const user = await owner();
    for (const slug of ["ab", "Acme", "has space", "-lead", "trail-", "dou--ble", "a".repeat(41), "under_score", ""]) {
      const res = await create(user, { name: "Acme", slug });
      expect(res.status, JSON.stringify(slug)).toBe(400);
      expect(res.body.error.code).toBe("validation_error");
      expect(res.body.error.fieldErrors.slug).toContain("slug_invalid");
    }
    // boundaries are fine
    expect((await create(user, { name: "Edge", slug: `abc${uid()}` })).status).toBe(201);
    expect((await create(user, { name: "Edge", slug: `x${uid()}-${"y".repeat(20)}` })).status).toBe(201);
  });

  it.concurrent("rejects every reserved slug", async () => {
    const user = await owner();
    for (const slug of RESERVED_SLUGS) {
      const res = await create(user, { name: "Reserved", slug });
      expect(res.status, slug).toBe(400);
      expect(res.body.error.fieldErrors.slug).toContain("slug_reserved");
    }
  });

  it.concurrent("validates the name and requires a session", async () => {
    const user = await owner();
    const blank = await create(user, { name: "   ", slug: `ok-${uid()}` });
    expect(blank.status).toBe(400);
    expect(blank.body.error.fieldErrors.name).toBeTruthy();
    expect((await create(user, { slug: `ok-${uid()}` })).status).toBe(400);
    expect((await create(user, "not json at all")).status).toBe(400);
    expect((await create(null, { name: "X", slug: `ok-${uid()}` })).status).toBe(401);
  });

  it.concurrent("keeps slugs unique, including under a race", async () => {
    const [u1, u2, u3] = await Promise.all([owner(), owner(), owner()]);
    const slug = `acme-${uid()}`;
    expect((await create(u1, { name: "Acme", slug })).status).toBe(201);
    const dup = await create(u2, { name: "Acme 2", slug });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("slug_taken");
    expect(dup.body.error.fieldErrors.slug).toEqual(["slug_taken"]);

    const race = `race-${uid()}`;
    const results = await Promise.all([create(u2, { name: "R1", slug: race }), create(u3, { name: "R2", slug: race })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.workspace.count({ where: { slug: race } })).toBe(1);
  });

  it.concurrent("seeds owner, default retro rule and skin in one go, and audits it", async () => {
    const user = await owner();
    const slug = `seed-${uid()}`;
    const res = await create(user, { name: "Seeded", slug });
    expect(res.status).toBe(201);
    const id = res.body.workspace.id as string;

    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { id },
      include: { memberships: true, retroRules: true, postmortemTemplates: true },
    });
    expect(ws.skin).toBe("HAUNTED");
    expect(ws.memberships).toEqual([expect.objectContaining({ userId: user.id, role: "OWNER" })]);
    expect(ws.retroRules).toEqual([expect.objectContaining({ minSeverity: 4, mode: "REQUIRED", dueInDays: 5 })]);
    expect(ws.postmortemTemplates).toHaveLength(0); // the built-in templates are global, not copied per workspace
    const log = await audits(id, "workspace.created");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: user.id, targetType: "workspace", targetId: id });
  });
});

describe("audit log", () => {
  it.concurrent("records role changes, removals, invites, revokes and acceptances", async () => {
    const w = await world();
    const slug = w.a.workspace.slug;
    const wsId = w.a.workspace.id;
    const guest = await createUser("audited");

    const created = await call(w.a.owner, invites.POST, `${W(slug)}/invites`, {
      method: "POST",
      body: { email: guest.email, role: "MEMBER" },
      params: { slug },
    });
    const inviteId = created.body.invite.id as string;
    expect(await audits(wsId, "invite.created")).toEqual([
      expect.objectContaining({ actorId: w.a.owner.id, targetId: inviteId, metadata: { email: guest.email, role: "MEMBER" } }),
    ]);

    await call(w.a.owner, resend.POST, `${W(slug)}/invites/${inviteId}/resend`, { method: "POST", params: { slug, id: inviteId } });
    expect(await audits(wsId, "invite.resent")).toHaveLength(1);

    const token = inviteTokenSentTo(guest.email);
    await call(guest, accept.POST, "/api/invites/accept", { method: "POST", body: { token } });
    expect(await audits(wsId, "invite.accepted")).toEqual([
      expect.objectContaining({ actorId: guest.id, targetId: inviteId }),
    ]);

    await call(w.a.owner, member.PATCH, `${W(slug)}/members/${guest.id}`, {
      method: "PATCH",
      body: { role: "ADMIN" },
      params: { slug, userId: guest.id },
    });
    expect(await audits(wsId, "member.role_changed")).toEqual([
      expect.objectContaining({ actorId: w.a.owner.id, targetId: guest.id, metadata: { from: "MEMBER", to: "ADMIN" } }),
    ]);

    await call(w.a.owner, member.DELETE, `${W(slug)}/members/${guest.id}`, {
      method: "DELETE",
      params: { slug, userId: guest.id },
    });
    expect(await audits(wsId, "member.removed")).toEqual([
      expect.objectContaining({ actorId: w.a.owner.id, targetId: guest.id, metadata: { left: false, role: "ADMIN" } }),
    ]);

    const other = await createUser("revoked");
    const second = await call(w.a.owner, invites.POST, `${W(slug)}/invites`, {
      method: "POST",
      body: { email: other.email, role: "MEMBER" },
      params: { slug },
    });
    await call(w.a.owner, invite.DELETE, `${W(slug)}/invites/${second.body.invite.id}`, {
      method: "DELETE",
      params: { slug, id: second.body.invite.id },
    });
    expect(await audits(wsId, "invite.revoked")).toEqual([
      expect.objectContaining({ actorId: w.a.owner.id, targetId: second.body.invite.id }),
    ]);

    // failures leave no trace: a rejected change writes no audit row
    const before = await prisma.auditLog.count({ where: { workspaceId: wsId } });
    await call(w.memberA, member.PATCH, `${W(slug)}/members/${w.adminA.id}`, {
      method: "PATCH",
      body: { role: "MEMBER" },
      params: { slug, userId: w.adminA.id },
    });
    expect(await prisma.auditLog.count({ where: { workspaceId: wsId } })).toBe(before);
  });
});
