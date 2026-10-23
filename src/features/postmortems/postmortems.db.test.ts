import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as incidentPmRoute from "@/app/api/w/[slug]/incidents/[number]/postmortem/route";
import * as publishRoute from "@/app/api/w/[slug]/incidents/[number]/postmortem/publish/route";
import * as timelineRoute from "@/app/api/w/[slug]/incidents/[number]/postmortem/timeline/route";
import * as unpublishRoute from "@/app/api/w/[slug]/incidents/[number]/postmortem/unpublish/route";
import * as listRoute from "@/app/api/w/[slug]/postmortems/route";
import * as templatesRoute from "@/app/api/w/[slug]/postmortem-templates/route";
import { prisma } from "@/server/db/client";
import { call, type TestUser } from "@/test/api";
import { addMember, createTeam } from "@/test/fixtures";
import { MAX_CONTENT_BYTES, docText, type Doc, type DocNode } from "./content";
import { BUILT_IN_TEMPLATES } from "./sections";

vi.mock("@/server/auth/session", async () => {
  const { currentTestUser } = await import("@/test/api");
  return { getSession: async () => (currentTestUser() ? { user: currentTestUser(), session: {} } : null) };
});

const DAY = 86_400_000;
const days = (n: number) => new Date(Date.now() - n * DAY);
const doc = (...texts: string[]): Doc => ({
  type: "doc",
  content: texts.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] }) as DocNode),
});
const LONG = "This section has comfortably more than twenty characters.";
const complete = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, doc(LONG)]));
const STANDARD_REQUIRED = ["summary", "impact", "root_cause", "lessons"];
const QUICK = ["summary", "root_cause", "lessons"];

// ---- route helpers -----------------------------------------------------------------------------------------------
const pmPath = (slug: string, n: number) => `/api/w/${slug}/incidents/${n}/postmortem`;
const params = (slug: string, n: number) => ({ slug, number: String(n) });
const get = (u: TestUser, slug: string, n: number) =>
  call(u, incidentPmRoute.GET, pmPath(slug, n), { params: params(slug, n) });
const start = (u: TestUser, slug: string, n: number, body: unknown = {}) =>
  call(u, incidentPmRoute.POST, pmPath(slug, n), { method: "POST", body, params: params(slug, n) });
const save = (u: TestUser, slug: string, n: number, body: unknown) =>
  call(u, incidentPmRoute.PATCH, pmPath(slug, n), { method: "PATCH", body, params: params(slug, n) });
const publish = (u: TestUser, slug: string, n: number) =>
  call(u, publishRoute.POST, `${pmPath(slug, n)}/publish`, { method: "POST", params: params(slug, n) });
const unpublish = (u: TestUser, slug: string, n: number) =>
  call(u, unpublishRoute.POST, `${pmPath(slug, n)}/unpublish`, { method: "POST", params: params(slug, n) });
const snapshot = (u: TestUser, slug: string, n: number) =>
  call(u, timelineRoute.GET, `${pmPath(slug, n)}/timeline`, { params: params(slug, n) });
const list = (u: TestUser, slug: string, query = "") =>
  call(u, listRoute.GET, `/api/w/${slug}/postmortems${query ? `?${query}` : ""}`, { params: { slug } });
const templates = (u: TestUser, slug: string) =>
  call(u, templatesRoute.GET, `/api/w/${slug}/postmortem-templates`, { params: { slug } });

async function incident(
  workspaceId: string,
  createdById: string,
  number: number,
  over: Partial<{
    title: string;
    summary: string;
    severity: number;
    status: "INVESTIGATING" | "RESOLVED";
    resolvedAt: Date | null;
    startedAt: Date;
  }> = {},
) {
  const status = over.status ?? "RESOLVED";
  return prisma.incident.create({
    data: {
      workspaceId,
      number,
      title: over.title ?? `Incident ${number}`,
      summary: over.summary ?? "",
      severity: over.severity ?? 3,
      status,
      startedAt: over.startedAt ?? days(3),
      resolvedAt: over.resolvedAt === undefined ? (status === "RESOLVED" ? days(1) : null) : over.resolvedAt,
      createdById,
    },
  });
}

