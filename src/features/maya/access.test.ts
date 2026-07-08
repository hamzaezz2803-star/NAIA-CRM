import { describe, expect, it } from "vitest";

import {
  MAYA_COFUNDER_EMAILS,
  canUseMayaPitchGeneratorEmail,
} from "./access-policy";

describe("Maya pitch generator access", () => {
  it("allows only Ali and Nabil by email", () => {
    expect(canUseMayaPitchGeneratorEmail("ali@qarizmi.com")).toBe(true);
    expect(canUseMayaPitchGeneratorEmail("nabil@qarizmi.com")).toBe(true);
    expect(canUseMayaPitchGeneratorEmail("hamza@qarizmi.com")).toBe(false);
    expect(canUseMayaPitchGeneratorEmail("wissal@qarizmi.com")).toBe(false);
  });

  it("normalizes email case and spacing", () => {
    expect(canUseMayaPitchGeneratorEmail(" NABIL@QARIZMI.COM ")).toBe(true);
  });

  it("keeps the allowlist explicit", () => {
    expect(MAYA_COFUNDER_EMAILS).toEqual([
      "ali@qarizmi.com",
      "nabil@qarizmi.com",
    ]);
  });
});
