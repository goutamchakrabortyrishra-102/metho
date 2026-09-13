export const isMemberIdCollisionMessage = (message) => {
  const normalized = String(message || "").toLowerCase();
  return normalized.includes("username already registered") || normalized.includes("member id already registered");
};

// A failed register POST may still have created the member (timeout/5xx after commit),
// so it must only be replayed when the endpoint itself does not exist.
export const shouldRetryRegisterOnAliasEndpoint = (error) => {
  const status = Number(error?.response?.status || 0);
  return status === 404 || status === 405;
};

export const resolveAssignedMemberId = (result, fallback) => String(
  result?.user?.member_code || result?.user?.id || fallback || ""
).trim().toUpperCase();