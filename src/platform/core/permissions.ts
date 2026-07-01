import type { PlatformModuleId } from "@/platform/core/modules";

export type OrganizationRole = "owner" | "admin" | "member" | "viewer";

export type PermissionAction =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "manage";

export type Permission = {
  module: PlatformModuleId | "platform";
  action: PermissionAction;
};

export const rolePermissions: Record<OrganizationRole, Permission[]> = {
  owner: [
    { module: "platform", action: "manage" },
    { module: "settings", action: "manage" },
    { module: "crm", action: "manage" },
    { module: "automations", action: "approve" },
  ],
  admin: [
    { module: "settings", action: "update" },
    { module: "crm", action: "manage" },
    { module: "automations", action: "approve" },
  ],
  member: [
    { module: "dashboard", action: "read" },
    { module: "crm", action: "create" },
    { module: "crm", action: "update" },
  ],
  viewer: [
    { module: "dashboard", action: "read" },
    { module: "crm", action: "read" },
  ],
};

export function hasPermission(
  role: OrganizationRole,
  requiredPermission: Permission,
) {
  return rolePermissions[role].some(
    (permission) =>
      permission.module === requiredPermission.module &&
      (permission.action === requiredPermission.action ||
        permission.action === "manage"),
  );
}
