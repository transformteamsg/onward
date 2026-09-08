import { db, type UserAdminFindUniqueArgs, type UserAdminGetPayload } from '$lib/server/db.js';

/**
 * The reason an admin session was denied.
 * - `not_admin` — no `UserAdmin` record matches the id on the session.
 * - `inactive` — a `UserAdmin` record matches, but it has been deactivated.
 */
export type AdminAccessDenialReason = 'not_admin' | 'inactive';

export interface AdminAccessGranted {
  granted: true;
}

export interface AdminAccessDenied {
  granted: false;
  reason: AdminAccessDenialReason;
}

export type AdminAccess = AdminAccessGranted | AdminAccessDenied;

/**
 * Resolves the id held on an admin session against the `UserAdmin` table.
 *
 * Admin-ness is a property of the database row, not of the session payload: the session only
 * records what was true at sign-in, so it cannot show that an admin has since been deactivated
 * or removed. Access is granted only when a matching record exists **and** is active; every
 * other outcome is a denial with a reason.
 *
 * @param id - The `UserAdmin` id stored on the session.
 * @returns Whether the session may act as an admin, and why not when it may not.
 * @throws If the lookup itself fails. Callers must deny access when it does.
 */
export async function verifyAdminAccess(id: string): Promise<AdminAccess> {
  const userAdminArgs = {
    select: {
      id: true,
      isActive: true,
    },
    where: {
      id,
    },
  } satisfies UserAdminFindUniqueArgs;

  const userAdmin: UserAdminGetPayload<typeof userAdminArgs> | null =
    await db.userAdmin.findUnique(userAdminArgs);

  if (!userAdmin) {
    return { granted: false, reason: 'not_admin' };
  }

  if (!userAdmin.isActive) {
    return { granted: false, reason: 'inactive' };
  }

  return { granted: true };
}
