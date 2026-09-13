import { isMemberIdCollisionMessage, resolveAssignedMemberId, shouldRetryRegisterOnAliasEndpoint } from "../lib/memberRegistrationIdentity";

describe("member registration identity", () => {
  test("retries explicit backend Member ID collisions", () => {
    expect(isMemberIdCollisionMessage("Member ID already registered")).toBe(true);
    expect(isMemberIdCollisionMessage("Phone number already registered")).toBe(false);
  });

  test("uses the Member ID assigned by the backend", () => {
    expect(resolveAssignedMemberId({ user: { id: "MAU12346", member_code: "MAU12346" } }, "MAU99529"))
      .toBe("MAU12346");
  });

  test("never replays a register POST that may have already created the member", () => {
    expect(shouldRetryRegisterOnAliasEndpoint({ code: "ECONNABORTED", message: "timeout" })).toBe(false);
    expect(shouldRetryRegisterOnAliasEndpoint({ response: { status: 500 } })).toBe(false);
    expect(shouldRetryRegisterOnAliasEndpoint({ response: { status: 502 } })).toBe(false);
    expect(shouldRetryRegisterOnAliasEndpoint({ response: { status: 400 } })).toBe(false);
    expect(shouldRetryRegisterOnAliasEndpoint({ response: { status: 404 } })).toBe(true);
    expect(shouldRetryRegisterOnAliasEndpoint({ response: { status: 405 } })).toBe(true);
  });
});