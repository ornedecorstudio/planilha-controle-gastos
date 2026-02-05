'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Plus } from 'lucide-react'

export default function Header() {
  const pathname = usePathname()
  
  const links = [
    { href: '/', label: 'Dashboard' },
    { href: '/faturas', label: 'Faturas' },
    { href: '/extratos', label: 'Extratos' },
    { href: '/reconciliacao', label: 'Reconciliacao' },
  ]
  
  return (
    <header className="bg-white border-b border-neutral-200">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl font-semibold text-neutral-900 tracking-tight">
              ORNE
            </span>
            <span className="hidden sm:inline text-neutral-400 text-sm font-normal">
              Categorizador
            </span>
          </Link>
          
          {/* Navegacao */}
          <nav className="hidden md:flex items-center gap-1">
            {links.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className={`
                  px-3 py-2 text-sm font-medium rounded-md transition-colors
                  ${pathname === link.href 
                    ? 'text-neutral-900 bg-neutral-100' 
                    : 'text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50'
                  }
                `}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          
          {/* Acao principal */}
          <Link
            href="/upload"
            className="flex items-center gap-2 px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded-md hover:bg-neutral-800 transition-colors"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">Nova fatura</span>
          </Link>
        </div>
        
        {/* Navegacao mobile */}
        <nav className="md:hidden flex items-center gap-1 pb-3 -mx-1 overflow-x-auto">
          {links.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={`
                px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors
                ${pathname === link.href 
                  ? 'text-neutral-900 bg-neutral-100' 
                  : 'text-neutral-500 hover:text-neutral-900'
                }
              `}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}
