import { describe, expect, it } from "vitest";
import type { Role } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { acceptInvite, createWorkspaceWithOwner, findInviteByToken } from "@/server/db/root";
import { forWorkspace } from "@/server/db/tenant";
import { hashInviteToken } from "@/server/invites/token";
import { createUser } from "@/test/fixtures";
import { changeMemberRole, inviteMember, removeMember, revokeInvite } from "./members";

/** Minimal team: one workspace with an owner. Tests add only the rows they need. */
async function createTeam() {
  const owner = await createUser("team-owner");
  const workspace = await prisma.workspace.create({
    data: {
      name: "team crypt",
      slug: `team-${owner.id}`,
      retroRule: { create: {} },
      memberships: { create: { userId: owner.id, role: "OWNER" } },
    },
  });
  return { owner, workspace };
}

async function setup() {
  const t = await createTeam();
  const ctxFor = async (userId: string) => {
    const membership = await prisma.membership.findFirstOrThrow({
      where: { workspaceId: t.workspace.id, userId },
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { db: forWorkspace(t.workspace.id), workspace: t.workspace, membership, user };
  };
  const addMember = async (role: Role) => {
    const user = await createUser(role.toLowerCase());
    await prisma.membership.create({ data: { workspaceId: t.workspace.id, userId: user.id, role } });
    return user;
  };
  return { t, ctxFor, addMember };
}

type Setup = Awaited<ReturnType<typeof setup>>;

describe("inviteMember", () => {
  it.concurrent("lets owners and admins invite, stores only a hash, and replaces earlier invites", async () => {
    const s = await setup();
    const admin = await s.addMember("ADMIN");
    const ctx = await s.ctxFor(admin.id);
    const email = "newbie@example.test";

    const first = await inviteMember(ctx, { email, role: "MEMBER" });
    const second = await inviteMember(ctx, { email, role: "ADMIN" });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const rows = await prisma.invite.findMany({ where: { workspaceId: s.t.workspace.id, email } });
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("ADMIN");
    expect(rows[0].tokenHash).toBe(hashInviteToken(second.token));
    expect(JSON.stringify(rows)).not.toContain(second.token);
    expect((await findInviteByToken(first.token)).status).toBe("not_found");
  });

  it.concurrent("blocks plain members, and admins inviting owners", async () => {
    const s = await setup();
    const member = await s.addMember("MEMBER");
    const admin = await s.addMember("ADMIN");
    expect(await inviteMember(await s.ctxFor(member.id), { email: "a@example.test", role: "MEMBER" })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await inviteMember(await s.ctxFor(admin.id), { email: "a@example.test", role: "OWNER" })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it.concurrent("refuses people who are already members", async () => {
    const s = await setup();
    const member = await s.addMember("MEMBER");
    const res = await inviteMember(await s.ctxFor(s.t.owner.id), { email: member.email, role: "MEMBER" });
    expect(res).toEqual({ ok: false, error: "already_member" });
  });

  it.concurrent("revokes pending invites", async () => {
    const s = await setup();
    const ctx = await s.ctxFor(s.t.owner.id);
    const invite = await prisma.invite.create({
      data: {
        workspaceId: s.t.workspace.id,
        email: "pending@example.test",
        tokenHash: `hash-${s.t.workspace.id}`,
        invitedById: s.t.owner.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    expect(await revokeInvite(ctx, invite.id)).toEqual({ ok: true });
    expect(await revokeInvite(ctx, invite.id)).toEqual({ ok: false, error: "not_found" });
  });
});

describe("acceptInvite", () => {
  async function invited(s: Setup, role: Role = "MEMBER") {
    const email = `guest-${Math.random().toString(36).slice(2)}@example.test`;
    const res = await inviteMember(await s.ctxFor(s.t.owner.id), { email, role });
    if (!res.ok) throw new Error("invite failed");
    const user = await prisma.user.create({
      data: { id: `u_${Math.random().toString(36).slice(2)}`, name: "Guest", email, emailVerified: true },
    });
    return { token: res.token, user, email };
  }

  it.concurrent("creates the membership with the invited role, once", async () => {
    const s = await setup();
    const { token, user, email } = await invited(s, "ADMIN");
    const first = await acceptInvite({ rawToken: token, userId: user.id, userEmail: email });
    expect(first).toEqual({ status: "accepted", slug: s.t.workspace.slug });
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: user.id } });
    expect(m.role).toBe("ADMIN");
    expect((await acceptInvite({ rawToken: token, userId: user.id, userEmail: email })).status).toBe("used");
  });

  it.concurrent("matches email case-insensitively but rejects a different account", async () => {
    const s = await setup();
    const { token, user, email } = await invited(s);
    const other = await createUser("other");
    expect((await acceptInvite({ rawToken: token, userId: other.id, userEmail: other.email })).status).toBe(
      "wrong_email",
    );
    expect((await acceptInvite({ rawToken: token, userId: user.id, userEmail: email.toUpperCase() })).status).toBe(
      "accepted",
    );
  });

  it.concurrent("rejects expired and unknown tokens", async () => {
    const s = await setup();
    const { token, user, email } = await invited(s);
    await prisma.invite.updateMany({
      where: { tokenHash: hashInviteToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await acceptInvite({ rawToken: token, userId: user.id, userEmail: email })).status).toBe("expired");
    expect((await acceptInvite({ rawToken: "nope", userId: user.id, userEmail: email })).status).toBe("not_found");
  });

  it.concurrent("two simultaneous accepts create exactly one membership", async () => {
    const s = await setup();
    const { token, user, email } = await invited(s);
    const results = await Promise.all([
      acceptInvite({ rawToken: token, userId: user.id, userEmail: email }),
      acceptInvite({ rawToken: token, userId: user.id, userEmail: email }),
    ]);
    expect(results.filter((r) => r.status === "accepted")).toHaveLength(1);
    expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(1);
  });
});

describe("changeMemberRole", () => {
  it.concurrent("never leaves a workspace without an owner", async () => {
    const s = await setup();
    const res = await changeMemberRole(await s.ctxFor(s.t.owner.id), s.t.owner.id, "MEMBER");
    expect(res).toEqual({ ok: false, error: "last_owner" });
  });

  it.concurrent("allows demoting an owner once another owner exists", async () => {
    const s = await setup();
    const second = await s.addMember("OWNER");
    const res = await changeMemberRole(await s.ctxFor(second.id), s.t.owner.id, "ADMIN");
    expect(res).toEqual({ ok: true });
  });

  it.concurrent("stops admins from touching owners or promoting to owner", async () => {
    const s = await setup();
    const admin = await s.addMember("ADMIN");
    const member = await s.addMember("MEMBER");
    const ctx = await s.ctxFor(admin.id);
    expect(await changeMemberRole(ctx, s.t.owner.id, "MEMBER")).toEqual({ ok: false, error: "forbidden" });
    expect(await changeMemberRole(ctx, member.id, "OWNER")).toEqual({ ok: false, error: "forbidden" });
    expect(await changeMemberRole(ctx, member.id, "ADMIN")).toEqual({ ok: true });
  });

  it.concurrent("two owners demoting each other at once still leaves one owner", async () => {
    const s = await setup();
    const second = await s.addMember("OWNER");
    const [c1, c2] = await Promise.all([s.ctxFor(s.t.owner.id), s.ctxFor(second.id)]);
    await Promise.allSettled([
      changeMemberRole(c1, second.id, "MEMBER"),
      changeMemberRole(c2, s.t.owner.id, "MEMBER"),
    ]);
    expect(await prisma.membership.count({ where: { workspaceId: s.t.workspace.id, role: "OWNER" } })).toBeGreaterThanOrEqual(1);
  });

  it.concurrent("returns not_found for people outside the workspace", async () => {
    const s = await setup();
    const stranger = await createUser("stranger");
    expect(await changeMemberRole(await s.ctxFor(s.t.owner.id), stranger.id, "ADMIN")).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("removeMember", () => {
  it.concurrent("protects the last owner, even from themselves", async () => {
    const s = await setup();
    expect(await removeMember(await s.ctxFor(s.t.owner.id), s.t.owner.id)).toEqual({ ok: false, error: "last_owner" });
  });

  it.concurrent("stops admins removing owners", async () => {
    const s = await setup();
    const admin = await s.addMember("ADMIN");
    await s.addMember("OWNER");
    expect(await removeMember(await s.ctxFor(admin.id), s.t.owner.id)).toEqual({ ok: false, error: "forbidden" });
  });

  it.concurrent("blocks removal while the member owns unfinished rituals, then allows it", async () => {
    const s = await setup();
    // give the owner an open ritual (and an incident role to prove cascade); a second owner keeps last_owner out of the way
    const w = s.t.workspace.id;
    const incident = await prisma.incident.create({
      data: {
        workspaceId: w, number: 1, title: "x", severity: 3, createdById: s.t.owner.id,
        assignments: { create: { userId: s.t.owner.id, role: "COMMANDER" } },
        postmortem: {
          create: {
            authorId: s.t.owner.id,
            rituals: { create: { title: "r", ownerId: s.t.owner.id, dueDate: new Date() } },
          },
        },
      },
    });
    void incident;
    const second = await s.addMember("OWNER");
    const ctx = await s.ctxFor(second.id);
    expect(await removeMember(ctx, s.t.owner.id)).toEqual({ ok: false, error: "has_rituals" });
    await prisma.actionItem.updateMany({
      where: { workspaceId: s.t.workspace.id },
      data: { status: "DONE" },
    });
    expect(await removeMember(ctx, s.t.owner.id)).toEqual({ ok: true });
    expect(await prisma.incidentAssignment.count({ where: { userId: s.t.owner.id } })).toBe(0);
  });

  it.concurrent("lets a member leave", async () => {
    const s = await setup();
    const member = await s.addMember("MEMBER");
    expect(await removeMember(await s.ctxFor(member.id), member.id)).toEqual({ ok: true });
  });
});

describe("createWorkspaceWithOwner", () => {
  it.concurrent("makes unique slugs, an owner membership and a default retro rule", async () => {
    const user = await createUser("founder");
    const w1 = await createWorkspaceWithOwner({ userId: user.id, name: "Acme Platform!" });
    const w2 = await createWorkspaceWithOwner({ userId: user.id, name: "Acme Platform!" });
    expect(w1.slug).toBe("acme-platform");
    expect(w2.slug).not.toBe(w1.slug);
    const m = await prisma.membership.findFirstOrThrow({ where: { workspaceId: w1.id, userId: user.id } });
    expect(m.role).toBe("OWNER");
    expect(await prisma.retroRule.count({ where: { workspaceId: w1.id } })).toBe(1);
  });
});
