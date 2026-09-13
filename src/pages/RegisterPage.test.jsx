import { isMemberIdCollisionMessage, resolveAssignedMemberId } from "../lib/memberRegistrationIdentity";

describe("member registration identity", () => {
  test("retries explicit backend Member ID collisions", () => {
    expect(isMemberIdCollisionMessage("Member ID already registered")).toBe(true);
    expect(isMemberIdCollisionMessage("Phone number already registered")).toBe(false);
  });

  test("uses the Member ID assigned by the backend", () => {
    expect(resolveAssignedMemberId({ user: { id: "MAU12346", member_code: "MAU12346" } }, "MAU99529"))
      .toBe("MAU12346");
  });
});