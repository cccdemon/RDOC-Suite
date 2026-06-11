import { describe, it, expect } from "vitest";
import { serializeOp, parseBlueprint, BLUEPRINT_VERSION } from "../../services/opBlueprint.js";

const sampleOp = {
  title: "Vanduul Tech Smugglers",
  description: "Bring fighters.",
  opType: "combat",
  meetingSystem: "pyro",
  meetingLocation: "Ruin Station",
  minParticipants: 4,
  maxParticipants: 12,
  groups: [
    {
      name: "Strike Wing",
      kind: "fighter_squad",
      order: 0,
      targetSize: 4,
      requirements: [
        {
          category: "fighter",
          label: "Light Fighter",
          count: 4,
          note: null,
          order: 0,
          needType: "fighter_squad",
          shipType: "light_fighter",
          squadSize: 2,
        },
      ],
    },
  ],
  resourceLinks: [
    { url: "https://youtu.be/abc", title: "Guide", kind: "youtube", sortOrder: 0 },
  ],
};

describe("serializeOp", () => {
  it("captures settings, composition and resource links; drops nothing meaningful", () => {
    const bp = serializeOp(sampleOp);
    expect(bp.v).toBe(BLUEPRINT_VERSION);
    expect(bp.settings.title).toBe("Vanduul Tech Smugglers");
    expect(bp.settings.maxParticipants).toBe(12);
    expect(bp.groups).toHaveLength(1);
    expect(bp.groups[0].requirements[0].shipType).toBe("light_fighter");
    expect(bp.resourceLinks[0].kind).toBe("youtube");
  });
});

describe("parseBlueprint", () => {
  it("round-trips a serialized blueprint", () => {
    const json = JSON.stringify(serializeOp(sampleOp));
    const parsed = parseBlueprint(json);
    expect(parsed).not.toBeNull();
    expect(parsed!.settings.title).toBe("Vanduul Tech Smugglers");
    expect(parsed!.groups[0].name).toBe("Strike Wing");
    expect(parsed!.resourceLinks).toHaveLength(1);
  });
  it("returns null on garbage / missing settings", () => {
    expect(parseBlueprint("not json")).toBeNull();
    expect(parseBlueprint("{}")).toBeNull();
    expect(parseBlueprint(JSON.stringify({ settings: {} }))).toBeNull();
  });
  it("defaults arrays when absent", () => {
    const parsed = parseBlueprint(JSON.stringify({ settings: { title: "x" } }));
    expect(parsed!.groups).toEqual([]);
    expect(parsed!.resourceLinks).toEqual([]);
  });
});
