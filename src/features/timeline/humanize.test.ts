import { describe, expect, it } from "vitest";
import { getCopy, severityName, type SkinKey } from "@/copy";
import { humanizeEvent, referencedUserIds, type HumanizeContext } from "./humanize";

const NAMES: Record<string, string> = { u1: "Alex", u2: "Sam", u3: "Priya" };

function ctx(skin: SkinKey = "professional", overrides: Record<string, string> | null = null): HumanizeContext {
  const t = getCopy(skin);
  return {
    t,
    nameOf: (id) => (id ? (NAMES[id] ?? t.timeline.actorFormerMember) : t.timeline.actorSystem),
    severityLabel: (level) => severityName(t, level as 1, overrides),
  };
}
const say = (type: string, payload: unknown, c = ctx()) => humanizeEvent({ type, payload }, c);

describe("humanizeEvent: professional skin", () => {
  it("status changes and creation", () => {
    expect(say("STATUS_CHANGED", { from: "INVESTIGATING", to: "IDENTIFIED" })).toBe(
      "Status changed from Investigating to Identified",
    );
    expect(say("STATUS_CHANGED", { from: "RESOLVED", to: "INVESTIGATING" })).toBe(
      "Status changed from Resolved to Investigating",
    );
    expect(say("STATUS_CHANGED", { to: "MITIGATING", created: true })).toBe("Incident declared as Mitigating");
    expect(say("STATUS_CHANGED", { to: "RESOLVED" })).toBe("Status changed to Resolved"); // no "from"
  });

  it("severity says raised, lowered or changed, using the workspace's names", () => {
    expect(say("SEVERITY_CHANGED", { from: 3, to: 4 })).toBe("Severity raised from Medium to High");
    expect(say("SEVERITY_CHANGED", { from: 5, to: 2 })).toBe("Severity lowered from Critical to Low");
    expect(say("SEVERITY_CHANGED", { from: 3, to: 3 })).toBe("Severity changed to Medium");
    expect(say("SEVERITY_CHANGED", { to: 5 })).toBe("Severity changed to Critical");
    expect(say("SEVERITY_CHANGED", { from: 3, to: 4 }, ctx("professional", { "3": "Sev 3", "4": "Sev 2" }))).toBe(
      "Severity raised from Sev 3 to Sev 2",
    );
  });

  it("role assignment, replacement and removal read naturally", () => {
    expect(say("ROLE_ASSIGNED", { role: "COMMANDER", from: null, to: "u1" })).toBe("Alex was assigned as Commander");
    expect(say("ROLE_ASSIGNED", { role: "SCRIBE", from: "u2", to: "u1" })).toBe("Alex replaced Sam as Scribe");
    expect(say("ROLE_UNASSIGNED", { role: "COMMS", from: "u2", to: null })).toBe("Sam was unassigned as Comms");
  });

  it("people who have since left still get a readable name", () => {
    expect(say("ROLE_ASSIGNED", { role: "COMMANDER", from: null, to: "gone" })).toBe(
      "Former member was assigned as Commander",
    );
  });

  it("services: one, several, both directions, with correct grammar", () => {
    expect(say("SERVICES_CHANGED", { added: ["Search"], removed: [] })).toBe("Search was added to affected services");
    expect(say("SERVICES_CHANGED", { added: ["Search", "Web App"], removed: [] })).toBe(
      "Search and Web App were added to affected services",
    );
    expect(say("SERVICES_CHANGED", { added: ["A", "B", "C"] })).toBe("A, B and C were added to affected services");
    expect(say("SERVICES_CHANGED", { removed: ["API"] })).toBe("API was removed from affected services");
    expect(say("SERVICES_CHANGED", { added: ["Search"], removed: ["API"] })).toBe(
      "Search was added to affected services. API was removed from affected services",
    );
    expect(say("SERVICES_CHANGED", { added: [], removed: [] })).toBe("Affected services were changed");
  });

  it("title and summary edits, deletion, and the later-milestone types", () => {
    expect(say("TITLE_CHANGED", { from: "A", to: "B" })).toBe('Title changed from "A" to "B"');
    expect(say("SUMMARY_CHANGED", { from: "x", to: "y" })).toBe("Summary was edited");
    expect(say("INCIDENT_DELETED", {})).toBe("Incident was deleted");
    expect(say("REVENANT_LINKED", {})).toBe("Linked to an earlier incident");
    expect(say("POSTMORTEM_PUBLISHED", {})).toBe("Postmortem was published");
    expect(humanizeEvent({ type: "POSTMORTEM_STARTED", payload: {}, actorId: "u1" }, ctx())).toBe("Postmortem started by " + NAMES.u1);
    expect(say("POSTMORTEM_UNPUBLISHED", {})).toBe("The postmortem was unpublished");
    expect(say("RITUAL_CREATED", {})).toBe("An action item was created");
    expect(say("RITUAL_COMPLETED", { title: "Add an alert" })).toBe("Action item completed: Add an alert");
    expect(say("RITUAL_COMPLETED", null)).toBe("Update: ritual completed"); // malformed payload falls back
    expect(say("RETRO_OVERRIDE", {})).toBe("The postmortem requirement was overridden");
    expect(say("EXTERNAL", { anything: 1 })).toBe("Update from an integration");
  });
});

