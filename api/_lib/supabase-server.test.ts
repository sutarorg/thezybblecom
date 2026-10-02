import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SUPABASE_ANON_KEY_VAR,
  SUPABASE_KEY_VAR,
  SUPABASE_URL_VAR,
  createUserSupabaseClient,
  looksLikeServiceRoleKey,
  missingEnvMessage,
  readServerEnv,
  requireSupabaseServerConfig,
  SupabaseServerConfigError,
} from "./supabase-server";

const MANAGED_VARS = [
  SUPABASE_URL_VAR,
  SUPABASE_KEY_VAR,
  SUPABASE_ANON_KEY_VAR,
  "OTHER_PREFIXED_VALUE",
] as const;

const originalValues = new Map<string, string | undefined>();
for (const name of MANAGED_VARS) originalValues.set(name, process.env[name]);

afterEach(() => {
  for (const name of MANAGED_VARS) {
    const original = originalValues.get(name);
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
  vi.restoreAllMocks();
});

function setEnv(values: Partial<Record<(typeof MANAGED_VARS)[number], string>>) {
  for (const name of MANAGED_VARS) delete process.env[name];
  for (const [name, value] of Object.entries(values)) process.env[name] = value;
}

/** A structurally valid legacy anon JWT whose payload is {"role":"anon"}. */
function anonJwt(role = "anon") {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(/=+$/, "");
  const payload = btoa(JSON.stringify({ role, iss: "https://YOUR_PROJECT.supabase.co/auth/v1" })).replace(/=+$/, "");
  return `${header}.${payload}.signature`;
}

describe("readServerEnv", () => {
  it("returns the first non-empty value, trimmed", () => {
    setEnv({ SUPABASE_URL: "  https://example.supabase.co \t" });
    expect(readServerEnv(SUPABASE_URL_VAR)).toBe("https://example.supabase.co");
    expect(readServerEnv("DOES_NOT_EXIST", SUPABASE_URL_VAR)).toBe("https://example.supabase.co");
  });

  it("treats whitespace-only values as missing", () => {
    setEnv({ SUPABASE_URL: "   \n\t " });
    expect(readServerEnv(SUPABASE_URL_VAR)).toBe("");
  });
});

describe("missingEnvMessage", () => {
  it("names a single variable exactly as required by the API contract", () => {
    expect(missingEnvMessage(["SUPABASE_URL"])).toBe("Missing server environment variable: SUPABASE_URL.");
  });

  it("joins multiple variables with a plural heading", () => {
    expect(missingEnvMessage(["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY)"])).toBe(
      "Missing server environment variables: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY).",
    );
  });
});

describe("requireSupabaseServerConfig", () => {
  it("resolves SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY", () => {
    setEnv({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
    });
    expect(requireSupabaseServerConfig("search")).toEqual({
      url: "https://project.supabase.co",
      key: "sb_publishable_example",
      keyVariable: "SUPABASE_PUBLISHABLE_KEY",
    });
  });

  it("falls back to the legacy SUPABASE_ANON_KEY for backwards compatibility", () => {
    setEnv({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_ANON_KEY: anonJwt(),
    });
    expect(requireSupabaseServerConfig("search")).toMatchObject({
      key: anonJwt(),
      keyVariable: "SUPABASE_ANON_KEY",
    });
  });

  it("prefers SUPABASE_PUBLISHABLE_KEY when both keys are present", () => {
    setEnv({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
      SUPABASE_ANON_KEY: anonJwt(),
    });
    expect(requireSupabaseServerConfig("search")).toMatchObject({
      key: "sb_publishable_example",
      keyVariable: "SUPABASE_PUBLISHABLE_KEY",
    });
  });

  it("trims values copied from dashboards before using them", () => {
    setEnv({
      SUPABASE_URL: "\n  https://project.supabase.co  ",
      SUPABASE_PUBLISHABLE_KEY: "  sb_publishable_example \n",
    });
    expect(requireSupabaseServerConfig("search")).toMatchObject({
      url: "https://project.supabase.co",
      key: "sb_publishable_example",
    });
  });

  it("names SUPABASE_URL exactly when only the URL is absent", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setEnv({ SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example" });
    expect(() => requireSupabaseServerConfig("search")).toThrow(SupabaseServerConfigError);
    try {
      requireSupabaseServerConfig("search");
    } catch (error) {
      const configError = error as SupabaseServerConfigError;
      expect(configError.status).toBe(500);
      expect(configError.code).toBe("supabase_config");
      expect(configError.problem).toBe("missing");
      expect(configError.missing).toEqual(["SUPABASE_URL"]);
      expect(configError.message).toContain("Missing server environment variable: SUPABASE_URL.");
      expect(configError.message).not.toContain("SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY)");
    }
  });

  it("names the key variable when only the key is absent", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setEnv({ SUPABASE_URL: "https://project.supabase.co" });
    try {
      requireSupabaseServerConfig("search");
      expect.unreachable("config must throw when the key is missing");
    } catch (error) {
      const configError = error as SupabaseServerConfigError;
      expect(configError.missing).toEqual(["SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY)"]);
      expect(configError.message).toContain("Missing server environment variable: SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY).");
      expect(configError.message).not.toContain("Missing server environment variable: SUPABASE_URL.");
    }
  });

  it("names both variables when nothing is configured", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setEnv({});
    try {
      requireSupabaseServerConfig("search");
      expect.unreachable("config must throw when nothing is configured");
    } catch (error) {
      const configError = error as SupabaseServerConfigError;
      expect(configError.message).toContain(
        "Missing server environment variables: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY).",
      );
    }
  });

  it("explains that VITE_ build variables cannot satisfy the server lookup", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setEnv({});
    try {
      requireSupabaseServerConfig("search");
      expect.unreachable("config must throw when nothing is configured");
    } catch (error) {
      expect((error as SupabaseServerConfigError).message).toContain("VITE_SUPABASE_*");
      expect((error as SupabaseServerConfigError).message).toContain("Vercel → Project → Settings → Environment Variables");
    }
  });

  it("rejects a malformed SUPABASE_URL instead of silently accepting it", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setEnv({
      SUPABASE_URL: "mgsxoifbfxkvsdbiwucr", // project ref pasted without the scheme/host
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
    });
    try {
      requireSupabaseServerConfig("search");
      expect.unreachable("config must throw for a malformed URL");
    } catch (error) {
      const configError = error as SupabaseServerConfigError;
      expect(configError.problem).toBe("invalid_url");
      expect(configError.message).toContain("SUPABASE_URL isn't a valid URL");
    }
  });

  it("rejects new-style secret keys so RLS cannot be bypassed", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    setEnv({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_secret_example-service-role-key",
    });
    try {
      requireSupabaseServerConfig("search");
      expect.unreachable("config must throw for a secret key");
    } catch (error) {
      const configError = error as SupabaseServerConfigError;
      expect(configError.problem).toBe("secret_key");
      expect(configError.message).toContain("bypass row-level security");
    }
  });

  it("rejects legacy service-role JWTs but accepts legacy anon JWTs", () => {
    setEnv({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_ANON_KEY: anonJwt("service_role"),
    });
    expect(() => requireSupabaseServerConfig("search")).toThrow(SupabaseServerConfigError);

    setEnv({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_ANON_KEY: anonJwt("anon"),
    });
    expect(requireSupabaseServerConfig("search").keyVariable).toBe("SUPABASE_ANON_KEY");
  });

  it("never includes the configured values in the error or the server log", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setEnv({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_secret_leaked-value-must-not-appear",
    });
    try {
      requireSupabaseServerConfig("search");
      expect.unreachable("config must throw for a secret key");
    } catch (error) {
      expect((error as SupabaseServerConfigError).message).not.toContain("sb_secret_leaked-value-must-not-appear");
    }
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain("sb_secret_leaked-value-must-not-appear");
  });
});