let w: Awaited<ReturnType<typeof world>>;
async function world() {
  const a = await createTeam("pm-a");
  const admin = await addMember(a.workspace.id, "ADMIN");
  const m1 = await addMember(a.workspace.id, "MEMBER");
  const m2 = await addMember(a.workspace.id, "MEMBER");
  const b = await createTeam("pm-b");
  const outsider = await addMember(b.workspace.id, "MEMBER");
  const wsId = a.workspace.id;
  const own = a.owner.id;
  const inc = {
    prefill: await incident(wsId, own, 1, {
      severity: 4,
      summary: "Users saw **errors** on checkout.\n\n- Cause: pool exhaustion\n- Fix: rollback",
    }),
    quick: await incident(wsId, own, 2, { severity: 2, summary: "A small thing." }),
    noKey: await incident(wsId, own, 3, { severity: 3 }),
    edit: await incident(wsId, own, 4),
    pub: await incident(wsId, own, 5),
    perms: await incident(wsId, own, 6),
    race: await incident(wsId, own, 7),
    open: await incident(wsId, own, 8, { status: "INVESTIGATING", resolvedAt: null, severity: 4 }),
    safety: await incident(wsId, own, 9),
    timelineRefresh: await incident(wsId, own, 10),
    nothing: await incident(wsId, own, 11),
  };
  const incB = await incident(b.workspace.id, b.owner.id, 1, { severity: 4 });
  // key moments on #1 (out of order on purpose) and status changes on #3
  const ev = (incidentId: string, over: Record<string, unknown>) =>
    prisma.event.create({ data: { workspaceId: wsId, incidentId, type: "NOTE", actorId: own, ...over } as never });
  await ev(inc.prefill.id, {
    body: "Rollback started\nwith more detail on line two",
    isKeyMoment: true,
    occurredAt: new Date("2026-06-10T10:30:00Z"),
  });
  await ev(inc.prefill.id, { body: "Alerts fired", isKeyMoment: true, occurredAt: new Date("2026-06-10T10:05:00Z") });
  await ev(inc.prefill.id, { body: "Not a key moment", occurredAt: new Date("2026-06-10T10:10:00Z") });
  await ev(inc.noKey.id, {
    type: "STATUS_CHANGED",
    source: "SYSTEM",
    payload: { to: "INVESTIGATING", created: true },
    occurredAt: new Date("2026-06-11T09:00:00Z"),
  });
  await ev(inc.noKey.id, {
    type: "STATUS_CHANGED",
    payload: { from: "INVESTIGATING", to: "RESOLVED" },
    occurredAt: new Date("2026-06-11T11:00:00Z"),
  });
  await ev(inc.noKey.id, { body: "Plain note, ignored", occurredAt: new Date("2026-06-11T10:00:00Z") });
  return { a, b, admin, m1, m2, outsider, inc, incB, slug: a.workspace.slug, bSlug: b.workspace.slug, wsId };
}

beforeAll(async () => {
  w = await world();
});

describe("isolation", () => {
  it("answers 404 to everyone who is not a member, on every postmortem route", async () => {
    await start(w.a.owner, w.slug, 4); // make sure there is something to find
    const o = w.outsider;
    const checks = [
      await get(o, w.slug, 4),
      await start(o, w.slug, 5),
      await save(o, w.slug, 4, { version: 1, sections: {} }),
      await publish(o, w.slug, 4),
      await unpublish(o, w.slug, 4),
      await snapshot(o, w.slug, 4),
      await list(o, w.slug),
      await templates(o, w.slug),
    ];
    expect(checks.map((c) => c.status)).toEqual([404, 404, 404, 404, 404, 404, 404, 404]);
    expect(await prisma.postmortem.count({ where: { incidentId: w.inc.pub.id } })).toBe(0);
  });

  it("answers 401 when signed out", async () => {
    expect((await get(null, w.slug, 4)).status).toBe(401);
    expect((await list(null, w.slug)).status).toBe(401);
  });

  it("never lets workspace A reach workspace B's postmortems, or B's incident numbers", async () => {
    const b = w.b.owner;
    expect((await start(b, w.bSlug, 1)).status).toBe(201);
    const seen = await get(b, w.bSlug, 1);
    expect(seen.status).toBe(200);
    // A's owner asks for B's incident through A's slug (same number exists in both): they get A's, never B's
    const bId = seen.body.postmortem.id;
    expect((await get(w.a.owner, w.slug, 1)).status).toBe(404); // A's #1 has none yet
    expect((await publish(w.a.owner, w.bSlug, 1)).status).toBe(404); // not a member of B
    expect(
      (await list(w.a.owner, w.slug)).body.items.map((r: { postmortemId: string }) => r.postmortemId),
    ).not.toContain(bId);
    expect((await list(b, w.bSlug)).body.items.map((r: { postmortemId: string }) => r.postmortemId)).toContain(bId);
  });

  it("refuses another workspace's custom template", async () => {
    const other = await prisma.postmortemTemplate.create({
      data: { workspaceId: w.b.workspace.id, name: "B only", sections: [{ key: "summary", required: true, order: 0 }] },
    });
    const res = await start(w.a.owner, w.slug, 11, { templateId: other.id });
    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors.templateId).toEqual(["invalid_template"]);
    expect((await start(w.a.owner, w.slug, 11, { templateId: "no-such-template" })).status).toBe(400);
    expect(await prisma.postmortem.count({ where: { incidentId: w.inc.nothing.id } })).toBe(0);
  });
});

