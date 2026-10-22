/** Profile image when there is one, otherwise initials. Decorative: the name is always shown beside it. */
export function Avatar({ name, image }: { name: string; image: string | null }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?";
  return image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={image} alt="" aria-hidden="true" className="size-9 shrink-0 rounded-full border border-border object-cover" />
  ) : (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-bg text-sm font-semibold"
    >
      {initials}
    </span>
  );
}
