import { describe, expect, it } from "vitest";
import {
  type ConsentEntry,
  type ConsentEntryInput,
  ConsentLedgerError,
  currentConsents,
  permitsMaterialStorage,
  permitsTransmission,
  requireConsentEntryInput,
} from "./consent-ledger.js";

const grant: ConsentEntryInput = {
  workspaceId: "workspace-1",
  kind: "provider-transmission",
  action: "granted",
  basis: "candidate-consent",
  recordedBy: { kind: "member", memberId: "member-1" },
  providers: ["openai", "anthropic", "openai"],
  note: "  Agreed on the intake call.  ",
};

describe("consent ledger input rules", () => {
  it("sorts and dedupes a grant's providers and trims its note", () => {
    expect(requireConsentEntryInput(grant)).toEqual({
      ...grant,
      providers: ["anthropic", "openai"],
      note: "Agreed on the intake call.",
    });
    expect(
      requireConsentEntryInput({ ...grant, action: "withdrawn", providers: [], note: " " }),
    ).toEqual({ ...grant, action: "withdrawn", providers: [], note: undefined });
  });

  it("refuses a basis, providers or note the kind does not allow", () => {
    const refusals: ConsentEntryInput[] = [
      { ...grant, basis: "contract" },
      { ...grant, providers: [] },
      { ...grant, providers: ["Open AI"] },
      { ...grant, action: "withdrawn" },
      { ...grant, kind: "material-storage", basis: "contract" },
      { ...grant, note: "x".repeat(501) },
      { ...grant, workspaceId: " workspace-1" },
      { ...grant, recordedBy: { kind: "member", memberId: "" } },
      { ...grant, kind: "consent" as ConsentEntryInput["kind"] },
    ];
    for (const input of refusals) {
      expect(() => requireConsentEntryInput(input)).toThrow(ConsentLedgerError);
    }
    expect(
      requireConsentEntryInput({
        workspaceId: "workspace-1",
        kind: "material-storage",
        action: "granted",
        basis: "legitimate-interest",
        recordedBy: { kind: "owner" },
      }),
    ).toMatchObject({ kind: "material-storage", providers: [], recordedBy: { kind: "owner" } });
  });

  it("takes each kind's latest entry as its current state", () => {
    const entry = (id: string, kind: ConsentEntry["kind"], action: ConsentEntry["action"]) =>
      ({ ...grant, id, kind, action, providers: [], recordedAt: id }) as ConsentEntry;
    const history = [
      entry("1", "material-storage", "granted"),
      entry("2", "provider-transmission", "granted"),
      entry("3", "material-storage", "withdrawn"),
    ];
    expect(currentConsents(history)).toEqual({
      "material-storage": history[2],
      "provider-transmission": history[1],
    });
    expect(currentConsents([])).toEqual({});
  });

  it("permits storage and transmission only on current grants that cover the models", () => {
    const entry = (
      kind: ConsentEntry["kind"],
      action: ConsentEntry["action"],
      providers: string[] = [],
    ) => ({ ...grant, id: kind, kind, action, providers, recordedAt: kind }) as ConsentEntry;
    const models = { author: { company: "anthropic" }, critic: { company: "openai" } };

    expect(permitsMaterialStorage({})).toBe(false);
    expect(
      permitsMaterialStorage({ "material-storage": entry("material-storage", "granted") }),
    ).toBe(true);
    expect(
      permitsMaterialStorage({ "material-storage": entry("material-storage", "withdrawn") }),
    ).toBe(false);

    const transmission = (action: ConsentEntry["action"], providers: string[]) => ({
      "provider-transmission": entry("provider-transmission", action, providers),
    });
    expect(permitsTransmission({}, models)).toBe(false);
    expect(permitsTransmission(transmission("granted", ["anthropic", "openai"]), models)).toBe(
      true,
    );
    expect(permitsTransmission(transmission("granted", ["anthropic"]), models)).toBe(false);
    expect(permitsTransmission(transmission("withdrawn", []), models)).toBe(false);
    expect(
      permitsTransmission(transmission("granted", ["openai"]), {
        author: { company: "openai" },
        critic: { company: "openai" },
      }),
    ).toBe(true);
  });
});
