'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Header() {
  const pathname = usePathname()
  
  const links = [
    { href: '/', label: 'Dashboard' },
    { href: '/upload', label: 'Nova Fatura' },
    { href: '/faturas', label: 'Faturas' },
    { href: '/extratos', label: 'Extratos' },
  ]
  
  return (
    <header className="bg-gradient-to-r from-slate-800 to-slate-700 text-white">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-500 rounded-lg flex items-center justify-center font-bold text-xl">
              O
            </div>
            <div>
              <h1 className="text-xl font-bold">ORNE Categorizador</h1>
              <p className="text-slate-300 text-xs">Controle de Despesas PF/PJ</p>
            </div>
          </div>
          
          <nav className="flex gap-1">
            {links.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
                  ${pathname === link.href 
                    ? 'bg-amber-500 text-white' 
                    : 'text-slate-300 hover:bg-slate-600'
                  }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </header>
  )
}