describe("humanizeEvent: haunted skin", () => {
  const h = ctx("haunted");
  it("uses the haunted vocabulary throughout", () => {
    expect(say("STATUS_CHANGED", { from: "INVESTIGATING", to: "IDENTIFIED" }, h)).toBe(
      "Status shifted from Lurking to Possessed",
    );
    expect(say("STATUS_CHANGED", { to: "INVESTIGATING", created: true }, h)).toBe("Haunting declared as Lurking");
    expect(say("SEVERITY_CHANGED", { from: 3, to: 4 }, h)).toBe("Dread Level rose from Cursed to Possessed");
    expect(say("SEVERITY_CHANGED", { from: 5, to: 1 }, h)).toBe("Dread Level fell from Full Poltergeist to Uneasy");
    expect(say("ROLE_ASSIGNED", { role: "COMMANDER", from: null, to: "u1" }, h)).toBe("Alex was bound as Exorcist");
    expect(say("ROLE_ASSIGNED", { role: "COMMS", from: "u2", to: "u3" }, h)).toBe("Priya took over from Sam as Medium");
    expect(say("ROLE_UNASSIGNED", { role: "SCRIBE", from: "u2", to: null }, h)).toBe("Sam was released as Scribe");
    expect(say("SERVICES_CHANGED", { added: ["Search"] }, h)).toBe("Search was drawn into the haunting");
    expect(say("SERVICES_CHANGED", { removed: ["Search", "API"] }, h)).toBe(
      "Search and API were freed from the haunting",
    );
  });
});

describe("humanizeEvent: bad data never crashes", () => {
  const malformed: [string, unknown][] = [
    ["STATUS_CHANGED", null],
    ["STATUS_CHANGED", undefined],
    ["STATUS_CHANGED", "oops"],
    ["STATUS_CHANGED", 42],
    ["STATUS_CHANGED", []],
    ["STATUS_CHANGED", {}],
    ["STATUS_CHANGED", { to: "NOT_A_STATUS" }],
    ["STATUS_CHANGED", { from: 1, to: 2 }],
    ["SEVERITY_CHANGED", { to: 99 }],
    ["SEVERITY_CHANGED", { from: "3", to: "4" }],
    ["SEVERITY_CHANGED", null],
    ["ROLE_ASSIGNED", { role: "BOSS", to: "u1" }],
    ["ROLE_ASSIGNED", { role: "COMMANDER" }],
    ["ROLE_ASSIGNED", null],
    ["ROLE_UNASSIGNED", { role: "COMMANDER", from: null, to: null }],
    ["SERVICES_CHANGED", { added: "Search" }],
    ["SERVICES_CHANGED", { added: [1, 2] }],
    ["SERVICES_CHANGED", null],
    ["TITLE_CHANGED", { from: 1 }],
    ["TITLE_CHANGED", null],
  ];

  it.each(malformed)("%s with %j falls back to a plain sentence", (type, payload) => {
    const line = say(type, payload);
    expect(typeof line).toBe("string");
    expect(line.length).toBeGreaterThan(5);
    expect(line).not.toMatch(/undefined|null|\[object|NaN/);
  });

  it("falls back for unknown event types, in either skin", () => {
    expect(say("SOMETHING_NEW", { a: 1 })).toBe("Update: something new");
    expect(say("SOMETHING_NEW", null, ctx("haunted"))).toBe("Omen: something new");
    expect(say("", undefined)).toMatch(/^Update:/);
  });

  it("survives hostile input without throwing", () => {
    const hostile = {
      get from() {
        throw new Error("boom");
      },
      to: "INVESTIGATING",
    };
    expect(() => say("STATUS_CHANGED", hostile)).not.toThrow();
    expect(() => humanizeEvent(null as never, ctx())).not.toThrow();
    expect(() => humanizeEvent({ type: undefined as never, payload: {} }, ctx())).not.toThrow();
  });

  it("covers every event type the app writes", () => {
    const types = [
      "NOTE",
      "STATUS_CHANGED",
      "SEVERITY_CHANGED",
      "TITLE_CHANGED",
      "SUMMARY_CHANGED",
      "INCIDENT_DELETED",
      "ROLE_ASSIGNED",
      "ROLE_UNASSIGNED",
      "SERVICES_CHANGED",
      "REVENANT_LINKED",
      "POSTMORTEM_PUBLISHED",
      "POSTMORTEM_STARTED",
      "POSTMORTEM_UNPUBLISHED",
      "RITUAL_CREATED",
      "RITUAL_COMPLETED",
      "RETRO_OVERRIDE",
      "EXTERNAL",
    ];
    for (const type of types) expect(say(type, {}).length, type).toBeGreaterThan(3);
  });
});

describe("referencedUserIds", () => {
  it("lists the people a role event mentions, and nothing else", () => {
    expect(referencedUserIds({ type: "ROLE_ASSIGNED", payload: { role: "COMMANDER", from: "u2", to: "u1" } })).toEqual([
      "u2",
      "u1",
    ]);
    expect(referencedUserIds({ type: "ROLE_UNASSIGNED", payload: { role: "COMMS", from: "u2", to: null } })).toEqual([
      "u2",
    ]);
    expect(referencedUserIds({ type: "ROLE_ASSIGNED", payload: null })).toEqual([]);
    expect(referencedUserIds({ type: "STATUS_CHANGED", payload: { from: "u1" } })).toEqual([]);
  });
});
