import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ForbiddenError } from "@/server/auth/permissions";
import { ApiError, errorResponse, handle, readBody } from "./http";

const post = (body: string) => new Request("http://x.test", { method: "POST", body });

describe("errorResponse", () => {
  it("serialises an ApiError with its status, code and field errors", async () => {
    const res = errorResponse(new ApiError(400, "validation_error", "Bad.", { slug: ["slug_taken"] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "validation_error", message: "Bad.", fieldErrors: { slug: ["slug_taken"] } },
    });
  });

  it("omits fieldErrors when there are none", async () => {
    const body = await errorResponse(new ApiError(404, "not_found", "Nope.")).json();
    expect(body).toEqual({ error: { code: "not_found", message: "Nope." } });
  });

  it("maps a ForbiddenError to 403", async () => {
    const res = errorResponse(new ForbiddenError("x" as never));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
  });

  it("hides unknown errors behind a 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = errorResponse(new Error("secret db detail"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
    spy.mockRestore();
  });
});

describe("handle", () => {
  it("turns thrown errors into the standard shape", async () => {
    const res = await handle(async () => {
      throw new ApiError(401, "unauthenticated", "Sign in.");
    })();
    expect(res.status).toBe(401);
  });
});

describe("readBody", () => {
  const schema = z.object({ name: z.string().min(1) });

  it("returns parsed data", async () => {
    expect(await readBody(post('{"name":"a"}'), schema)).toEqual({ name: "a" });
  });

  it("rejects malformed JSON with invalid_json", async () => {
    await expect(readBody(post("{nope"), schema)).rejects.toMatchObject({ status: 400, code: "invalid_json" });
  });

  it("rejects invalid bodies with per-field errors", async () => {
    await expect(readBody(post('{"name":""}'), schema)).rejects.toMatchObject({
      status: 400,
      code: "validation_error",
      fieldErrors: { name: expect.any(Array) },
    });
  });
});
