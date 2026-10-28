import { describe, expect, it } from "vitest";
import { getCopy } from "@/copy";
import { apiErrorMessage, fieldErrorMessage } from "./api-messages";

describe.each(["haunted", "professional"] as const)("api messages (%s)", (skin) => {
  const t = getCopy(skin);

  it("maps known error codes and falls back to the generic message", () => {
    expect(apiErrorMessage(t, "last_owner")).toBe(t.members.lastOwner);
    expect(apiErrorMessage(t, "not_found")).toBe(t.errors.notFound);
    expect(apiErrorMessage(t, "something_new")).toBe(t.errors.generic);
  });

  it("sizes the too_long message by field", () => {
    expect(fieldErrorMessage(t, "too_long", "email")).toBe(t.validation.tooLong(254));
    expect(fieldErrorMessage(t, "too_long", "name")).toBe(t.validation.tooLong(60));
    expect(fieldErrorMessage(t, "unknown", "slug")).toBe(t.validation.required);
  });
});
