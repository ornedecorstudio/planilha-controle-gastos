import './globals.css'

export const metadata = {
  title: 'ORNE - Categorizador de Faturas',
  description: 'Categorização automática de faturas com IA',
}

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
