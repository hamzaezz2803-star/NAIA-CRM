import type { PlatformModuleId } from "@/platform/core/modules";

export type OrganizationRole = "owner" | "admin" | "member" | "viewer";

export type PermissionAction =
  "read" | "create" | "update" | "delete" | "approve" | "manage";

export type Permission = {
  module: PlatformModuleId | "platform";
  action: PermissionAction;
};

export const rolePermissions: Record<OrganizationRole, Permission[]> = {
  owner: [
    { module: "platform", action: "manage" },
    { module: "settings", action: "manage" },
    { module: "crm", action: "manage" },
    { module: "proposals", action: "manage" },
    { module: "automations", action: "approve" },
  ],
  admin: [
    { module: "settings", action: "update" },
    { module: "crm", action: "manage" },
    { module: "proposals", action: "manage" },
    { module: "automations", action: "approve" },
  ],
  member: [
    { module: "dashboard", action: "read" },
    { module: "crm", action: "create" },
    { module: "crm", action: "update" },
    { module: "proposals", action: "manage" },
  ],
  viewer: [
    { module: "dashboard", action: "read" },
    { module: "crm", action: "read" },
    { module: "proposals", action: "manage" },
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

// Modules gated behind a permission. Every other module stays visible to all
// members. Docs Generator (Maya) is granted to every role above, so this gate
// only rejects sessions without a recognized organization role.
export const moduleAccessRequirements: Partial<
  Record<PlatformModuleId, Permission>
> = {
  proposals: { module: "proposals", action: "read" },
};

export function canAccessModule(
  role: OrganizationRole,
  moduleId: PlatformModuleId,
) {
  const requirement = moduleAccessRequirements[moduleId];

  return requirement ? hasPermission(role, requirement) : true;
}
