import { describe, expect, it } from "vitest";
import { dictionaries, emptyMessage, getCopy, severityName } from "./index";

type Shape = { [k: string]: Shape | "string" | "function" | "array" };

function shapeOf(value: unknown): Shape | "string" | "function" | "array" {
  if (typeof value === "string") return "string";
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "array";
  const out: Shape = {};
  for (const [k, v] of Object.entries(value as object)) out[k] = shapeOf(v);
  return out;
}

function strings(value: unknown, path = ""): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
  }
  return [];
}

describe("copy dictionaries", () => {
  it("have identical key structure in both skins", () => {
    expect(shapeOf(dictionaries.haunted)).toEqual(shapeOf(dictionaries.professional));
  });

  it("contain no empty strings", () => {
    for (const [skin, dict] of Object.entries(dictionaries)) {
      for (const [path, s] of strings(dict)) {
        expect(s.trim(), `${skin}.${path}`).not.toBe("");
      }
    }
  });

  it("keep blameless prompts free of blame language", () => {
    const banned = /\b(who(se)? (fault|mistake)|blame (the|a) (engineer|person)|negligen|careless)\b/i;
    for (const [skin, dict] of Object.entries(dictionaries)) {
      for (const section of Object.values(dict.postmortem.sections)) {
        expect(section.prompt, skin).not.toMatch(banned);
      }
    }
  });

  it("uses the agreed haunted vocabulary", () => {
    const t = getCopy("haunted");
    expect(t.incident.singular).toBe("Haunting");
    expect(Object.values(t.severity)).toEqual([
      "Uneasy",
      "Creepy",
      "Cursed",
      "Possessed",
      "Full Poltergeist",
    ]);
    expect(Object.values(t.status)).toEqual(["Lurking", "Possessed", "Exorcising", "Laid to Rest"]);
    expect(t.postmortem.singular).toBe("Autopsy Report");
    expect(Object.values(t.postmortem.sections).map((s) => s.title)).toEqual([
      "Cause of Death",
      "Last Known Sighting",
      "Witnesses",
      "What We Learned",
    ]);
    expect(t.ritual.plural).toBe("Rituals");
    expect(t.revenant.singular).toBe("Revenant");
    expect(Object.values(t.incidentRole)).toEqual(["Exorcist", "Scribe", "Medium"]);
    expect(t.empty.incidents).toContain("No hauntings. Suspiciously quiet.");
  });

  it("uses plain language in the professional skin", () => {
    const t = getCopy("professional");
    expect(t.incident.singular).toBe("Incident");
    expect(t.postmortem.singular).toBe("Postmortem");
    expect(t.ritual.singular).toBe("Action Item");
  });
});

describe("helpers", () => {
  it("prefers workspace severity overrides, ignoring blanks", () => {
    const t = getCopy("haunted");
    expect(severityName(t, 3)).toBe("Cursed");
    expect(severityName(t, 3, { "3": "Sev 3" })).toBe("Sev 3");
    expect(severityName(t, 3, { "3": "  " })).toBe("Cursed");
    expect(severityName(t, 3, null)).toBe("Cursed");
  });

  it("picks empty messages deterministically", () => {
    const t = getCopy("haunted");
    expect(emptyMessage(t, "incidents", 0)).toBe(emptyMessage(t, "incidents", 0));
    expect(emptyMessage(t, "incidents", 2)).toBe(emptyMessage(t, "incidents", 0));
    expect(emptyMessage(t, "incidents", 1)).not.toBe(emptyMessage(t, "incidents", 0));
  });

  it("pluralises revenant counts", () => {
    const t = getCopy("haunted");
    expect(t.revenant.hauntedNTimes(1)).toBe("This has haunted you 1 time before");
    expect(t.revenant.hauntedNTimes(3)).toBe("This has haunted you 3 times before");
  });
});
