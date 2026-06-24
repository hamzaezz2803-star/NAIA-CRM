import React from 'react'
import { getCurrentUser } from '@/lib/dal'
import { Sidebar } from '@/components/dashboard/sidebar'
import { Header } from '@/components/dashboard/header'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-50 font-sans">
      {/* Sidebar Navigation */}
      <Sidebar user={user} />

      {/* Main Panel */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header Control */}
        <Header />

        {/* Content Viewer */}
        <main className="flex-1 overflow-y-auto bg-zinc-950 p-6 md:p-8 relative">
          {/* Decorative subtle background glowing elements */}
          <div className="absolute top-1/4 right-1/4 w-[30%] h-[30%] rounded-full bg-blue-500/5 blur-[100px] pointer-events-none" />
          
          <div className="w-full space-y-8 relative">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
