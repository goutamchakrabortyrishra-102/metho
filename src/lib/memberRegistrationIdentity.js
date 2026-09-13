export const isMemberIdCollisionMessage = (message) => {
  const normalized = String(message || "").toLowerCase();
  return normalized.includes("username already registered") || normalized.includes("member id already registered");
};

export const resolveAssignedMemberId = (result, fallback) => String(
  result?.user?.member_code || result?.user?.id || fallback || ""
).trim().toUpperCase();