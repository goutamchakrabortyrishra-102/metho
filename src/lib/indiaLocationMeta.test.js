import { buildIndiaLocationMetaForState } from "./indiaLocationMeta";

describe("state location metadata", () => {
  it("preserves sorted, unique district and city options", () => {
    expect(buildIndiaLocationMetaForState("West Bengal", [
      ["Hooghly", "Rishra"],
      ["Hooghly", "Serampore"],
      ["Hooghly", "Rishra"],
      ["Howrah", "Howrah"],
      ["", "Ignored"],
    ])).toEqual({
      districtsByState: { "West Bengal": ["Hooghly", "Howrah"] },
      citiesByStateDistrict: {
        "west bengal||hooghly": ["Rishra", "Serampore"],
        "west bengal||howrah": ["Howrah"],
      },
    });
  });
});