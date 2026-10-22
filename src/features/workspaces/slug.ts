import { z } from "zod";

export const RESERVED_SLUGS = [
  "app",
  "api",
  "admin",
  "settings",
  "sign-in",
  "sign-up",
  "onboarding",
  "dev",
] as const;

export const SLUG_MIN = 3;
export const SLUG_MAX = 40;

// Lowercase letters and digits in runs separated by single hyphens: no leading, trailing or doubled hyphens.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type SlugProblem = "slug_invalid" | "slug_reserved";

/** Returns the first rule the slug breaks, or null when it is acceptable (uniqueness is checked at write time). */
export function checkSlug(slug: string): SlugProblem | null {
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX || !SLUG_RE.test(slug)) return "slug_invalid";
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) return "slug_reserved";
  return null;
}

/** Zod issues carry the SlugProblem code as their message; the UI maps codes to copy. */
export const slugSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const problem = checkSlug(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

/** Lowercase, hyphen-separated, ASCII-only. May be shorter than SLUG_MIN or reserved; see suggestSlug. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

/** A valid starting point for the slug field; the user can edit it. */
export function suggestSlug(name: string): string {
  let slug = slugify(name);
  if (slug.length < SLUG_MIN) slug = slug ? `${slug}-team` : "my-team";
  slug = slug.slice(0, SLUG_MAX).replace(/-+$/g, "");
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) slug = `${slug}-team`;
  return slug;
}
