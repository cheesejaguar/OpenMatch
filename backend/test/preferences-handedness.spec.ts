import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ErrorCodes } from "../src/lib/error-codes.js";
import { buildServer } from "../src/server.js";
import { createUser, resetDb, testPrisma } from "./helpers/db.js";

// Phase E — Aurora Dawn: configurable handedness preference.
//
// The swipe deck action row (X / heart) can be anchored right (default),
// left (left-handed thumb reach), or center. This spec locks the
// /api/v1/preferences/me contract for the new `handedness` field.

const app = await buildServer();

afterAll(async () => {
  await app.close();
  await testPrisma.$disconnect();
});

const bearer = (userId: string) => `Bearer ${app.jwt.sign({ sub: userId, scope: "user" })}`;

beforeEach(async () => {
  await resetDb();
});

describe("preferences.handedness", () => {
  it("GET /api/v1/preferences/me returns handedness=right by default for a new user", async () => {
    const u = await createUser();
    // createUser preseeds a Preferences row, so handedness should default
    // to the schema's @default(right).
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/preferences/me",
      headers: { authorization: bearer(u.id) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().handedness).toBe("right");
  });

  it("PATCH /api/v1/preferences/me with handedness=left persists and round-trips", async () => {
    const u = await createUser();
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/v1/preferences/me",
      headers: { authorization: bearer(u.id) },
      payload: { handedness: "left" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().handedness).toBe("left");

    const get = await app.inject({
      method: "GET",
      url: "/api/v1/preferences/me",
      headers: { authorization: bearer(u.id) },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().handedness).toBe("left");
  });

  it("PATCH /api/v1/preferences/me with handedness=center persists", async () => {
    const u = await createUser();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/preferences/me",
      headers: { authorization: bearer(u.id) },
      payload: { handedness: "center" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().handedness).toBe("center");
  });

  it("PATCH /api/v1/preferences/me with handedness=invalid returns validation_failed", async () => {
    const u = await createUser();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/preferences/me",
      headers: { authorization: bearer(u.id) },
      payload: { handedness: "diagonal" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe(ErrorCodes.VALIDATION_FAILED);
  });
});