describe("templates", () => {
  it("lists the two built-in templates", async () => {
    const res = await templates(w.m1, w.slug);
    expect(res.status).toBe(200);
    expect(res.body.templates.map((t: { id: string }) => t.id)).toEqual(["tpl_standard", "tpl_quick"]);
    expect(
      res.body.templates[0].sections
        .filter((s: { required: boolean }) => s.required)
        .map((s: { key: string }) => s.key),
    ).toEqual(STANDARD_REQUIRED);
    expect(res.body.templates[1].sections.map((s: { key: string }) => s.key)).toEqual(QUICK);
  });

  it("matches what the migration put in the database", async () => {
    const rows = await prisma.postmortemTemplate.findMany({ where: { workspaceId: null }, orderBy: { id: "desc" } });
    expect(rows.map((r) => r.id)).toEqual(["tpl_standard", "tpl_quick"]);
    for (const t of BUILT_IN_TEMPLATES) {
      const row = rows.find((r) => r.id === t.id)!;
      expect(row.sections).toEqual(t.sections);
      expect(row).toMatchObject({ name: t.name, isDefault: t.isDefault, isSystem: true });
    }
  });

  it("also shows a workspace's own templates, and only its own", async () => {
    const mine = await prisma.postmortemTemplate.create({
      data: { workspaceId: w.wsId, name: "Mine", sections: [{ key: "summary", required: true, order: 0 }] },
    });
    const ids = (await templates(w.m1, w.slug)).body.templates.map((t: { id: string }) => t.id);
    expect(ids).toContain(mine.id);
    expect((await templates(w.b.owner, w.bSlug)).body.templates.map((t: { id: string }) => t.id)).not.toContain(
      mine.id,
    );
  });
});

