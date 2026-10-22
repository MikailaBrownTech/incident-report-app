import type { CopyDictionary } from "@/copy";

/** Copy for a server error code (the `error.code` of the standard API error shape). */
export function apiErrorMessage(t: CopyDictionary, code: string): string {
  switch (code) {
    case "forbidden":
      return t.members.roleNotAllowed;
    case "last_owner":
      return t.members.lastOwner;
    case "has_rituals":
      return t.members.hasRituals;
    case "already_member":
      return t.members.alreadyMember;
    case "not_found":
      return t.errors.notFound;
    case "unauthenticated":
      return t.errors.unauthenticated;
    default:
      return t.errors.generic;
  }
}

/** Copy for a per-field validation code (`error.fieldErrors[field]`). */
export function fieldErrorMessage(t: CopyDictionary, code: string, field: "name" | "email" | "slug"): string {
  switch (code) {
    case "slug_invalid":
      return t.onboarding.slugInvalid;
    case "slug_reserved":
      return t.onboarding.slugReserved;
    case "slug_taken":
      return t.onboarding.slugTaken;
    case "invalid_email":
      return t.validation.invalidEmail;
    case "too_long":
      return t.validation.tooLong(field === "email" ? 254 : 60);
    default:
      return t.validation.required;
  }
}
