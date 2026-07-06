"use client";

import Link from "next/link";
import { type CSSProperties } from "react";
import { Sparkles } from "lucide-react";

import { naiaDelegatedAgents, type NaiaAgentId } from "./agents";
import WakeSequence from "./vendor/jarvis/WakeSequence";

const bootLines = [
  "NAIA OS ................. ONLINE",
  "voice kernel ............ READY",
  "crm agent SALMA ......... LINKED",
  "calendar agent ADAM ..... GUARDED",
  "docs agent MAYA ......... GUARDED",
];

type AgentGroupId = "preSales" | "projectManagement" | "support";

const agentGroupById: Partial<Record<NaiaAgentId, AgentGroupId>> = {
  automations: "projectManagement",
  crm: "preSales",
  developer: "support",
  finance: "support",
  hr: "support",
  integrations: "support",
  leads: "preSales",
  meetings: "preSales",
  projects: "projectManagement",
  proposals: "preSales",
  settings: "support",
};

const groupStyles: Record<
  AgentGroupId,
  {
    card: string;
    label: string;
    node: string;
    stroke: string;
  }
> = {
  preSales: {
    card: "border-cyan-300/60 bg-cyan-300/12 text-cyan-50 shadow-cyan-500/25",
    label: "border-cyan-300/35 bg-cyan-300/10 text-cyan-100",
    node: "rgba(103,232,249,0.92)",
    stroke: "rgba(34,211,238,0.28)",
  },
  projectManagement: {
    card: "border-violet-300/60 bg-violet-300/12 text-violet-50 shadow-violet-500/25",
    label: "border-violet-300/35 bg-violet-300/10 text-violet-100",
    node: "rgba(196,181,253,0.92)",
    stroke: "rgba(167,139,250,0.28)",
  },
  support: {
    card: "border-emerald-300/55 bg-emerald-300/12 text-emerald-50 shadow-emerald-500/22",
    label: "border-emerald-300/35 bg-emerald-300/10 text-emerald-100",
    node: "rgba(110,231,183,0.9)",
    stroke: "rgba(52,211,153,0.27)",
  },
};

const processLabels: Array<{
  className: string;
  groupId: AgentGroupId;
  label: string;
}> = [
  {
    className: "left-[9%] top-[18%]",
    groupId: "preSales",
    label: "Avant vente",
  },
  {
    className: "bottom-[11%] left-1/2 -translate-x-1/2",
    groupId: "projectManagement",
    label: "Project management",
  },
  {
    className: "right-[16%] top-[18%]",
    groupId: "support",
    label: "Fonctions support",
  },
];

const agentStats = [
  {
    label: "Agents",
    value: naiaDelegatedAgents.length,
  },
  {
    label: "Live",
    value: naiaDelegatedAgents.filter((agent) => agent.status === "live")
      .length,
  },
  {
    label: "Guarded",
    value: naiaDelegatedAgents.filter((agent) => agent.status === "guarded")
      .length,
  },
  {
    label: "Orchestrateur",
    value: 1,
  },
];

