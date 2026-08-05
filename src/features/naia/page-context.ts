export type NaiaPageDataMode = "live" | "simulated";

export type NaiaPageModuleId =
  | "automations"
  | "crm"
  | "dashboard"
  | "finance"
  | "hr"
  | "integrations"
  | "leads"
  | "meetings"
  | "naia"
  | "projects"
  | "proposals"
  | "settings";

export type NaiaPageEntityKind = "lead" | "meeting" | "pitch" | "project";

export type NaiaPageContextEntity = {
  id: string;
  kind: NaiaPageEntityKind;
  label?: string;
};

export type NaiaPageContext = {
  dataMode: NaiaPageDataMode;
  entity?: NaiaPageContextEntity;
  filters?: Record<string, string>;
  moduleId: NaiaPageModuleId;
  moduleLabel: string;
  pathname: string;
  view: string;
  viewLabel: string;
};

export type NaiaPageContextDetail = {
  entity?: NaiaPageContextEntity;
  filters?: Record<string, string | undefined>;
  view?: string;
  viewLabel?: string;
};

type RouteContext = Omit<NaiaPageContext, "pathname"> & {
  matches: (pathname: string) => boolean;
};

const routeContexts: RouteContext[] = [
  {
    dataMode: "live",
    matches: (pathname) =>
      pathname === "/dashboard/leads" ||
      pathname === "/crm" ||
      pathname === "/naia/crm",
    moduleId: "crm",
    moduleLabel: "CRM",
    view: "pipeline",
    viewLabel: "Pipeline",
  },
  {
    dataMode: "simulated",
    matches: (pathname) => pathname === "/naia/leads",
    moduleId: "leads",
    moduleLabel: "Lead Intelligence",
    view: "prospecting",
    viewLabel: "Prospection",
  },
  {
    dataMode: "live",
    matches: (pathname) => pathname === "/meetings",
    moduleId: "meetings",
    moduleLabel: "Meetings",
    view: "calendar",
    viewLabel: "Agenda",
  },
  {
    dataMode: "live",
    matches: (pathname) => pathname === "/proposals",
    moduleId: "proposals",
    moduleLabel: "Docs Generator",
    view: "pitch-queue",
    viewLabel: "Pitchs",
  },
  {
    dataMode: "simulated",
    matches: (pathname) =>
      pathname === "/finance" || pathname === "/naia/cash-flow",
    moduleId: "finance",
    moduleLabel: "Finance",
    view: "cash-flow",
    viewLabel: "Cash-flow",
  },
  {
    dataMode: "simulated",
    matches: (pathname) =>
      pathname === "/projects" || pathname === "/naia/projects",
    moduleId: "projects",
    moduleLabel: "Projects",
    view: "portfolio",
    viewLabel: "Portfolio",
  },
  {
    dataMode: "simulated",
    matches: (pathname) => pathname === "/hr" || pathname === "/naia/hr",
    moduleId: "hr",
    moduleLabel: "HR",
    view: "staffing",
    viewLabel: "Staffing",
  },
  {
    dataMode: "live",
    matches: (pathname) => pathname === "/automations",
    moduleId: "automations",
    moduleLabel: "Automations",
    view: "workflows",
    viewLabel: "Workflows",
  },
  {
    dataMode: "live",
    matches: (pathname) => pathname === "/integrations",
    moduleId: "integrations",
    moduleLabel: "Intégrations",
    view: "connectors",
    viewLabel: "Connecteurs",
  },
  {
    dataMode: "live",
    matches: (pathname) =>
      pathname === "/settings" || pathname === "/dashboard/settings",
    moduleId: "settings",
    moduleLabel: "Settings",
    view: "governance",
    viewLabel: "Gouvernance",
  },
  {
    dataMode: "live",
    matches: (pathname) =>
      pathname === "/naia" || pathname === "/dashboard/naia",
    moduleId: "naia",
    moduleLabel: "NAIA",
    view: "cockpit",
    viewLabel: "Cockpit",
  },
  {
    dataMode: "live",
    matches: (pathname) => pathname === "/dashboard",
    moduleId: "dashboard",
    moduleLabel: "Dashboard",
    view: "overview",
    viewLabel: "Vue d'ensemble",
  },
];

const allowedEntityKinds = new Set<NaiaPageEntityKind>([
  "lead",
  "meeting",
  "pitch",
  "project",
]);

const allowedFilterKeys: Partial<
  Record<NaiaPageModuleId, ReadonlySet<string>>
> = {
  crm: new Set(["company", "status"]),
  meetings: new Set(["period", "status"]),
  projects: new Set(["risk", "status"]),
  proposals: new Set(["status"]),
};

const allowedViews: Partial<Record<NaiaPageModuleId, Record<string, string>>> =
  {
    crm: {
      calendar: "Calendrier",
      kanban: "Pipeline",
      list: "Liste",
      pipeline: "Pipeline",
    },
    meetings: {
      agenda: "Agenda",
      calendar: "Agenda",
      intelligence: "Meeting Intelligence",
      list: "Liste",
    },
    proposals: {
      "pitch-queue": "Pitchs",
    },
  };

