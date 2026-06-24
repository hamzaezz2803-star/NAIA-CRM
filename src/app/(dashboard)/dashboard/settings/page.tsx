import React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Settings } from 'lucide-react'

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-extrabold tracking-tight">Paramètres Système</h2>
        <p className="text-zinc-400 text-sm mt-1">Configurez vos intégrations API (Supabase, Trello local, OpenAI, Google Drive).</p>
      </div>

      <Card className="border border-zinc-800 bg-zinc-900/40">
        <CardContent className="p-8 flex flex-col items-center justify-center text-center space-y-4">
          <div className="h-12 w-12 rounded-xl bg-zinc-800 flex items-center justify-center border border-zinc-700/50">
            <Settings className="h-6 w-6 text-zinc-400" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold">Intégrations actives</h3>
            <p className="text-sm text-zinc-400 max-w-sm">
              Votre base de données locale est connectée à Supabase. Vos clés d'API OpenAI et Google Workspace sont configurées via le fichier `.env.local`.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