export function NaiaCommandCenter() {
  return (
    <section className="relative min-h-dvh overflow-hidden bg-[#020611] text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_46%,transparent_0,transparent_28%,rgba(2,6,17,0.34)_52%,rgba(2,6,17,0.82)_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(34,211,238,0.08)_1px,transparent_1px),linear-gradient(0deg,rgba(34,211,238,0.05)_1px,transparent_1px)] bg-[size:72px_72px] opacity-35" />

      <div className="relative min-h-dvh overflow-hidden bg-black/10 shadow-2xl shadow-cyan-950/50 backdrop-blur-sm">
        <div className="absolute inset-0">
          <WakeSequence
            bootLines={bootLines}
            requireFace={false}
            skippable={false}
            statusLabel="NAIA ACTIVE"
            userName="ALI"
          />
        </div>

        <div className="pointer-events-none absolute left-4 top-4 z-40">
          <div className="inline-flex min-h-9 items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 text-xs font-semibold uppercase text-cyan-100 shadow-lg shadow-cyan-500/10">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Qarizmi Operating System
          </div>
          <div className="mt-3 hidden max-w-[360px] grid-cols-4 gap-2 md:grid">
            {agentStats.map((stat) => (
              <div
                className="min-h-14 rounded-md border border-slate-50/10 bg-slate-950/50 px-3 py-2 shadow-lg shadow-slate-950/30 backdrop-blur-md"
                key={stat.label}
              >
                <p className="text-lg font-semibold leading-none text-slate-50">
                  {stat.value}
                </p>
                <p className="mt-1 text-[10px] font-semibold uppercase text-slate-300">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
          <h1 className="sr-only">
            NAIA orchestre les agents Qarizmi autour de la sphere.
          </h1>
        </div>

        <div className="relative h-full min-h-dvh">
          <OrbitLines />
          <ProcessLabels />
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 hidden -translate-x-1/2 translate-y-[105px] text-center md:block">
            <p className="text-xs font-semibold uppercase text-cyan-100/80">
              Voice orchestrator
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-50">NAIA</p>
          </div>

          {naiaDelegatedAgents.map((agent) => {
            const Icon = agent.icon;
            const group = getAgentGroup(agent.id);

            return (
              <Link
                className={`absolute z-30 hidden min-h-12 w-[156px] -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-md border px-3 py-2 text-left shadow-lg backdrop-blur-md transition hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 md:flex ${groupStyles[group].card}`}
                href={agent.route}
                key={agent.id}
                style={
                  {
                    left: `${agent.orbit.desktop.x}%`,
                    top: `${agent.orbit.desktop.y}%`,
                  } as CSSProperties
                }
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-50/10">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {agent.label}
                  </span>
                  <span className="block truncate text-xs text-slate-100/68">
                    {agent.name}
                  </span>
                  <span className="mt-1 inline-flex rounded-full border border-slate-50/10 bg-slate-50/8 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-100/72">
                    {agent.status === "guarded" ? "Guarded" : "Live"}
                  </span>
                </span>
              </Link>
            );
          })}

          <div className="absolute inset-x-4 bottom-24 z-30 grid max-h-[420px] gap-2 overflow-y-auto pr-1 md:hidden">
            {naiaDelegatedAgents.map((agent) => {
              const Icon = agent.icon;
              const group = getAgentGroup(agent.id);

              return (
                <Link
                  className={`flex min-h-12 items-center gap-3 rounded-md border px-3 py-2 shadow-lg backdrop-blur-md ${groupStyles[group].card}`}
                  href={agent.route}
                  key={agent.id}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span className="min-w-0 text-sm font-semibold">
                    {agent.label}
                    <span className="ml-2 text-xs font-medium uppercase text-slate-600 dark:text-slate-100/58">
                      {agent.status}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function OrbitLines() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 hidden h-full w-full md:block"
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
    >
      <defs>
        <radialGradient id="naiaNodeGlow">
          <stop offset="0%" stopColor="rgba(255,255,255,0.88)" />
          <stop offset="100%" stopColor="rgba(34,211,238,0)" />
        </radialGradient>
      </defs>
      {naiaDelegatedAgents.map((agent) => (
        <g key={agent.id}>
          <path
            d={`M50 50 C ${50 + (agent.orbit.desktop.x - 50) * 0.22} ${
              50 + (agent.orbit.desktop.y - 50) * 0.18
            }, ${agent.orbit.desktop.x} ${
              50 + (agent.orbit.desktop.y - 50) * 0.42
            }, ${agent.orbit.desktop.x} ${agent.orbit.desktop.y}`}
            fill="none"
            stroke={groupStyles[getAgentGroup(agent.id)].stroke}
            strokeWidth={0.16}
          />
          <circle
            cx={agent.orbit.desktop.x}
            cy={agent.orbit.desktop.y}
            fill={groupStyles[getAgentGroup(agent.id)].node}
            opacity={agent.status === "live" ? 0.52 : 0.34}
            r={agent.status === "live" ? 2.3 : 1.9}
          />
        </g>
      ))}
    </svg>
  );
}

function ProcessLabels() {
  return (
    <>
      {processLabels.map((item) => (
        <div
          className={`pointer-events-none absolute z-20 hidden rounded-full border px-3 py-1.5 text-xs font-semibold uppercase md:block ${groupStyles[item.groupId].label} ${item.className}`}
          key={item.label}
        >
          {item.label}
        </div>
      ))}
    </>
  );
}

function getAgentGroup(agentId: NaiaAgentId): AgentGroupId {
  return agentGroupById[agentId] ?? "support";
}
