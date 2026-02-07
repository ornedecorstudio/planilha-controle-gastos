import './globals.css'
import Header from '@/components/Header'

export const metadata = {
  title: 'ORNE - Categorizador de Faturas',
  description: 'Categorização automática de faturas com IA',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
      </head>
      <body className="bg-neutral-50 min-h-screen flex flex-col">
        <Header />
        <main className="main-content flex-1 max-w-7xl w-full mx-auto px-4 py-4 md:py-6">
          {children}
        </main>
        <footer className="hidden md:block border-t border-neutral-200 bg-white">
          <div className="max-w-7xl mx-auto px-4 py-4 text-center text-sm text-neutral-400">
            ORNE Decor Studio - Sistema de Controle de Despesas
          </div>
        </footer>
      </body>
    </html>
  )
}
