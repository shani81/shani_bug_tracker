import { describe, it, expect } from "vitest";
import { can, CAPABILITIES, type Capability } from "@/lib/permissions";

// The capability matrix is the core of authorization. These are pure-function
// tests: fast, deterministic, and the first thing to fail if the model drifts.

describe("org roles", () => {
  it("owner holds every capability", () => {
    for (const cap of CAPABILITIES) {
      expect(can("owner", cap), cap).toBe(true);
    }
  });

  it("admin holds everything except org:manage", () => {
    for (const cap of CAPABILITIES) {
      expect(can("admin", cap), cap).toBe(cap !== "org:manage");
    }
  });

  it("member can contribute but not administer", () => {
    expect(can("member", "issue:create")).toBe(true);
    expect(can("member", "issue:update")).toBe(true);
    expect(can("member", "issue:transition")).toBe(true);
    expect(can("member", "comment:create")).toBe(true);
    expect(can("member", "time:log")).toBe(true);

    expect(can("member", "issue:delete")).toBe(false);
    expect(can("member", "member:manage")).toBe(false);
    expect(can("member", "org:manage")).toBe(false);
    expect(can("member", "automation:manage")).toBe(false);
  });

  it("guest can only file issues and comment", () => {
    const allowed: Capability[] = ["issue:create", "comment:create"];
    for (const cap of CAPABILITIES) {
      expect(can("guest", cap), cap).toBe(allowed.includes(cap));
    }
  });

  it("an unknown role gets nothing", () => {
    for (const cap of CAPABILITIES) {
      expect(can("not-a-role", cap), cap).toBe(false);
      expect(can("", cap), cap).toBe(false);
    }
  });
});

describe("project roles refine, never escalate", () => {
  it("lead grants delete to a member", () => {
    expect(can("member", "issue:delete")).toBe(false);
    expect(can("member", "issue:delete", "lead")).toBe(true);
  });

  it("qa grants qa:manage to a member", () => {
    expect(can("member", "qa:manage")).toBe(false);
    expect(can("member", "qa:manage", "qa")).toBe(true);
  });

  // Regression: a guest made project lead once outranked a full member.
  it("a guest cannot be escalated by ANY project role", () => {
    const projectRoles = ["lead", "manager", "developer", "qa", "designer", "support", "viewer"];
    const guestMay: Capability[] = ["issue:create", "comment:create"];
    for (const role of projectRoles) {
      for (const cap of CAPABILITIES) {
        const expected = role === "viewer" ? false : guestMay.includes(cap);
        expect(can("guest", cap, role), `${role}/${cap}`).toBe(expected);
      }
    }
  });

  it("a project role never exceeds the org ceiling", () => {
    // member's ceiling excludes org administration
    expect(can("member", "member:manage", "lead")).toBe(false);
    expect(can("member", "org:manage", "lead")).toBe(false);
    expect(can("member", "automation:manage", "lead")).toBe(false);
  });
});

describe("viewer clamp", () => {
  it("makes a member read-only", () => {
    for (const cap of CAPABILITIES) {
      expect(can("member", cap, "viewer"), cap).toBe(false);
    }
  });

  it("makes a guest read-only", () => {
    for (const cap of CAPABILITIES) {
      expect(can("guest", cap, "viewer"), cap).toBe(false);
    }
  });

  it("does NOT clamp org owners or admins", () => {
    expect(can("owner", "issue:update", "viewer")).toBe(true);
    expect(can("owner", "issue:delete", "viewer")).toBe(true);
    expect(can("admin", "issue:update", "viewer")).toBe(true);
  });
});

describe("no-membership default", () => {
  it("a user with no project row keeps exactly their org capabilities", () => {
    for (const cap of CAPABILITIES) {
      expect(can("member", cap, null), cap).toBe(can("member", cap));
      expect(can("guest", cap, undefined), cap).toBe(can("guest", cap));
    }
  });
});
