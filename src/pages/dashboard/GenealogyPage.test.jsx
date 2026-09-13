import { getDisplayedHierarchy } from "../../lib/genealogyHierarchy";

describe("genealogy display scope", () => {
  const tree = {
    id: "admin",
    name: "METHO Admin",
    children: [
      {
        id: "direct-1",
        name: "Direct Member",
        children: [{ id: "level-2", name: "Level Two", children: [] }],
      },
    ],
  };

  test("keeps the exact full hierarchy when direct-only mode is off", () => {
    expect(getDisplayedHierarchy(tree, false)).toBe(tree);
  });

  test("shows only the root and immediate children without mutating hierarchy data", () => {
    const displayed = getDisplayedHierarchy(tree, true);

    expect(displayed.name).toBe("METHO Admin");
    expect(displayed.children.map((child) => child.id)).toEqual(["direct-1"]);
    expect(displayed.children[0].children).toEqual([]);
    expect(tree.children[0].children).toHaveLength(1);
    expect(getDisplayedHierarchy(tree, false)).toBe(tree);
  });
});