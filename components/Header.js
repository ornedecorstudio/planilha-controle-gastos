'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Plus, LayoutDashboard, CreditCard, FileText, RefreshCw, Upload } from 'lucide-react'

export default function Header() {
  const pathname = usePathname()

  const links = [
    { href: '/', label: 'Dashboard', mobileLabel: 'Inicio', icon: LayoutDashboard },
    { href: '/faturas', label: 'Faturas', mobileLabel: 'Faturas', icon: CreditCard },
    { href: '/upload', label: 'Upload', mobileLabel: 'Importar', icon: Upload, isAction: true },
    { href: '/extratos', label: 'Extratos', mobileLabel: 'Extratos', icon: FileText },
    { href: '/reconciliacao', label: 'Reconciliacao', mobileLabel: 'Reconcil.', icon: RefreshCw },
  ]

  const desktopLinks = links.filter(l => !l.isAction)
  const isActive = (href) => pathname === href || (href !== '/' && pathname.startsWith(href))

  return (
    <>
      {/* Desktop + Mobile top header */}
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center gap-6 h-14">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2 shrink-0">
              <span className="text-[14px] font-semibold text-neutral-900 tracking-tight">
                ORNE
              </span>
              <span className="hidden sm:inline text-neutral-400 text-[12px] font-normal">
                Categorizador
              </span>
            </Link>

            {/* Separador */}
            <div className="hidden md:block w-px h-5 bg-neutral-200" />

            {/* Navegacao desktop */}
            <nav className="hidden md:flex items-center gap-1 flex-1">
              {desktopLinks.map(link => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`
                    px-3 py-1.5 text-[13px] transition-colors relative
                    ${isActive(link.href)
                      ? 'text-neutral-900 font-medium'
                      : 'text-neutral-500 hover:text-neutral-700'
                    }
                  `}
                >
                  {link.label}
                  {isActive(link.href) && (
                    <span className="absolute bottom-[-13px] left-0 right-0 h-[2px] bg-neutral-900" />
                  )}
                </Link>
              ))}
            </nav>

            {/* Acao principal desktop */}
            <Link
              href="/upload"
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 text-white text-[13px] font-medium rounded-md hover:bg-neutral-800 transition-colors ml-auto"
            >
              <Plus size={14} strokeWidth={1.5} />
              Nova fatura
            </Link>

            {/* Mobile: page title area */}
            <div className="md:hidden flex-1" />
          </div>
        </div>
      </header>

      {/* Mobile bottom navigation bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-neutral-200" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex items-center justify-around h-14">
          {links.map(link => {
            const Icon = link.icon
            const active = isActive(link.href)

            if (link.isAction) {
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex flex-col items-center justify-center -mt-4"
                >
                  <div className={`flex items-center justify-center w-12 h-12 rounded-full shadow-lg transition-transform active:scale-95 ${active ? 'bg-neutral-800' : 'bg-neutral-900'}`}>
                    <Icon size={20} strokeWidth={1.5} className="text-white" />
                  </div>
                  <span className={`text-[10px] mt-0.5 ${active ? 'text-neutral-900 font-medium' : 'text-neutral-500'}`}>
                    {link.mobileLabel}
                  </span>
                </Link>
              )
            }

            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex flex-col items-center justify-center min-w-[56px] py-1 transition-colors ${
                  active ? 'text-neutral-900' : 'text-neutral-400'
                }`}
              >
                <Icon size={20} strokeWidth={active ? 2 : 1.5} />
                <span className={`text-[10px] mt-0.5 ${active ? 'font-medium' : ''}`}>
                  {link.mobileLabel}
                </span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
