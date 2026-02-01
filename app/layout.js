import './globals.css'
import Header from '@/components/Header'

export const metadata = {
  title: 'ORNE - Categorizador de Faturas',
  description: 'Categorizacao automatica de faturas com IA',
}

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
      </head>
      <body className="bg-gray-50 min-h-screen">
        <Header />
        <main className="max-w-7xl mx-auto px-4 py-6">
          {children}
        </main>
        <footer className="text-center py-4 text-sm text-slate-400">
          ORNE Decor Studio - Sistema de Controle de Despesas PF/PJ
        </footer>
      </body>
    </html>
  )
}