describe("starting a postmortem", () => {
  it("lets any member start one, defaulting the template by severity", async () => {
    const hi = await start(w.m1, w.slug, 1);
    expect(hi.status).toBe(201);
    expect(hi.body.postmortem).toMatchObject({
      status: "DRAFT",
      version: 1,
      templateId: "tpl_standard",
      authorId: w.m1.id,
    });
    const lo = await start(w.m2, w.slug, 2);
    expect(lo.body.postmortem.templateId).toBe("tpl_quick");
    expect(lo.body.template.sections.map((s: { key: string }) => s.key)).toEqual(QUICK);
  });

  it("can start with the other template", async () => {
    const res = await start(w.m1, w.slug, 8, { templateId: "tpl_quick" }); // an open incident, quick template
    expect(res.status).toBe(201);
    expect(res.body.postmortem.templateId).toBe("tpl_quick");
  });

  it("pre-fills the summary from the incident, keeping its formatting", async () => {
    const { postmortem } = (await get(w.m1, w.slug, 1)).body;
    const summary = postmortem.sections.summary as Doc;
    expect(summary.content?.map((n) => n.type)).toEqual(["paragraph", "bulletList"]);
    expect(docText(summary)).toContain("Users saw errors on checkout.");
    expect(JSON.stringify(summary)).toContain('"bold"');
    expect(postmortem.sections.root_cause).toBeUndefined(); // left empty
    expect(postmortem.sections.impact).toBeUndefined();
    const quick = (await get(w.m1, w.slug, 2)).body.postmortem;
    expect(docText(quick.sections.summary)).toBe("A small thing.");
  });

  it("builds the timeline section from key moments, in time order, as an editable snapshot", async () => {
    const { postmortem } = (await get(w.m1, w.slug, 1)).body;
    const lines = (postmortem.sections.timeline as Doc).content![0].content!.map((li) =>
      docText({ type: "doc", content: li.content }),
    );
    expect(lines).toEqual(["2026-06-10 10:05 UTC: Alerts fired", "2026-06-10 10:30 UTC: Rollback started"]); // first line only, no plain notes
    // the quick template has no timeline section
    expect((await get(w.m1, w.slug, 2)).body.postmortem.sections.timeline).toBeUndefined();
  });

  it("falls back to the status changes when nothing is marked as a key moment", async () => {
    const created = await start(w.m1, w.slug, 3);
    const timeline = created.body.postmortem.sections.timeline as Doc;
    const lines = timeline.content![0].content!.map((li) => docText({ type: "doc", content: li.content }));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^2026-06-11 09:00 UTC: .+/);
    expect(lines[1]).toMatch(/^2026-06-11 11:00 UTC: .*Lurking.*Laid to Rest/); // workspaces default to the haunted skin
  });

  it("omits the timeline section when the incident has no timeline to snapshot", async () => {
    const res = await start(w.m1, w.slug, 11);
    expect(res.status).toBe(201);
    expect(res.body.postmortem.sections.timeline).toBeUndefined();
  });

  it("refreshes the snapshot on request, reflecting the current timeline", async () => {
    const t = await snapshot(w.m1, w.slug, 1);
    expect(t.status).toBe(200);
    expect(docText(t.body.doc)).toContain("Alerts fired");
    await prisma.event.create({
      data: {
        workspaceId: w.wsId,
        incidentId: w.inc.prefill.id,
        type: "NOTE",
        actorId: w.a.owner.id,
        body: "Fixed",
        isKeyMoment: true,
        occurredAt: new Date("2026-06-10T11:00:00Z"),
      },
    });
    expect(docText((await snapshot(w.m1, w.slug, 1)).body.doc)).toContain("11:00 UTC: Fixed");
    expect((await snapshot(w.m1, w.slug, 999)).status).toBe(404);
  });

  it("allows only one per incident: the second attempt is a 409 and creates nothing", async () => {
    const again = await start(w.m2, w.slug, 1);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("postmortem_exists");
    expect(await prisma.postmortem.count({ where: { incidentId: w.inc.prefill.id } })).toBe(1);
  });

  it("lets only one of two simultaneous starts win", async () => {
    const [x, y] = await Promise.all([start(w.m1, w.slug, 6), start(w.m2, w.slug, 6)]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    expect(await prisma.postmortem.count({ where: { incidentId: w.inc.perms.id } })).toBe(1);
    expect(await prisma.event.count({ where: { incidentId: w.inc.perms.id, type: "POSTMORTEM_STARTED" } })).toBe(1);
  });

  it("writes the 'started' timeline event with the actor", async () => {
    const events = await prisma.event.findMany({ where: { incidentId: w.inc.prefill.id, type: "POSTMORTEM_STARTED" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: w.m1.id, source: "USER" });
  });

  it("answers 404 for an incident that doesn't exist, and for a deleted one", async () => {
    expect((await start(w.m1, w.slug, 999)).status).toBe(404);
    expect((await start(w.m1, w.slug, 0)).status).toBe(404);
    const gone = await incident(w.wsId, w.a.owner.id, 50, { title: "deleted" });
    await prisma.incident.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    expect((await start(w.m1, w.slug, 50)).status).toBe(404);
  });
});

describe("autosave", () => {
  it("saves some sections, leaves the others alone, and bumps the version", async () => {
    const created = (await get(w.m1, w.slug, 4)).body;
    expect(created.postmortem.version).toBe(1);
    const first = await save(w.m1, w.slug, 4, { version: 1, sections: { root_cause: doc(LONG) } });
    expect(first.status).toBe(200);
    expect(first.body.postmortem.version).toBe(2);
    const second = await save(w.m2, w.slug, 4, {
      version: 2,
      sections: { lessons: doc("Learned a lot here, honestly") },
    });
    expect(second.body.postmortem.version).toBe(3);
    const now = (await get(w.m1, w.slug, 4)).body.postmortem;
    expect(Object.keys(now.sections).sort()).toEqual(
      ["lessons", "root_cause", "summary", "timeline"].filter((k) => now.sections[k]),
    );
    expect(docText(now.sections.root_cause)).toBe(LONG);
    expect(docText(now.sections.lessons)).toBe("Learned a lot here, honestly");
    // an empty save still counts as a save
    expect((await save(w.m1, w.slug, 4, { version: 3, sections: {} })).body.postmortem.version).toBe(4);
  });

  it("rejects a stale version with 409 and the latest content, changing nothing", async () => {
    const before = (await get(w.m1, w.slug, 4)).body.postmortem;
    const stale = await save(w.m2, w.slug, 4, {
      version: before.version - 1,
      sections: { root_cause: doc("My stale overwrite of the cause") },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("version_conflict");
    expect(stale.body.latest.postmortem.version).toBe(before.version);
    expect(docText(stale.body.latest.postmortem.sections.root_cause)).toBe(LONG);
    const after = (await get(w.m1, w.slug, 4)).body.postmortem;
    expect(after).toEqual(before);
    // a version from the future is just as wrong
    expect((await save(w.m1, w.slug, 4, { version: before.version + 5, sections: {} })).status).toBe(409);
  });

  it("never lets two simultaneous saves both succeed with the same version", async () => {
    await start(w.m1, w.slug, 7);
    const base = (await get(w.m1, w.slug, 7)).body.postmortem.version;
    for (let round = 0; round < 3; round += 1) {
      const v = (await get(w.m1, w.slug, 7)).body.postmortem.version;
      const results = await Promise.all([
        save(w.m1, w.slug, 7, {
          version: v,
          sections: { root_cause: doc(`writer one, round ${round}, root cause text`) },
        }),
        save(w.m2, w.slug, 7, {
          version: v,
          sections: { lessons: doc(`writer two, round ${round}, lessons learned`) },
        }),
        save(w.admin, w.slug, 7, {
          version: v,
          sections: { impact: doc(`writer three, round ${round}, impact details`) },
        }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect((await get(w.m1, w.slug, 7)).body.postmortem.version).toBe(v + 1);
    }
    expect((await get(w.m1, w.slug, 7)).body.postmortem.version).toBe(base + 3);
  });

  it("rejects malformed bodies", async () => {
    for (const body of [
      {},
      { version: 0, sections: {} },
      { version: "1", sections: {} },
      { version: 1 },
      { version: 1.5, sections: {} },
    ]) {
      expect((await save(w.m1, w.slug, 4, body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("requires a postmortem to exist", async () => {
    expect((await save(w.m1, w.slug, 8 + 100, { version: 1, sections: {} })).status).toBe(404);
    const noPm = await incident(w.wsId, w.a.owner.id, 60);
    expect((await save(w.m1, w.slug, 60, { version: 1, sections: {} })).status).toBe(404);
    expect(noPm.number).toBe(60);
  });
});

describe("content safety on save", () => {
  const versionOf = async () => (await get(w.m1, w.slug, 4)).body.postmortem.version as number;
  const trySave = async (sections: unknown) => save(w.m1, w.slug, 4, { version: await versionOf(), sections });
  const unchanged = async (v: number) => expect(await versionOf()).toBe(v);

  it.each([
    [
      "a script node",
      { summary: { type: "doc", content: [{ type: "script", content: [{ type: "text", text: "alert(1)" }] }] } },
    ],
    ["raw HTML", { summary: { type: "doc", content: [{ type: "html", text: "<img src=x onerror=alert(1)>" }] } }],
    [
      "a javascript: link",
      {
        summary: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }],
            },
          ],
        },
      },
    ],
    [
      "a heading above level 3",
      {
        summary: {
          type: "doc",
          content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "x" }] }],
        },
      },
    ],
    ["a section the template doesn't have", { not_a_section: { type: "doc", content: [] } }],
    ["a string instead of a document", { summary: "<script>alert(1)</script>" }],
  ])("rejects %s with 400 and stores nothing", async (_name, sections) => {
    const v = await versionOf();
    const res = await trySave(sections);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_content");
    await unchanged(v);
  });

  it("rejects an oversize payload with 413 and stores nothing", async () => {
    const v = await versionOf();
    const res = await trySave({ summary: doc("x".repeat(MAX_CONTENT_BYTES + 10)) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("content_too_large");
    await unchanged(v);
  });

  it("applies the size limit to the whole document, not just the part being saved", async () => {
    const v = await versionOf();
    const a = await save(w.m1, w.slug, 9, { version: 1, sections: {} }); // incident 9 has no postmortem yet
    expect(a.status).toBe(404);
    await start(w.m1, w.slug, 9);
    const half = "y".repeat(Math.floor(MAX_CONTENT_BYTES * 0.6));
    expect((await save(w.m1, w.slug, 9, { version: 1, sections: { summary: doc(half) } })).status).toBe(200);
    const over = await save(w.m1, w.slug, 9, { version: 2, sections: { impact: doc(half) } });
    expect(over.status).toBe(413);
    await unchanged(v);
  });

  it("round-trips allowed formatting exactly", async () => {
    const rich: Doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Heading" }] },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "see",
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: "https://example.com/x",
                    target: "_blank",
                    rel: "noopener noreferrer nofollow",
                    class: null,
                  },
                },
              ],
            },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "a", marks: [{ type: "bold" }, { type: "italic" }] }],
                },
              ],
            },
          ],
        },
        { type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text: "x = 1" }] },
      ],
    };
    const res = await save(w.m1, w.slug, 4, { version: await versionOf(), sections: { went_well: rich } });
    expect(res.status).toBe(200);
    expect((await get(w.m1, w.slug, 4)).body.postmortem.sections.went_well).toEqual(rich);
  });
});

