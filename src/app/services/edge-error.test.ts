import { describe, expect, it } from "vitest";
import { readFunctionError } from "./edge-error";

describe("Edge Function error parser", () => {
  it("reads a structured JSON error from a function response", async () => {
    const error = {
      name: "FunctionsHttpError",
      context: new Response(JSON.stringify({ error: "The AI service timed out.", code: "provider_timeout" }), {
        status: 504,
        headers: { "content-type": "application/json" },
      }),
    };
    await expect(readFunctionError(error, "ai-interpret", "AI")).resolves.toBe("The AI service timed out.");
  });

  it.each([
    [401, "Your session expired — sign in again."],
    [402, "The search service ran out of usage quota. An administrator must review the provider plan and billing before it works again."],
    [403, "You don't have access to complete that action."],
    [429, "The search service is busy or rate-limited. Please try again shortly."],
  ])("maps HTTP %s to a safe message", async (status, message) => {
    await expect(readFunctionError({ context: new Response("", { status }) }, "search-run", "search"))
      .resolves.toBe(message);
  });

  it("identifies an undeployed function", async () => {
    await expect(readFunctionError({ context: new Response("", { status: 404 }) }, "ai-analyze", "AI"))
      .resolves.toBe('The requested Edge Function "ai-analyze" is not deployed.');
  });

  it("replaces the opaque SDK network error with a useful deployment message", async () => {
    await expect(readFunctionError({ message: "Failed to send a request to the Edge Function" }, "search-run", "search"))
      .resolves.toContain('The requested Edge Function "search-run" couldn\'t be reached');
  });

  it("does not surface provider bodies, URLs, tokens, or HTML", async () => {
    await expect(readFunctionError({ message: "Bearer secret https://internal.example/error" }, "ai-analyze", "AI"))
      .resolves.toBe("The AI service couldn't complete that action. Please try again.");
    await expect(readFunctionError({ context: new Response("<!doctype html><body>Vercel stack</body>", { status: 500 }) }, "ai-analyze", "AI"))
      .resolves.toBe("The AI service couldn't complete that action. Please try again.");
  });
});
