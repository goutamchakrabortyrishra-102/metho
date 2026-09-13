export function getDisplayedHierarchy(tree, directOnly) {
  if (!tree || !directOnly) return tree;
  return {
    ...tree,
    children: (tree.children || []).map((child) => ({ ...child, children: [] })),
  };
}