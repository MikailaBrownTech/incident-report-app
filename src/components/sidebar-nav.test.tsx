// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarNav } from "./sidebar-nav";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const items = [
  { href: "/app/acme/dashboard", label: "Dashboard" },
  { href: "/app/acme/incidents", label: "Incidents" },
  { href: "/app/acme/settings/services", label: "Services" },
  { href: "/app/acme/settings", label: "Settings" },
];
const current = (path: string) => {
  nav.pathname = path;
  render(<SidebarNav items={items} />);
  return screen.queryAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent);
};

describe("SidebarNav", () => {
  it("highlights the page you are on, including nested pages", () => {
    expect(current("/app/acme/dashboard")).toEqual(["Dashboard"]);
    cleanup();
    expect(current("/app/acme/incidents/42")).toEqual(["Incidents"]);
  });

  it("highlights only the most specific match: Services is under Settings but wins on its own page", () => {
    expect(current("/app/acme/settings/services")).toEqual(["Services"]);
    cleanup();
    expect(current("/app/acme/settings")).toEqual(["Settings"]);
    cleanup();
    expect(current("/app/acme/settings/members")).toEqual(["Settings"]);
  });

  it("does not match by shared prefix text alone, and can highlight nothing", () => {
    expect(current("/app/acme/incidentsX")).toEqual([]);
    cleanup();
    expect(current("/app/other/dashboard")).toEqual([]);
  });
});