describe("publishing", () => {
  it("lists the required sections that are missing or too short, and publishes nothing", async () => {
    await start(w.m1, w.slug, 5);
    const v = (await get(w.m1, w.slug, 5)).body.postmortem.version;
    await save(w.m1, w.slug, 5, { version: v, sections: { impact: doc("too short") } });
    const res = await publish(w.m1, w.slug, 5);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("missing_sections");
    expect(res.body.error.fieldErrors.sections).toEqual(["summary", "impact", "root_cause", "lessons"]); // in the template's order; impact is too short
    expect((await get(w.m1, w.slug, 5)).body.postmortem.status).toBe("DRAFT");
    expect(await prisma.event.count({ where: { incidentId: w.inc.pub.id, type: "POSTMORTEM_PUBLISHED" } })).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: {
          workspaceId: w.wsId,
          action: "postmortem.published",
          targetId: (await get(w.m1, w.slug, 5)).body.postmortem.id,
        },
      }),
    ).toBe(0);
  });

  it("only counts required sections: optional ones can stay empty", async () => {
    const v = (await get(w.m1, w.slug, 5)).body.postmortem.version;
    await save(w.m1, w.slug, 5, { version: v, sections: complete(STANDARD_REQUIRED) });
    const res = await publish(w.m2, w.slug, 5); // a different member than the author
    expect(res.status).toBe(200);
    expect(res.body.postmortem).toMatchObject({ status: "PUBLISHED", publishedById: w.m2.id });
    expect(res.body.postmortem.publishedAt).toBeTruthy();
  });

  it("records a timeline event and an audit row", async () => {
    const pm = (await get(w.m1, w.slug, 5)).body.postmortem;
    const events = await prisma.event.findMany({ where: { incidentId: w.inc.pub.id, type: "POSTMORTEM_PUBLISHED" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: w.m2.id, source: "USER" });
    const audit = await prisma.auditLog.findMany({
      where: { workspaceId: w.wsId, action: "postmortem.published", targetId: pm.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: w.m2.id, targetType: "postmortem" });
  });

  it("rejects edits and a second publish once published", async () => {
    const pm = (await get(w.m1, w.slug, 5)).body.postmortem;
    const edit = await save(w.m1, w.slug, 5, {
      version: pm.version,
      sections: { summary: doc("Trying to change a published postmortem") },
    });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe("postmortem_published");
    expect((await save(w.admin, w.slug, 5, { version: pm.version, sections: {} })).status).toBe(409); // not even an admin
    expect((await publish(w.m1, w.slug, 5)).status).toBe(409);
    expect((await get(w.m1, w.slug, 5)).body.postmortem.version).toBe(pm.version);
    expect(await prisma.event.count({ where: { incidentId: w.inc.pub.id, type: "POSTMORTEM_PUBLISHED" } })).toBe(1);
  });

  it("publishes exactly once when two members press publish together", async () => {
    await start(w.m1, w.slug, 10);
    const v = (await get(w.m1, w.slug, 10)).body.postmortem.version;
    await save(w.m1, w.slug, 10, { version: v, sections: complete(STANDARD_REQUIRED) });
    const [x, y] = await Promise.all([publish(w.m1, w.slug, 10), publish(w.m2, w.slug, 10)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(
      await prisma.event.count({ where: { incidentId: w.inc.timelineRefresh.id, type: "POSTMORTEM_PUBLISHED" } }),
    ).toBe(1);
  });

  it("requires every required section on the quick template too", async () => {
    const res = await publish(w.m2, w.slug, 2);
    expect(res.status).toBe(422);
    expect(res.body.error.fieldErrors.sections).toEqual(["summary", "root_cause", "lessons"]); // the pre-filled summary is only 14 characters
  });
});

describe("unpublishing", () => {
  it("is for admins and owners only", async () => {
    expect((await unpublish(w.m1, w.slug, 5)).status).toBe(403);
    expect((await unpublish(w.m2, w.slug, 5)).status).toBe(403);
    expect((await get(w.m1, w.slug, 5)).body.postmortem.status).toBe("PUBLISHED");
    expect(await prisma.event.count({ where: { incidentId: w.inc.pub.id, type: "POSTMORTEM_UNPUBLISHED" } })).toBe(0);
  });

  it("returns an admin's postmortem to draft, with a timeline event and an audit row", async () => {
    const before = (await get(w.m1, w.slug, 5)).body.postmortem;
    const res = await unpublish(w.admin, w.slug, 5);
    expect(res.status).toBe(200);
    expect(res.body.postmortem).toMatchObject({ status: "DRAFT", publishedAt: null, publishedById: null });
    expect(res.body.postmortem.version).toBe(before.version + 1);
    const events = await prisma.event.findMany({ where: { incidentId: w.inc.pub.id, type: "POSTMORTEM_UNPUBLISHED" } });
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe(w.admin.id);
    const audit = await prisma.auditLog.findMany({
      where: { workspaceId: w.wsId, action: "postmortem.unpublished", targetId: before.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].actorId).toBe(w.admin.id);
  });

  it("makes it editable and publishable again", async () => {
    const pm = (await get(w.m1, w.slug, 5)).body.postmortem;
    expect(
      (
        await save(w.m1, w.slug, 5, {
          version: pm.version,
          sections: { summary: doc("Edited after being unpublished, fine") },
        })
      ).status,
    ).toBe(200);
    expect((await publish(w.m1, w.slug, 5)).status).toBe(200);
    expect(await prisma.event.count({ where: { incidentId: w.inc.pub.id, type: "POSTMORTEM_PUBLISHED" } })).toBe(2);
  });

  it("works for an owner, and refuses a draft", async () => {
    expect((await unpublish(w.a.owner, w.slug, 5)).status).toBe(200);
    expect((await unpublish(w.a.owner, w.slug, 5)).status).toBe(409); // already a draft
    expect((await unpublish(w.admin, w.slug, 999)).status).toBe(404);
  });
});

describe("the postmortems list", () => {
  let c: Awaited<ReturnType<typeof listWorld>>;
  async function listWorld() {
    const team = await createTeam("pm-list");
    const m = await addMember(team.workspace.id, "MEMBER");
    const ws = team.workspace.id;
    const own = team.owner.id;
    const rows = {
      overdue: await incident(ws, own, 1, { title: "Payments outage", severity: 5, resolvedAt: days(10) }),
      dueSoon: await incident(ws, own, 2, { title: "Search down", severity: 4, resolvedAt: days(4) }),
      required: await incident(ws, own, 3, { title: "Login errors", severity: 4, resolvedAt: days(1) }),
      optional: await incident(ws, own, 4, { title: "Slow admin page", severity: 3, resolvedAt: days(1) }),
      published: await incident(ws, own, 5, { title: "Checkout timeouts", severity: 4, resolvedAt: days(20) }),
      draft: await incident(ws, own, 6, { title: "Email delays", severity: 2, resolvedAt: days(2) }),
      open: await incident(ws, own, 7, {
        title: "Still burning",
        severity: 5,
        status: "INVESTIGATING",
        resolvedAt: null,
      }),
      lowPublished: await incident(ws, own, 8, { title: "Search outage", severity: 1, resolvedAt: days(30) }),
    };
    const pm = (incidentId: string, status: "DRAFT" | "PUBLISHED", authorId: string, publishedAt?: Date) =>
      prisma.postmortem.create({
        data: {
          workspaceId: ws,
          incidentId,
          templateId: "tpl_standard",
          authorId,
          status,
          publishedAt,
          publishedById: publishedAt ? authorId : null,
        },
      });
    await pm(rows.published.id, "PUBLISHED", m.id, days(15));
    await pm(rows.lowPublished.id, "PUBLISHED", own, days(25));
    await pm(rows.draft.id, "DRAFT", m.id);
    return { team, m, rows, slug: team.workspace.slug, ws, own };
  }
  const numbers = (r: { body: { items: { number: number }[] } }) => r.body.items.map((i) => i.number);

  beforeAll(async () => {
    c = await listWorld();
  });

  it("includes postmortems and resolved incidents that require one but have none; skips the rest", async () => {
    const res = await list(c.m, c.slug);
    expect(res.status).toBe(200);
    const byNumber = Object.fromEntries(
      res.body.items.map((i: { number: number; state: string }) => [i.number, i.state]),
    );
    expect(byNumber).toEqual({
      1: "OVERDUE",
      2: "DUE_SOON",
      3: "REQUIRED",
      5: "PUBLISHED",
      6: "DRAFT",
      8: "PUBLISHED",
    });
    expect(byNumber[4]).toBeUndefined(); // sev 3 resolved, nothing required
    expect(byNumber[7]).toBeUndefined(); // still open
  });

  it("sorts by due date, most overdue first, with undated rows last", async () => {
    const res = await list(c.m, c.slug);
    expect(numbers(res).slice(0, 3)).toEqual([1, 2, 3]);
    expect(new Set(numbers(res).slice(3))).toEqual(new Set([5, 6, 8]));
    const row = res.body.items[0];
    expect(row).toMatchObject({
      number: 1,
      title: "Payments outage",
      severity: 5,
      postmortemId: null,
      author: null,
      publishedAt: null,
    });
    expect(new Date(row.dueAt).getTime()).toBeLessThan(Date.now()); // overdue
  });

  it("shows author and published date on existing postmortems", async () => {
    const res = await list(c.m, c.slug, "state=PUBLISHED");
    const checkout = res.body.items.find((i: { number: number }) => i.number === 5);
    expect(checkout.author).toMatchObject({ userId: c.m.id });
    expect(checkout.publishedAt).toBeTruthy();
    expect(checkout.postmortemId).toBeTruthy();
  });

  it("filters by state (several at once)", async () => {
    expect(numbers(await list(c.m, c.slug, "state=OVERDUE"))).toEqual([1]);
    expect(numbers(await list(c.m, c.slug, "state=DRAFT,REQUIRED")).sort()).toEqual([3, 6]);
    expect(numbers(await list(c.m, c.slug, "state=DRAFT&state=DUE_SOON")).sort()).toEqual([2, 6]);
    expect((await list(c.m, c.slug, "state=NOPE")).status).toBe(400);
  });

  it("filters by severity (several at once)", async () => {
    expect(numbers(await list(c.m, c.slug, "severity=5"))).toEqual([1]);
    expect(numbers(await list(c.m, c.slug, "severity=4,1")).sort()).toEqual([2, 3, 5, 8]);
    expect((await list(c.m, c.slug, "severity=9")).status).toBe(400);
  });

  it("'needs attention' is exactly required, due soon and overdue", async () => {
    expect(numbers(await list(c.m, c.slug, "needsAttention=1"))).toEqual([1, 2, 3]);
    expect(numbers(await list(c.m, c.slug, "attention=1&severity=4"))).toEqual([2, 3]);
  });

  it("searches by title (case-insensitive, literally) or by number", async () => {
    expect(numbers(await list(c.m, c.slug, "q=search")).sort()).toEqual([2, 8]);
    expect(numbers(await list(c.m, c.slug, "q=%25"))).toEqual([]); // % is not a wildcard
    expect(numbers(await list(c.m, c.slug, "q=3"))).toEqual([3]);
    expect(numbers(await list(c.m, c.slug, "q=INC-2"))).toEqual([2]);
    expect(numbers(await list(c.m, c.slug, "q=zzz"))).toEqual([]);
  });

  it("sorts by severity, number or published date, both ways", async () => {
    expect(numbers(await list(c.m, c.slug, "sort=number"))).toEqual([1, 2, 3, 5, 6, 8]);
    expect(numbers(await list(c.m, c.slug, "sort=number&dir=desc"))).toEqual([8, 6, 5, 3, 2, 1]);
    const bySeverity = await list(c.m, c.slug, "sort=severity");
    expect(bySeverity.body.items.map((i: { severity: number }) => i.severity)).toEqual([5, 4, 4, 4, 2, 1]);
    const published = await list(c.m, c.slug, "sort=published&dir=desc");
    expect(numbers(published).slice(0, 2)).toEqual([5, 8]); // most recently published first; unpublished last
    expect(numbers(await list(c.m, c.slug, "sort=due&dir=desc")).slice(0, 3)).toEqual([3, 2, 1]);
    expect((await list(c.m, c.slug, "sort=bogus")).status).toBe(400);
  });

  it("is empty for a workspace with nothing to show", async () => {
    const empty = await createTeam("pm-empty");
    const res = await list(empty.owner, empty.workspace.slug);
    expect(res.body).toEqual({ items: [], nextCursor: null });
  });

  it("pages through everything exactly once, in both directions and with ties", async () => {
    const team = await createTeam("pm-page");
    const ws = team.workspace.id;
    const tie = days(9);
    await prisma.incident.createMany({
      data: Array.from({ length: 53 }, (_, i) => ({
        workspaceId: ws,
        number: i + 1,
        title: `Outage ${i + 1}`,
        severity: 5 - (i % 3), // 5, 4, 3
        status: "RESOLVED" as const,
        startedAt: days(20),
        // every third incident shares a resolve time, so due dates tie
        resolvedAt: i % 3 === 0 ? tie : days(2 + (i % 17)),
        createdById: team.owner.id,
      })),
    });
    const required = 53 - Math.ceil(53 / 3) * 0 - [...Array(53).keys()].filter((i) => 5 - (i % 3) < 4).length;
    for (const [sort, dir] of [
      ["due", "asc"],
      ["due", "desc"],
      ["severity", "desc"],
      ["number", "asc"],
    ] as const) {
      for (const limit of [7, 25, 100]) {
        const seen: number[] = [];
        let cursor: string | null = null;
        for (let guard = 0; guard < 40; guard += 1) {
          const res: Awaited<ReturnType<typeof list>> = await list(
            team.owner,
            team.workspace.slug,
            `sort=${sort}&dir=${dir}&limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`,
          );
          expect(res.status).toBe(200);
          seen.push(...numbers(res));
          cursor = res.body.nextCursor;
          if (!cursor) break;
        }
        expect(seen.length, `${sort} ${dir} ${limit}`).toBe(required);
        expect(new Set(seen).size, `${sort} ${dir} ${limit} has no repeats`).toBe(required);
      }
    }
    expect((await list(team.owner, team.workspace.slug, "limit=0")).status).toBe(400);
    expect((await list(team.owner, team.workspace.slug, "limit=101")).status).toBe(400);
    expect((await list(team.owner, team.workspace.slug, "limit=5")).body.items).toHaveLength(5);
  });

  it("keeps working when the cursor row has since changed or disappeared", async () => {
    const first = await list(c.m, c.slug, "limit=2");
    expect(numbers(first)).toEqual([1, 2]);
    await prisma.incident.update({ where: { id: c.rows.overdue.id }, data: { deletedAt: new Date() } });
    const next = await list(c.m, c.slug, `limit=2&cursor=${first.body.nextCursor}`);
    expect(numbers(next)).toEqual([3, expect.any(Number)]);
    expect(await list(c.m, c.slug, "cursor=garbage")).toMatchObject({ status: 200 });
  });
});

describe("retro rules", () => {
  it("gives a new workspace the default rule: severity 4 and up REQUIRED, due in 5 days", async () => {
    const team = await createTeam("pm-rule");
    const rules = await prisma.retroRule.findMany({ where: { workspaceId: team.workspace.id } });
    expect(rules).toEqual([expect.objectContaining({ minSeverity: 4, mode: "REQUIRED", dueInDays: 5 })]);
  });

  it("allows several rules per workspace, but one per severity", async () => {
    const team = await createTeam("pm-rules");
    await prisma.retroRule.create({
      data: { workspaceId: team.workspace.id, minSeverity: 2, mode: "SKIP", dueInDays: 3 },
    });
    expect(await prisma.retroRule.count({ where: { workspaceId: team.workspace.id } })).toBe(2);
    await expect(
      prisma.retroRule.create({ data: { workspaceId: team.workspace.id, minSeverity: 2, mode: "OPTIONAL" } }),
    ).rejects.toThrow();
  });

  it("is backfilled by the migration for workspaces that had none, and leaves existing rules alone", async () => {
    const sql = readFileSync("prisma/migrations/20261027100000_postmortems/migration.sql", "utf8");
    const backfill = /INSERT INTO "RetroRule"[\s\S]*?;/.exec(sql)![0];
    const bare = await prisma.workspace.create({
      data: { name: "bare", slug: `bare-${Math.random().toString(36).slice(2, 8)}` },
    });
    const tuned = await createTeam("pm-tuned");
    await prisma.retroRule.updateMany({
      where: { workspaceId: tuned.workspace.id },
      data: { minSeverity: 3, mode: "SKIP", dueInDays: 9 },
    });
    expect(await prisma.retroRule.count({ where: { workspaceId: bare.id } })).toBe(0);

    // the test database is a throwaway schema, so qualify the tables the migration names bare
    const schema = process.env.DATABASE_SCHEMA!;
    const scoped = backfill
      .replaceAll('"RetroRule"', `"${schema}"."RetroRule"`)
      .replaceAll('"Workspace"', `"${schema}"."Workspace"`);
    await prisma.$executeRawUnsafe(scoped);
    await prisma.$executeRawUnsafe(scoped); // and it's safe to run twice

    expect(await prisma.retroRule.findMany({ where: { workspaceId: bare.id } })).toEqual([
      expect.objectContaining({ minSeverity: 4, mode: "REQUIRED", dueInDays: 5 }),
    ]);
    expect(await prisma.retroRule.findMany({ where: { workspaceId: tuned.workspace.id } })).toEqual([
      expect.objectContaining({ minSeverity: 3, mode: "SKIP", dueInDays: 9 }),
    ]);
  });
});