const allowedEntityKindsByModule: Partial<
  Record<NaiaPageModuleId, ReadonlySet<NaiaPageEntityKind>>
> = {
  crm: new Set(["lead"]),
  meetings: new Set(["lead", "meeting"]),
  projects: new Set(["project"]),
  proposals: new Set(["lead", "pitch"]),
};

export function getBaseNaiaPageContext(pathname: string): NaiaPageContext {
  const safePathname = sanitizePathname(pathname);
  const routeContext = routeContexts.find((candidate) =>
    candidate.matches(safePathname),
  );

  if (!routeContext) {
    return {
      dataMode: "live",
      moduleId: "dashboard",
      moduleLabel: "Qarizmi OS",
      pathname: safePathname,
      view: "page",
      viewLabel: "Page active",
    };
  }

  return {
    dataMode: routeContext.dataMode,
    moduleId: routeContext.moduleId,
    moduleLabel: routeContext.moduleLabel,
    pathname: safePathname,
    view: routeContext.view,
    viewLabel: routeContext.viewLabel,
  };
}

export function mergeNaiaPageContext(
  pathname: string,
  detail?: NaiaPageContextDetail,
): NaiaPageContext {
  const base = getBaseNaiaPageContext(pathname);
  const view = sanitizeToken(detail?.view, 48);
  const viewLabel = sanitizeLabel(detail?.viewLabel, 64);
  const filters = sanitizeFilters(detail?.filters);
  const entity = sanitizeEntity(detail?.entity);

  return {
    ...base,
    ...(entity ? { entity } : {}),
    ...(filters ? { filters } : {}),
    ...(view ? { view } : {}),
    ...(viewLabel ? { viewLabel } : {}),
  };
}

export function parseNaiaPageContext(input: unknown) {
  if (!isRecord(input) || typeof input.pathname !== "string") {
    return undefined;
  }

  const base = getBaseNaiaPageContext(input.pathname);
  const rawEntity = isRecord(input.entity) ? input.entity : undefined;
  const allowedKeys = allowedFilterKeys[base.moduleId];
  const rawFilters =
    isRecord(input.filters) && allowedKeys
      ? Object.fromEntries(
          Object.entries(input.filters)
            .filter(
              (entry): entry is [string, string] =>
                allowedKeys.has(entry[0]) && typeof entry[1] === "string",
            )
            .slice(0, 8),
        )
      : undefined;
  const allowedModuleEntityKinds =
    allowedEntityKindsByModule[base.moduleId] ?? new Set();
  const requestedView =
    typeof input.view === "string" ? sanitizeToken(input.view, 48) : undefined;
  const safeView =
    requestedView && allowedViews[base.moduleId]?.[requestedView]
      ? requestedView
      : undefined;

  return mergeNaiaPageContext(input.pathname, {
    entity:
      rawEntity &&
      typeof rawEntity.id === "string" &&
      typeof rawEntity.kind === "string" &&
      allowedEntityKinds.has(rawEntity.kind as NaiaPageEntityKind) &&
      allowedModuleEntityKinds.has(rawEntity.kind as NaiaPageEntityKind)
        ? {
            id: rawEntity.id,
            kind: rawEntity.kind as NaiaPageEntityKind,
          }
        : undefined,
    filters: rawFilters,
    view: safeView,
    viewLabel: safeView ? allowedViews[base.moduleId]?.[safeView] : undefined,
  });
}

export function formatNaiaPageContextLabel(context: NaiaPageContext) {
  return `${context.moduleLabel} · ${context.viewLabel}`;
}

function sanitizeEntity(
  entity: NaiaPageContextDetail["entity"],
): NaiaPageContextEntity | undefined {
  if (
    !entity ||
    !allowedEntityKinds.has(entity.kind) ||
    !sanitizeToken(entity.id, 160)
  ) {
    return undefined;
  }

  return {
    id: sanitizeToken(entity.id, 160) as string,
    kind: entity.kind,
    ...(sanitizeLabel(entity.label, 120)
      ? { label: sanitizeLabel(entity.label, 120) }
      : {}),
  };
}

function sanitizeFilters(filters: NaiaPageContextDetail["filters"]) {
  if (!filters) return undefined;

  const entries = Object.entries(filters)
    .slice(0, 12)
    .flatMap(([key, value]) => {
      const safeKey = sanitizeToken(key, 40);
      const safeValue = sanitizeLabel(value, 120);
      return safeKey && safeValue ? [[safeKey, safeValue] as const] : [];
    });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function sanitizePathname(pathname: string) {
  const withoutQuery = pathname.split(/[?#]/, 1)[0] || "/";
  return withoutQuery.startsWith("/")
    ? withoutQuery.slice(0, 240)
    : `/${withoutQuery.slice(0, 239)}`;
}

function sanitizeToken(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  if (!clean || !/^[\w./:-]+$/u.test(clean)) return undefined;
  return clean.slice(0, maxLength);
}

function sanitizeLabel(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, maxLength) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
