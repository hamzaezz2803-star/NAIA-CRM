'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Plus,
  Bot,
  Mail,
  Phone,
  Sparkles,
  MessageSquarePlus,
  FolderPlus,
  CheckCircle,
  Briefcase,
  Loader2,
  LogOut,
  Globe,
  AlertTriangle,
  CalendarDays,
  LayoutGrid,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { Lead } from '@/lib/definitions'
import { fetchLeadsAction, createLeadAction, updateLeadAction } from '@/app/actions/leads'
import { extractLeadFromTextAction, generateFollowUpDraftAction } from '@/app/actions/ai'
import { checkGoogleAuthAction, createGoogleDriveFolderAction, disconnectGoogleAuthAction } from '@/app/actions/google-drive'

export default function LeadsPage() {
  const columns: { label: string; status: Lead['status']; color: string; border: string }[] = [
    { label: 'Leads à contacter', status: 'lead_to_contact', color: 'bg-blue-500/10 text-blue-400', border: 'border-blue-500/20' },
    { label: 'Déjà contacté', status: 'contacted', color: 'bg-zinc-500/10 text-zinc-400', border: 'border-zinc-500/20' },
    { label: 'À relancer', status: 'follow_up', color: 'bg-amber-500/10 text-amber-400', border: 'border-amber-500/20' },
    { label: 'Meeting booked', status: 'meeting_booked', color: 'bg-indigo-500/10 text-indigo-400', border: 'border-indigo-500/20' },
    { label: 'Propales envoyées', status: 'proposal_sent', color: 'bg-emerald-500/10 text-emerald-400', border: 'border-emerald-500/20' },
    { label: 'Dead ends', status: 'dead_end', color: 'bg-red-500/10 text-red-400', border: 'border-red-500/20' },
  ]

  // CRM State
  const [leads, setLeads] = useState<Lead[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'kanban' | 'calendar'>('kanban')
  const [calendarDate, setCalendarDate] = useState(new Date())
  const [isGoogleConnected, setIsGoogleConnected] = useState(false)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  
  // Lead Create/Edit States
  const [isAddingLead, setIsAddingLead] = useState(false)
  const [naturalText, setNaturalText] = useState('')
  const [isExtracting, setIsExtracting] = useState(false)

  // Standard Lead Add Form states
  const [newCompany, setNewCompany] = useState('')
  const [newContact, setNewContact] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newStatus, setNewStatus] = useState<Lead['status']>('lead_to_contact')
  const [newNotes, setNewNotes] = useState('')
  
  // IA follow-up drafts state
  const [generatedDraft, setGeneratedDraft] = useState<{ email: string; whatsapp: string } | null>(null)
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false)

  // Drive folder creation state
  const [driveLink, setDriveLink] = useState<string | null>(null)
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [modalError, setModalError] = useState<string | null>(null)

  // Helper: extract a Google Drive link already stored in lead notes
  const extractDriveLinkFromNotes = (notes?: string): string | null => {
    if (!notes) return null
    const match = notes.match(/\[Google Drive Folder:[^\]]*\]\((https:\/\/[^)]+)\)/)
    return match ? match[1] : null
  }

  // Load leads from Supabase on mount
  const loadLeads = async () => {
    setIsLoading(true)
    const dbLeads = await fetchLeadsAction()
    setLeads(dbLeads)
    setIsLoading(false)
  }

  const checkGoogleAuth = async () => {
    const isAuth = await checkGoogleAuthAction()
    setIsGoogleConnected(isAuth)
  }

  useEffect(() => {
    loadLeads()
    checkGoogleAuth()
  }, [])

  // Listen for Google Auth callback messaging from popup
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
        setIsGoogleConnected(true)
        setErrorMsg(null)
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // Trigger Google Login popup
  const handleConnectGoogle = () => {
    const width = 500
    const height = 600
    const left = window.screen.width / 2 - width / 2
    const top = window.screen.height / 2 - height / 2
    window.open(
      '/api/integrations/google/auth',
      'GoogleAuth',
      `width=${width},height=${height},left=${left},top=${top},status=no,resizable=yes,scrollbars=yes`
    )
  }

  // IA Intake lead extraction
  const handleExtractLead = async () => {
    if (!naturalText.trim()) return
    setIsExtracting(true)
    setErrorMsg(null)

    const res = await extractLeadFromTextAction(naturalText)

    if (res.success && res.data) {
      setNewCompany(res.data.company)
      setNewContact(res.data.contact_name)
      setNewPhone(res.data.phone || '')
      setNewEmail(res.data.email || '')
      setNewStatus(res.data.status || 'lead_to_contact')
      setNewNotes(res.data.notes || '')
      setIsAddingLead(true) // Switch to confirmation panel
    } else {
      setErrorMsg(res.error || "Une erreur est survenue lors de l'extraction.")
    }
    setIsExtracting(false)
  }

  // Create lead handler
  const handleCreateLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCompany || !newContact) return

    const res = await createLeadAction({
      company: newCompany,
      contact_name: newContact,
      email: newEmail,
      phone: newPhone,
      source: 'Intake Agent',
      status: newStatus,
      next_action: 'À planifier',
      notes: newNotes,
    })

    if (res.success && res.lead) {
      setLeads([res.lead, ...leads])
      
      // Clear forms
      setNewCompany('')
      setNewContact('')
      setNewEmail('')
      setNewPhone('')
      setNewStatus('lead_to_contact')
      setNewNotes('')
      setNaturalText('')
      setIsAddingLead(false)
    } else {
      setErrorMsg(res.error || "Impossible de créer le lead.")
    }
  }

  // IA draft generator
  const handleGenerateFollowUp = async (lead: Lead) => {
    setIsGeneratingDraft(true)
    setGeneratedDraft(null)
    setModalError(null)

    const res = await generateFollowUpDraftAction(lead.company, lead.contact_name, lead.notes || '')

    if (res.success && res.email && res.whatsapp) {
      setGeneratedDraft({
        email: res.email,
        whatsapp: res.whatsapp
      })
    } else {
      setModalError(res.error || 'Erreur lors de la génération du brouillon.')
    }
    setIsGeneratingDraft(false)
  }

  // Google Drive folder creator
  const handleCreateDriveFolder = async (lead: Lead) => {
    setModalError(null)
    setDriveLink(null)

    if (!isGoogleConnected) {
      setModalError("Veuillez d'abord connecter votre compte Google. L'assistant ouvre la fenêtre de connexion...")
      handleConnectGoogle()
      return
    }

    setIsCreatingFolder(true)
    const res = await createGoogleDriveFolderAction(lead.id, lead.company)

    if (res.success && res.folderLink) {
      setDriveLink(res.folderLink)
      
      // Update local state to append notes containing the folder link
      const updatedNotes = lead.notes 
        ? `${lead.notes}\n[Google Drive Folder: Client - ${lead.company}](${res.folderLink})`
        : `[Google Drive Folder: Client - ${lead.company}](${res.folderLink})`

      setLeads(leads.map(l => l.id === lead.id ? { ...l, notes: updatedNotes } : l))
      setSelectedLead(prev => prev && prev.id === lead.id ? { ...prev, notes: updatedNotes } : prev)

      // Open in a new window/tab immediately
      window.open(res.folderLink, '_blank')
    } else {
      setModalError(res.error || 'Erreur lors de la création du dossier Drive.')
    }
    setIsCreatingFolder(false)
  }

  const handleUpdateStatus = async (newStatusVal: Lead['status']) => {
    if (!selectedLead) return
    const res = await updateLeadAction(selectedLead.id, { status: newStatusVal })
    if (res.success && res.lead) {
      setSelectedLead(res.lead)
      setLeads(leads.map(l => l.id === selectedLead.id ? res.lead! : l))
    } else {
      setErrorMsg(res.error || 'Impossible de déplacer le lead.')
    }
  }

  return (
    <div className="space-y-6">
      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight">Mini CRM & Kanban Leads</h2>
          <p className="text-zinc-400 text-sm mt-1">Gérez votre pipe commercial et activez vos agents de productivité.</p>
        </div>

        <div className="flex items-center gap-3">
          {isGoogleConnected ? (
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Google Connecté
              <button
                onClick={async () => {
                  await disconnectGoogleAuthAction()
                  setIsGoogleConnected(false)
                }}
                title="Déconnecter Google"
                className="text-zinc-500 hover:text-red-400 ml-1 transition cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <Button
              onClick={handleConnectGoogle}
              variant="secondary"
              className="cursor-pointer font-semibold text-xs border border-zinc-800 bg-zinc-850 hover:bg-zinc-800 text-zinc-100 shrink-0"
            >
              <Globe className="mr-2 h-4 w-4 text-blue-400" />
              Connecter Google
            </Button>
          )}

          <Button onClick={() => { setIsAddingLead(true); setSelectedLead(null); setErrorMsg(null); }} className="cursor-pointer font-semibold shrink-0">
            <Plus className="mr-2 h-4 w-4" />
            Nouveau Lead
          </Button>

          {/* View Toggle */}
          <div className="flex items-center gap-1 border border-zinc-800 rounded-lg p-1 bg-zinc-950">
            <button
              onClick={() => setViewMode('kanban')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold transition-all ${
                viewMode === 'kanban'
                  ? 'bg-zinc-800 text-zinc-100 shadow'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Kanban
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold transition-all ${
                viewMode === 'calendar'
                  ? 'bg-zinc-800 text-zinc-100 shadow'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Calendrier
            </button>
          </div>
        </div>
      </div>

      {/* Global Error Banner */}
      {errorMsg && (
        <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/5 text-red-400 text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* IA Add Intake Form Block */}
      <Card className="border border-zinc-800 bg-zinc-900/40">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4.5 w-4.5 text-blue-400 animate-pulse" />
            <span className="text-sm font-bold text-zinc-200">Ajouter un Lead en Langage Naturel (Intake Agent)</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              value={naturalText}
              onChange={(e) => setNaturalText(e.target.value)}
              placeholder="Ex: J'ai parlé à Yassine de Maroc Telecom, potentiel sujet de chatbot, statut à relancer..."
              className="border-zinc-800 bg-zinc-950/40 text-zinc-100 flex-1"
            />
            <Button
              onClick={handleExtractLead}
              disabled={isExtracting || !naturalText.trim()}
              variant="secondary"
              className="cursor-pointer font-semibold shrink-0 border border-zinc-800 bg-zinc-850 hover:bg-zinc-800 text-zinc-100"
            >
              {isExtracting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Extraction...
                </>
              ) : (
                <>
                  <Bot className="mr-2 h-4 w-4 text-indigo-400" />
                  Extraire le Lead
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Loading State or Kanban/Calendar Board */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center min-h-[300px] space-y-4">
          <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
          <p className="text-zinc-500 text-sm">Chargement de vos leads depuis la base de données...</p>
        </div>
      ) : viewMode === 'kanban' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5 items-start w-full">
          {columns.map((col) => {
            const colLeads = leads.filter((l) => l.status === col.status)
            return (
              <div key={col.status} className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/10 p-2.5 space-y-3 w-full min-w-0">
                {/* Header column title */}
                <div className="flex items-center justify-between">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${col.color} border ${col.border} truncate max-w-[85%]`}>
                    {col.label}
                  </span>
                  <span className="text-xs font-semibold text-zinc-500 shrink-0">{colLeads.length}</span>
                </div>

                {/* Cards wrapper */}
                <div className="space-y-2 min-h-[300px]">
                  {colLeads.map((lead) => (
                    <div
                      key={lead.id}
                      onClick={() => {
                        setSelectedLead(lead)
                        setIsAddingLead(false)
                        setGeneratedDraft(null)
                        // Auto-detect existing Drive link from notes
                        setDriveLink(extractDriveLinkFromNotes(lead.notes))
                        setErrorMsg(null)
                        setModalError(null)
                      }}
                      className="p-3 rounded-lg border border-zinc-800 bg-zinc-950/40 hover:bg-zinc-900/40 hover:border-zinc-700/50 hover:shadow-lg transition-all duration-200 cursor-pointer space-y-2"
                    >
                      <div className="space-y-0.5">
                        <div className="text-[10px] text-blue-400 font-bold tracking-wide uppercase truncate">
                          {lead.company}
                        </div>
                        <div className="text-xs font-bold text-zinc-100 truncate">{lead.contact_name}</div>
                      </div>

                      <div className="space-y-1 text-[10px] text-zinc-400">
                        {lead.email && (
                          <div className="flex items-center gap-1">
                            <Mail className="h-3 w-3 text-zinc-500 shrink-0" />
                            <span className="truncate">{lead.email}</span>
                          </div>
                        )}
                        {lead.next_action && (
                          <div className="text-[10px] text-amber-400 font-medium bg-amber-500/5 p-1.5 rounded border border-amber-500/10 line-clamp-2">
                            {lead.next_action}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {colLeads.length === 0 && (
                    <div className="h-24 rounded-lg border border-dashed border-zinc-850 flex items-center justify-center text-xs text-zinc-650">
                      Aucun lead
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* ===== CALENDAR VIEW ===== */
        (() => {
          const statusDotColor: Record<Lead['status'], string> = {
            lead_to_contact: 'bg-blue-500',
            contacted: 'bg-zinc-400',
            follow_up: 'bg-amber-400',
            meeting_booked: 'bg-indigo-500',
            proposal_sent: 'bg-emerald-500',
            dead_end: 'bg-red-500',
          }
          const statusBgColor: Record<Lead['status'], string> = {
            lead_to_contact: 'bg-blue-500/15 border-blue-500/30 text-blue-300',
            contacted: 'bg-zinc-500/15 border-zinc-500/30 text-zinc-300',
            follow_up: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
            meeting_booked: 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300',
            proposal_sent: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
            dead_end: 'bg-red-500/15 border-red-500/30 text-red-300',
          }

          const year = calendarDate.getFullYear()
          const month = calendarDate.getMonth()
          const firstDay = new Date(year, month, 1).getDay() // 0=Sun
          const daysInMonth = new Date(year, month + 1, 0).getDate()
          const monthName = calendarDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })

          // Map leads by date string 'YYYY-MM-DD'
          const leadsByDate: Record<string, Lead[]> = {}
          leads.forEach(lead => {
            if (!lead.created_at) return
            const d = new Date(lead.created_at)
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
            if (!leadsByDate[key]) leadsByDate[key] = []
            leadsByDate[key].push(lead)
          })

          const today = new Date()
          const isToday = (day: number) =>
            day === today.getDate() && month === today.getMonth() && year === today.getFullYear()

          const paddedStart = firstDay === 0 ? 6 : firstDay - 1 // Mon-first grid

          return (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/20 overflow-hidden">
              {/* Calendar Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
                <button
                  onClick={() => setCalendarDate(new Date(year, month - 1, 1))}
                  className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition cursor-pointer"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="text-center">
                  <h3 className="text-base font-bold text-zinc-100 capitalize">{monthName}</h3>
                  <p className="text-xs text-zinc-500">{leads.length} lead{leads.length !== 1 ? 's' : ''} au total</p>
                </div>
                <button
                  onClick={() => setCalendarDate(new Date(year, month + 1, 1))}
                  className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition cursor-pointer"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {/* Day Labels */}
              <div className="grid grid-cols-7 border-b border-zinc-800">
                {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(d => (
                  <div key={d} className="py-2 text-center text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                    {d}
                  </div>
                ))}
              </div>

              {/* Calendar Grid */}
              <div className="grid grid-cols-7">
                {/* Empty cells before start */}
                {Array.from({ length: paddedStart }).map((_, i) => (
                  <div key={`empty-${i}`} className="min-h-[90px] border-b border-r border-zinc-800/50 bg-zinc-950/20" />
                ))}

                {/* Day cells */}
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                  const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                  const dayLeads = leadsByDate[dateKey] || []
                  const isCurrentDay = isToday(day)

                  return (
                    <div
                      key={day}
                      className={`min-h-[90px] border-b border-r border-zinc-800/50 p-1.5 flex flex-col gap-1 ${
                        isCurrentDay ? 'bg-blue-950/20' : 'hover:bg-zinc-900/30'
                      } transition-colors`}
                    >
                      {/* Day number */}
                      <div className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full mb-0.5 ${
                        isCurrentDay
                          ? 'bg-blue-500 text-white'
                          : 'text-zinc-500'
                      }`}>
                        {day}
                      </div>

                      {/* Lead badges */}
                      <div className="flex flex-col gap-1 overflow-hidden">
                        {dayLeads.slice(0, 3).map(lead => (
                          <button
                            key={lead.id}
                            onClick={() => {
                              setSelectedLead(lead)
                              setIsAddingLead(false)
                              setGeneratedDraft(null)
                              setDriveLink(extractDriveLinkFromNotes(lead.notes))
                              setErrorMsg(null)
                              setModalError(null)
                            }}
                            className={`w-full text-left px-1.5 py-0.5 rounded border text-[9px] font-semibold truncate cursor-pointer hover:opacity-80 transition-opacity flex items-center gap-1 ${
                              statusBgColor[lead.status]
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusDotColor[lead.status]}`} />
                            <span className="truncate">{lead.company}</span>
                          </button>
                        ))}
                        {dayLeads.length > 3 && (
                          <span className="text-[9px] text-zinc-500 pl-1">
                            +{dayLeads.length - 3} autres
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Legend */}
              <div className="px-5 py-3 border-t border-zinc-800 flex flex-wrap gap-3">
                {columns.map(col => (
                  <div key={col.status} className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${statusDotColor[col.status]}`} />
                    <span className="text-[10px] text-zinc-400">{col.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })()
      )}

      {/* Side Slide Modal for Lead Details / Form Add */}
      {(selectedLead || isAddingLead) && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 flex justify-end">
          <div className="w-full max-w-lg bg-zinc-900 border-l border-zinc-800 h-full p-6 overflow-y-auto space-y-6 flex flex-col justify-between">
            
            {/* Modal Header */}
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
                <h3 className="text-lg font-bold text-zinc-100">
                  {isAddingLead ? "Créer un Nouveau Lead" : "Détails du Lead"}
                </h3>
                <Button
                  onClick={() => { setSelectedLead(null); setIsAddingLead(false); setGeneratedDraft(null); setDriveLink(null); setErrorMsg(null); setModalError(null); }}
                  variant="ghost"
                  size="sm"
                  className="text-zinc-400 hover:text-zinc-50 border border-zinc-800 hover:bg-zinc-800"
                >
                  Fermer
                </Button>
              </div>

              {/* Add Lead Form view */}
              {isAddingLead && (
                <form onSubmit={handleCreateLeadSubmit} className="space-y-4 mt-6">
                  <div className="space-y-1.5">
                    <Label>Entreprise *</Label>
                    <Input
                      value={newCompany}
                      onChange={(e) => setNewCompany(e.target.value)}
                      required
                      className="border-zinc-800 bg-zinc-950/50 text-zinc-100"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Nom du Contact *</Label>
                    <Input
                      value={newContact}
                      onChange={(e) => setNewContact(e.target.value)}
                      required
                      className="border-zinc-800 bg-zinc-950/50 text-zinc-100"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      type="email"
                      className="border-zinc-800 bg-zinc-950/50 text-zinc-100"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Téléphone</Label>
                    <Input
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      className="border-zinc-800 bg-zinc-950/50 text-zinc-100"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Statut</Label>
                    <select
                      value={newStatus}
                      onChange={(e) => setNewStatus(e.target.value as Lead['status'])}
                      className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {columns.map(c => (
                        <option key={c.status} value={c.status}>{c.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Notes / Contexte</Label>
                    <textarea
                      value={newNotes}
                      onChange={(e) => setNewNotes(e.target.value)}
                      rows={4}
                      className="flex w-full rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm text-zinc-300 focus-visible:outline-none focus-visible:ring-2"
                    />
                  </div>

                  <Button type="submit" className="w-full font-semibold cursor-pointer">
                    Enregistrer le Lead
                  </Button>
                </form>
              )}

              {/* Lead Details view */}
              {selectedLead && (
                <div className="space-y-6 mt-6">
                  {/* Summary Block */}
                  <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/30 flex items-center justify-between">
                    <div className="space-y-1 flex-1">
                      <div className="text-xs text-blue-400 font-semibold">{selectedLead.company}</div>
                      <div className="text-xl font-bold text-zinc-100">{selectedLead.contact_name}</div>
                      
                      <div className="mt-2.5">
                        <Label className="text-[10px] text-zinc-500 uppercase block mb-1">Déplacer l'étape</Label>
                        <select
                          value={selectedLead.status}
                          onChange={(e) => handleUpdateStatus(e.target.value as Lead['status'])}
                          className="h-8 rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-300 focus-visible:outline-none"
                        >
                          {columns.map(c => (
                            <option key={c.status} value={c.status}>{c.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Details Grid */}
                  <div className="space-y-3 text-sm text-zinc-300">
                    {selectedLead.email && (
                      <div className="flex items-center gap-3">
                        <Mail className="h-4 w-4 text-zinc-500 shrink-0" />
                        <span>{selectedLead.email}</span>
                      </div>
                    )}
                    {selectedLead.phone && (
                      <div className="flex items-center gap-3">
                        <Phone className="h-4 w-4 text-zinc-500 shrink-0" />
                        <span>{selectedLead.phone}</span>
                      </div>
                    )}
                    {selectedLead.source && (
                      <div className="flex items-center gap-3">
                        <Briefcase className="h-4 w-4 text-zinc-500 shrink-0" />
                        <span className="text-xs text-zinc-400">Source : {selectedLead.source}</span>
                      </div>
                    )}
                  </div>

                  {/* Action / Notes */}
                  <div className="space-y-4 pt-4 border-t border-zinc-800">
                    {selectedLead.next_action && (
                      <div className="space-y-1.5">
                        <Label className="text-amber-400">Prochaine action</Label>
                        <p className="text-sm bg-amber-500/5 border border-amber-500/10 p-3 rounded-lg text-amber-200">
                          {selectedLead.next_action}
                        </p>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label>Notes & Contexte</Label>
                      <p className="text-sm bg-zinc-950/40 border border-zinc-850 p-3 rounded-lg text-zinc-300 whitespace-pre-line">
                        {selectedLead.notes || "Aucune note."}
                      </p>
                    </div>
                  </div>

                  {/* Modal specific error */}
                  {modalError && (
                    <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/5 text-red-400 text-xs flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>{modalError}</span>
                    </div>
                  )}

                  {/* Operations Buttons (Sprint 1 Agents Panel) */}
                  <div className="pt-6 border-t border-zinc-800 space-y-3">
                    <Label className="text-zinc-400 block mb-1">Actions d'Automatisation IA</Label>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <Button
                        onClick={() => handleGenerateFollowUp(selectedLead)}
                        disabled={isGeneratingDraft}
                        variant="secondary"
                        className="cursor-pointer font-semibold text-xs h-10 border border-zinc-800 bg-zinc-850 hover:bg-zinc-800"
                      >
                        {isGeneratingDraft ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Génération...
                          </>
                        ) : (
                          <>
                            <MessageSquarePlus className="mr-2 h-4 w-4 text-blue-400" />
                            Relance Draft IA
                          </>
                        )}
                      </Button>

                      <Button
                        onClick={() => {
                          if (!selectedLead) return
                          // If Drive link already exists (stored in notes), open it directly
                          const existingLink = extractDriveLinkFromNotes(selectedLead.notes)
                          if (existingLink) {
                            setDriveLink(existingLink)
                            window.open(existingLink, '_blank')
                            return
                          }
                          // Otherwise, create a new folder
                          handleCreateDriveFolder(selectedLead)
                        }}
                        disabled={isCreatingFolder}
                        variant="secondary"
                        className="cursor-pointer font-semibold text-xs h-10 border border-zinc-800 bg-zinc-850 hover:bg-zinc-800"
                      >
                        {isCreatingFolder ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Dossier...
                          </>
                        ) : (
                          <>
                            {extractDriveLinkFromNotes(selectedLead.notes) ? (
                              <>
                                <FolderPlus className="mr-2 h-4 w-4 text-emerald-400" />
                                Ouvrir Drive ↗
                              </>
                            ) : (
                              <>
                                <FolderPlus className="mr-2 h-4 w-4 text-indigo-400" />
                                Dossier Drive Client
                              </>
                            )}
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* IA Output display */}
                  {generatedDraft && (() => {
                    // Parse subject and body from email string
                    const emailLines = (generatedDraft.email || '').split('\n')
                    const subjectLine = emailLines.find(l => l.toLowerCase().startsWith('sujet:') || l.toLowerCase().startsWith('subject:')) || ''
                    const subject = subjectLine.replace(/^(sujet|subject)\s*:\s*/i, '').trim()
                    const body = emailLines.filter(l => l !== subjectLine).join('\n').trim()

                    // Build Gmail mailto link
                    const recipientEmail = selectedLead.email || ''
                    const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(recipientEmail)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

                    // Build WhatsApp link (use phone number if available)
                    const phone = (selectedLead.phone || '').replace(/\D/g, '')
                    const waUrl = phone
                      ? `https://wa.me/${phone}?text=${encodeURIComponent(generatedDraft.whatsapp || '')}`
                      : `https://wa.me/?text=${encodeURIComponent(generatedDraft.whatsapp || '')}`

                    return (
                      <div className="space-y-3 animate-fadeIn">
                        {/* Email Draft Card */}
                        <div className="rounded-xl border border-blue-500/20 bg-blue-950/10 overflow-hidden">
                          {/* Email header */}
                          <div className="flex items-center justify-between px-4 py-2.5 bg-blue-950/20 border-b border-blue-500/15">
                            <div className="flex items-center gap-2">
                              <Mail className="h-3.5 w-3.5 text-blue-400" />
                              <span className="text-xs font-bold text-blue-300">Email de Relance</span>
                            </div>
                            <a
                              href={gmailUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold transition-colors"
                            >
                              <Mail className="h-3 w-3" />
                              Envoyer par Gmail ↗
                            </a>
                          </div>
                          {/* Subject */}
                          {subject && (
                            <div className="px-4 py-2 border-b border-blue-500/10 bg-blue-950/5">
                              <span className="text-[10px] text-zinc-500 uppercase font-semibold">Sujet : </span>
                              <span className="text-xs font-semibold text-zinc-200">{subject}</span>
                            </div>
                          )}
                          {/* Body */}
                          <div className="px-4 py-3">
                            <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{body || generatedDraft.email}</p>
                          </div>
                        </div>

                        {/* WhatsApp Draft Card */}
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 overflow-hidden">
                          {/* WhatsApp header */}
                          <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-950/20 border-b border-emerald-500/15">
                            <div className="flex items-center gap-2">
                              <Phone className="h-3.5 w-3.5 text-emerald-400" />
                              <span className="text-xs font-bold text-emerald-300">Message WhatsApp</span>
                            </div>
                            <a
                              href={waUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition-colors"
                            >
                              <Phone className="h-3 w-3" />
                              Envoyer WhatsApp ↗
                            </a>
                          </div>
                          {/* Message */}
                          <div className="px-4 py-3">
                            <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{generatedDraft.whatsapp}</p>
                          </div>
                        </div>
                      </div>
                    )
                  })()}


                  {driveLink && (
                    <div className="p-4 rounded-xl border border-emerald-900/30 bg-emerald-950/15 animate-fadeIn flex flex-col gap-2">
                      <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                        <CheckCircle className="h-4 w-4 text-emerald-400" />
                        Dossier Drive Client Initialisé
                      </h4>
                      <p className="text-xs text-zinc-300">
                        La structure standardisée a été créée pour <strong>Client - {selectedLead.company}</strong>.
                      </p>
                      <a
                        href={driveLink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-400 font-semibold hover:underline block mt-1"
                      >
                        Ouvrir le dossier Drive ↗
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
