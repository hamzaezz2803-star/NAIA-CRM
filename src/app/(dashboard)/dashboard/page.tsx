import React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Users2,
  CalendarCheck,
  FileCheck2,
  FolderOpen,
  ArrowRight,
  TrendingUp,
  Clock,
  Sparkles,
  Bot
} from 'lucide-react'

export default function DashboardPage() {
  // Mock statistics for the MVP CRM dashboard overview
  const stats = [
    { name: 'Leads à Contacter', value: '14', icon: Users2, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { name: 'Rendez-vous Fixés', value: '4', icon: CalendarCheck, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
    { name: 'Propositions Envoyées', value: '7', icon: FileCheck2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
    { name: 'Dossiers Google Drive', value: '11', icon: FolderOpen, color: 'text-amber-500', bg: 'bg-amber-500/10' },
  ]

  const recentActivity = [
    { action: 'Lead créé', target: 'Achraf Hakimi (Afriquia)', details: 'Saisie vocale / IA Agent', time: 'Il y a 10 min', status: 'success' },
    { action: 'Relance générée', target: 'Email rédigé pour Inwi', details: 'Brouillon prêt à envoyer', time: 'Il y a 1 heure', status: 'info' },
    { action: 'Dossier Drive créé', target: 'Client - Afriquia', details: 'Pitch, Notes, Proposal, Contract', time: 'Il y a 2 heures', status: 'success' },
    { action: 'Label mis à jour', target: 'Maroc Telecom -> Propale envoyée', details: 'Trello local card update', time: 'Il y a 1 jour', status: 'default' },
  ]

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl border border-zinc-800 bg-gradient-to-r from-zinc-900 via-zinc-900 to-blue-950/20 shadow-xl overflow-hidden relative">
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-blue-500/5 blur-[80px] pointer-events-none" />
        <div className="space-y-1.5 z-10">
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-400 uppercase tracking-wider">
            <Bot className="h-4 w-4" />
            <span>Assistant IA Actif</span>
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight">Bienvenue sur Qarizmi OS</h2>
          <p className="text-sm text-zinc-400 max-w-xl">
            Votre hub intelligent pour importer vos leads, automatiser vos relances et orchestrer vos espaces de stockage client en un clic.
          </p>
        </div>
        <div className="flex shrink-0 gap-3 z-10">
          <Link href="/dashboard/leads">
            <Button className="font-semibold shadow-md cursor-pointer">
              Accéder au CRM
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Grid statistics panels */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => {
          const Icon = stat.icon
          return (
            <Card key={i} className="border border-zinc-800 bg-zinc-900/40 hover:border-zinc-700/60 transition-all duration-200">
              <CardContent className="p-6 flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{stat.name}</p>
                  <p className="text-3xl font-bold tracking-tight text-zinc-50">{stat.value}</p>
                </div>
                <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${stat.bg}`}>
                  <Icon className={`h-6 w-6 ${stat.color}`} />
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Two Columns Board */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Activity */}
        <Card className="lg:col-span-2 border border-zinc-800 bg-zinc-900/30 backdrop-blur-sm">
          <CardHeader className="border-b border-zinc-800/60 bg-zinc-900/10 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-400" />
                <CardTitle className="text-base font-bold">Activité Récente</CardTitle>
              </div>
              <span className="text-[10px] px-2 py-1 rounded bg-zinc-800/80 border border-zinc-700/30 text-zinc-400 font-semibold uppercase tracking-wider">
                Flux Live
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="flow-root">
              <ul className="-mb-8">
                {recentActivity.map((activity, idx) => (
                  <li key={idx}>
                    <div className="relative pb-8">
                      {idx !== recentActivity.length - 1 ? (
                        <span className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-zinc-800" aria-hidden="true" />
                      ) : null}
                      <div className="relative flex space-x-3">
                        <div>
                          <span className={cn(
                            "h-8 w-8 rounded-full flex items-center justify-center ring-8 ring-zinc-900 border",
                            activity.status === 'success' ? 'bg-emerald-950/40 border-emerald-800/40 text-emerald-400' :
                            activity.status === 'info' ? 'bg-blue-950/40 border-blue-800/40 text-blue-400' :
                            'bg-zinc-800/40 border-zinc-700/40 text-zinc-400'
                          )}>
                            {activity.status === 'success' ? <Sparkles className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0 pt-1.5 flex justify-between space-x-4">
                          <div>
                            <p className="text-sm text-zinc-200">
                              <span className="font-semibold text-zinc-100">{activity.action}</span> : {activity.target}
                            </p>
                            <p className="text-xs text-zinc-500 mt-0.5">{activity.details}</p>
                          </div>
                          <div className="text-right text-xs whitespace-nowrap text-zinc-500 font-medium">
                            <time>{activity.time}</time>
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* AI Agent intake Quick Panel */}
        <Card className="border border-zinc-800 bg-zinc-900/30 backdrop-blur-sm flex flex-col justify-between">
          <CardHeader className="border-b border-zinc-800/60 bg-zinc-900/10 py-4">
            <div className="flex items-center gap-2">
              <Bot className="h-4.5 w-4.5 text-blue-400" />
              <CardTitle className="text-base font-bold">Raccourcis IA CRM</CardTitle>
            </div>
            <CardDescription className="text-xs">Exécutez vos opérations clés en langage naturel</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-4 flex-1">
            <div className="p-4 rounded-xl border border-zinc-800/60 bg-zinc-950/40 text-xs text-zinc-400 leading-relaxed">
              <span className="font-semibold text-blue-400 block mb-1">Exemple d'Intake lead :</span>
              "J'ai parlé à Achraf Hakimi de Afriquia pour un projet IA Client, à relancer vendredi."
            </div>
            
            <div className="space-y-2">
              <Link href="/dashboard/leads" className="block w-full">
                <Button variant="outline" className="w-full text-zinc-300 border-zinc-800 hover:bg-zinc-800/60 font-medium text-xs justify-start h-9">
                  <TrendingUp className="mr-2 h-4 w-4 text-blue-400" />
                  Ajouter un lead (Langage Naturel)
                </Button>
              </Link>
              <Link href="/dashboard/leads" className="block w-full">
                <Button variant="outline" className="w-full text-zinc-300 border-zinc-800 hover:bg-zinc-800/60 font-medium text-xs justify-start h-9">
                  <Bot className="mr-2 h-4 w-4 text-indigo-400" />
                  Générer une relance (WhatsApp/Email)
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
