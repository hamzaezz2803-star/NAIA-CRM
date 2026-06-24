import React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { FileText } from 'lucide-react'

export default function DocumentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-extrabold tracking-tight">Documents Clients</h2>
        <p className="text-zinc-400 text-sm mt-1">Accédez aux dossiers Drive et pièces jointes synchronisés.</p>
      </div>

      <Card className="border border-zinc-800 bg-zinc-900/40">
        <CardContent className="p-8 flex flex-col items-center justify-center text-center space-y-4">
          <div className="h-12 w-12 rounded-xl bg-zinc-800 flex items-center justify-center border border-zinc-700/50">
            <FileText className="h-6 w-6 text-indigo-400" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold">Aucun document importé</h3>
            <p className="text-sm text-zinc-400 max-w-sm">
              Créez des dossiers clients Google Drive depuis la fiche d'un lead pour les faire apparaître automatiquement ici.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
