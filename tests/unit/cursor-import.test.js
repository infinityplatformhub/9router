import { describe, it, expect } from "vitest";
import { CursorService } from "@/lib/oauth/services/cursor.js";

const MID = "b63236ae-151a-4db7-ae09-55382b60bfab";
const mk = (p) =>
  ["e30", Buffer.from(JSON.stringify(p)).toString("base64url"), "x"].join(".") +
  "x".repeat(380);

describe("cursor import token", () => {
  const s = new CursorService();

  it("rejects an already-expired JWT instead of storing it as live", async () => {
    await expect(
      s.validateImportToken(
        mk({ sub: "google-oauth2|u1", exp: Math.floor(Date.now() / 1000) - 100 }),
        MID,
      ),
    ).rejects.toThrow(/already expired/);
  });

  it("derives expiresIn from the JWT exp, not a hardcoded 24h", async () => {
    const r = await s.validateImportToken(
      mk({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 3600 }),
      MID,
    );
    expect(Math.abs(r.expiresIn - 3600)).toBeLessThan(5);
  });

  it("leaves email null when the JWT has none (never falls back to sub)", () => {
    const u = s.extractUserInfo(mk({ sub: "google-oauth2|u1", exp: 1 }));
    expect(u.email).toBeNull();
    expect(u.userId).toBe("google-oauth2|u1");
  });
});
