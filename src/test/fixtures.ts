import { randomBytes } from "node:crypto";
import { prisma } from "@/server/db/client";

const id = () => randomBytes(6).toString("hex");

export async function createUser(label = "user") {
  const n = id();
  return prisma.user.create({
    data: {
      id: `u_${n}`,
      name: `${label} ${n}`,
      email: `${label}-${n}@example.test`,
      emailVerified: true,
    },
  });
}

/** A workspace with an owner plus one row in every tenant table. */
export async function createTenant(label: string) {
  const owner = await createUser(`${label}-owner`);
  const workspace = await prisma.workspace.create({
    data: {
      name: `${label} crypt`,
      slug: `${label}-${id()}`,
      retroRules: { create: {} },
      memberships: { create: { userId: owner.id, role: "OWNER" } },
    },
  });
  const w = workspace.id;
  const membership = await prisma.membership.findFirstOrThrow({ where: { workspaceId: w } });
  const retroRule = await prisma.retroRule.findFirstOrThrow({ where: { workspaceId: w } });

  const service = await prisma.service.create({ data: { workspaceId: w, name: `${label}-api`, slug: `${label}-api` } });
  const incident = await prisma.incident.create({
    data: {
      workspaceId: w,
      number: 1,
      title: `${label} outage`,
      severity: 3,
      createdById: owner.id,
      services: { create: { serviceId: service.id } },
      assignments: { create: { userId: owner.id, role: "COMMANDER" } },
    },
  });
  const event = await prisma.event.create({
    data: { workspaceId: w, incidentId: incident.id, type: "NOTE", body: `${label} note`, actorId: owner.id },
  });
  const assignment = await prisma.incidentAssignment.findFirstOrThrow({ where: { workspaceId: w } });
  const postmortem = await prisma.postmortem.create({
    data: {
      workspaceId: w,
      incidentId: incident.id,
      authorId: owner.id,
      templateId: "tpl_standard",
      sections: { create: { key: "CAUSE", content: {}, position: 0 } },
    },
  });
  const ritual = await prisma.actionItem.create({
    data: {
      workspaceId: w,
      postmortemId: postmortem.id,
      title: `${label} ritual`,
      ownerId: owner.id,
      dueDate: new Date(Date.now() + 86_400_000),
    },
  });
  const invite = await prisma.invite.create({
    data: {
      workspaceId: w,
      email: `invitee-${id()}@example.test`,
      tokenHash: `hash-${id()}`,
      invitedById: owner.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  const integration = await prisma.integration.create({ data: { workspaceId: w, kind: "slack" } });
  const section = await prisma.postmortemSection.findFirstOrThrow({ where: { workspaceId: w } });
  const template = await prisma.postmortemTemplate.create({
    data: { workspaceId: w, name: `${label} template`, isSystem: true, sections: [{ key: "CAUSE", position: 0 }] },
  });
  const audit = await prisma.auditLog.create({
    data: { workspaceId: w, actorId: owner.id, action: "workspace.created", targetType: "workspace", targetId: w },
  });

  return {
    owner, workspace, membership, retroRule, service, incident, assignment,
    event, postmortem, section, ritual, invite, integration, template, audit,
  };
}

export type Tenant = Awaited<ReturnType<typeof createTenant>>;

/** Minimal team: one workspace with an owner. Tests add only the rows they need. */
export async function createTeam(label = "team") {
  const owner = await createUser(`${label}-owner`);
  const workspace = await prisma.workspace.create({
    data: {
      name: `${label} crypt`,
      slug: `${label}-${owner.id.slice(2)}`,
      retroRules: { create: {} },
      memberships: { create: { userId: owner.id, role: "OWNER" } },
    },
  });
  return { owner, workspace };
}

export async function addMember(workspaceId: string, role: "OWNER" | "ADMIN" | "MEMBER", label?: string) {
  const user = await createUser(label ?? role.toLowerCase());
  await prisma.membership.create({ data: { workspaceId, userId: user.id, role } });
  return user;
}
