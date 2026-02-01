import './globals.css'

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
      <body>{children}</body>
    </html>
  )
}
