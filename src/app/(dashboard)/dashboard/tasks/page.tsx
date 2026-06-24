import React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { CheckSquare } from 'lucide-react'

export default function TasksPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-extrabold tracking-tight">Tâches CRM</h2>
        <p className="text-zinc-400 text-sm mt-1">Gérez les actions de suivi et relance de vos leads.</p>
      </div>

      <Card className="border border-zinc-800 bg-zinc-900/40">
        <CardContent className="p-8 flex flex-col items-center justify-center text-center space-y-4">
          <div className="h-12 w-12 rounded-xl bg-zinc-800 flex items-center justify-center border border-zinc-700/50">
            <CheckSquare className="h-6 w-6 text-blue-400" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold">Aucune tâche en retard</h3>
            <p className="text-sm text-zinc-400 max-w-sm">
              Toutes vos tâches de relance et de suivi client sont à jour. L'assistant IA ajoutera automatiquement des relances basées sur vos saisies.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