describe("looksLikeServiceRoleKey", () => {
  it("classifies new-style and legacy key shapes", () => {
    expect(looksLikeServiceRoleKey("sb_secret_abc")).toBe(true);
    expect(looksLikeServiceRoleKey(anonJwt("service_role"))).toBe(true);
    expect(looksLikeServiceRoleKey("sb_publishable_abc")).toBe(false);
    expect(looksLikeServiceRoleKey(anonJwt("anon"))).toBe(false);
    expect(looksLikeServiceRoleKey("eyJnot-a-jwt")).toBe(false);
  });
});

describe("createUserSupabaseClient", () => {
  it("forwards the caller's bearer token so RLS keeps evaluating as the user", () => {
    setEnv({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
    });
    const config = requireSupabaseServerConfig("search");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { user: null }, error: { message: "invalid JWT" } }), { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createUserSupabaseClient(config, "caller-access-token", { serverLabel: "search" });
    expect(client).toBeTruthy();
    void client.auth.getUser("caller-access-token");
    const [, init] = fetchMock.mock.calls[0] as [unknown, { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBe("Bearer caller-access-token");
    vi.unstubAllGlobals();
  });
});

describe("error messages stay browser-safe", () => {
  // src/app/services/api-response.ts only renders messages without URLs,
  // credentials, or markup — keep server config errors inside that contract so
  // the actionable text reaches the UI instead of a generic fallback.
  it("contains no URLs, bearer tokens, or html in any failure message", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cases: Array<Record<string, string>> = [
      {},
      { SUPABASE_URL: "https://project.supabase.co" },
      { SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example" },
      { SUPABASE_URL: "not a url", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example" },
      { SUPABASE_URL: "https://project.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_secret_abc" },
    ];
    for (const values of cases) {
      setEnv(values as Partial<Record<(typeof MANAGED_VARS)[number], string>>);
      try {
        requireSupabaseServerConfig("search");
      } catch (error) {
        const message = (error as SupabaseServerConfigError).message;
        expect(message.length).toBeLessThanOrEqual(500);
        expect(message).not.toMatch(/https?:\/\//i);
        expect(message).not.toMatch(/\bBearer\s+/i);
        expect(message).not.toMatch(/<\/?(?:html|body|script)/i);
      }
    }
  });
});
