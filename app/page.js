'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowUpRight, TrendingUp, TrendingDown, CreditCard, FileText, BarChart3, RefreshCw } from 'lucide-react'

// Cores pastéis para categorias - minimalista
const CATEGORY_COLORS = {
  'Marketing Digital': 'bg-blue-50 text-blue-700 border border-blue-200',
  'Pagamento Fornecedores': 'bg-violet-50 text-violet-700 border border-violet-200',
  'Logística': 'bg-cyan-50 text-cyan-700 border border-cyan-200',
  'Taxas Checkout': 'bg-amber-50 text-amber-700 border border-amber-200',
  'Compra de Câmbio': 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  'IA e Automação': 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  'Design/Ferramentas': 'bg-purple-50 text-purple-700 border border-purple-200',
  'Telefonia': 'bg-pink-50 text-pink-700 border border-pink-200',
  'ERP': 'bg-orange-50 text-orange-700 border border-orange-200',
  'Gestão': 'bg-teal-50 text-teal-700 border border-teal-200',
  'Viagem Trabalho': 'bg-sky-50 text-sky-700 border border-sky-200',
  'Outros PJ': 'bg-neutral-100 text-neutral-600 border border-neutral-200',
  'Outros': 'bg-neutral-100 text-neutral-600 border border-neutral-200',
  'Pessoal': 'bg-rose-50 text-rose-600 border border-rose-200',
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [faturas, setFaturas] = useState([])
  const [reembolsoData, setReembolsoData] = useState(null)
  const [resumo, setResumo] = useState({
    totalGeral: 0,
    totalPJ: 0,
    totalPF: 0,
    totalFaturas: 0,
    categorias: []
  })

  useEffect(() => {
    const carregarDados = async () => {
      try {
        const faturasRes = await fetch('/api/faturas')
        const faturasData = await faturasRes.json()
        const faturasLista = faturasData.faturas || []
        setFaturas(faturasLista)

        let totalGeral = 0
        let totalPJ = 0
        let totalPF = 0
        const categoriasMap = {}

        for (const fatura of faturasLista) {
          totalGeral += parseFloat(fatura.valor_total) || 0
          totalPJ += parseFloat(fatura.valor_pj) || 0
          totalPF += parseFloat(fatura.valor_pf) || 0
        }

        const transacoesRes = await fetch('/api/transacoes')
        const transacoesData = await transacoesRes.json()
        const transacoes = transacoesData.transacoes || []

        for (const t of transacoes) {
          if (t.tipo === 'PJ') {
            const cat = t.categoria || 'Outros PJ'
            categoriasMap[cat] = (categoriasMap[cat] || 0) + (parseFloat(t.valor) || 0)
          }
        }

        const categorias = Object.entries(categoriasMap)
          .map(([nome, valor]) => ({ nome, valor }))
          .sort((a, b) => b.valor - a.valor)

        setResumo({
          totalGeral,
          totalPJ,
          totalPF,
          totalFaturas: faturasLista.length,
          categorias
        })

        try {
          const reembolsoRes = await fetch('/api/reembolsos?tipo=todos')
          const reembolsoResult = await reembolsoRes.json()
          if (!reembolsoResult.error) {
            setReembolsoData(reembolsoResult.resumo)
          }
        } catch (err) {
          console.log('API de reembolsos não disponível')
        }

      } catch (err) {
        console.error('Erro ao carregar dados:', err)
      } finally {
        setLoading(false)
      }
    }

    carregarDados()
  }, [])

  const formatCurrency = (value) => {
    return (value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-neutral-300 border-t-neutral-900"></div>
      </div>
    )
  }

  const pendente = reembolsoData?.total_pendente || 0
  const reembolsado = reembolsoData?.total_reembolsado || 0

  return (
    <div className="space-y-8">
      {/* Titulo */}
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900">Dashboard</h1>
        <p className="text-neutral-500 mt-1">Visao geral das suas despesas</p>
      </div>

      {/* Cards de Metricas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Geral */}
        <div className="bg-white rounded-lg border border-neutral-200 p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-neutral-500">Total Geral</p>
            <CreditCard size={18} className="text-neutral-400" />
          </div>
          <p className="text-2xl font-semibold text-neutral-900 mt-2">
            R$ {formatCurrency(resumo.totalGeral)}
          </p>
          <p className="text-xs text-neutral-400 mt-1">{resumo.totalFaturas} faturas</p>
        </div>

        {/* Total PJ */}
        <div className="bg-white rounded-lg border border-neutral-200 p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-neutral-500">Total PJ</p>
            <TrendingUp size={18} className="text-emerald-500" />
          </div>
          <p className="text-2xl font-semibold text-emerald-600 mt-2">
            R$ {formatCurrency(resumo.totalPJ)}
          </p>
          <p className="text-xs text-neutral-400 mt-1">
            {resumo.totalGeral > 0 ? ((resumo.totalPJ / resumo.totalGeral) * 100).toFixed(1) : 0}% reembolsavel
          </p>
        </div>

        {/* Total PF */}
        <div className="bg-white rounded-lg border border-neutral-200 p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-neutral-500">Total PF</p>
            <TrendingDown size={18} className="text-rose-500" />
          </div>
          <p className="text-2xl font-semibold text-rose-600 mt-2">
            R$ {formatCurrency(resumo.totalPF)}
          </p>
          <p className="text-xs text-neutral-400 mt-1">
            {resumo.totalGeral > 0 ? ((resumo.totalPF / resumo.totalGeral) * 100).toFixed(1) : 0}% pessoal
          </p>
        </div>

        {/* Pendente de Reembolso */}
        <div className="bg-white rounded-lg border border-neutral-200 p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-neutral-500">Pendente</p>
            <RefreshCw size={18} className="text-amber-500" />
          </div>
          <p className="text-2xl font-semibold text-amber-600 mt-2">
            R$ {formatCurrency(pendente)}
          </p>
          {pendente > 0 && (
            <Link 
              href="/reconciliacao" 
              className="text-xs text-amber-600 hover:text-amber-700 mt-1 inline-flex items-center gap-1"
            >
              Reconciliar <ArrowUpRight size={12} />
            </Link>
          )}
        </div>
      </div>

      {/* Grid de Conteudo */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gastos por Categoria */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-neutral-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-neutral-900">Gastos PJ por Categoria</h2>
            <BarChart3 size={18} className="text-neutral-400" />
          </div>
          
          {resumo.categorias.length === 0 ? (
            <p className="text-neutral-500 text-sm py-8 text-center">
              Nenhuma transacao PJ cadastrada.
            </p>
          ) : (
            <div className="space-y-4">
              {resumo.categorias.slice(0, 8).map((cat, i) => (
                <div key={i} className="flex items-center gap-4">
                  <span className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap ${CATEGORY_COLORS[cat.nome] || 'bg-neutral-100 text-neutral-600'}`}>
                    {cat.nome}
                  </span>
                  <div className="flex-1 h-2 bg-neutral-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-neutral-900 rounded-full transition-all"
                      style={{ width: `${resumo.totalPJ > 0 ? (cat.valor / resumo.totalPJ) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="font-mono text-sm font-medium text-neutral-900 w-28 text-right">
                    R$ {formatCurrency(cat.valor)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Ultimas Faturas */}
        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-neutral-900">Ultimas Faturas</h2>
            <Link href="/faturas" className="text-sm text-neutral-500 hover:text-neutral-900 flex items-center gap-1">
              Ver todas <ArrowUpRight size={14} />
            </Link>
          </div>
          
          {faturas.length === 0 ? (
            <div className="text-center py-8">
              <FileText size={32} className="mx-auto text-neutral-300 mb-3" />
              <p className="text-neutral-500 text-sm mb-4">Nenhuma fatura cadastrada.</p>
              <Link 
                href="/upload" 
                className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded-md hover:bg-neutral-800"
              >
                Importar fatura
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {faturas.slice(0, 5).map(f => (
                <Link
                  key={f.id}
                  href={`/faturas/${f.id}`}
                  className="block p-3 rounded-lg border border-neutral-100 hover:border-neutral-200 hover:bg-neutral-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-neutral-900 text-sm">{f.cartoes?.nome || 'Cartao'}</p>
                      <p className="text-xs text-neutral-400">
                        {f.mes_referencia ? new Date(f.mes_referencia).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : '-'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm font-medium text-neutral-900">
                        R$ {formatCurrency(f.valor_total)}
                      </p>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        f.status === 'reembolsado' 
                          ? 'bg-emerald-50 text-emerald-600' 
                          : f.status === 'pago' 
                            ? 'bg-blue-50 text-blue-600' 
                            : 'bg-amber-50 text-amber-600'
                      }`}>
                        {f.status === 'reembolsado' ? 'Reembolsado' : f.status === 'pago' ? 'Pago' : 'Pendente'}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Acoes Rapidas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link
          href="/upload"
          className="flex items-center gap-4 p-5 bg-white rounded-lg border border-neutral-200 hover:border-neutral-300 hover:shadow-sm transition-all group"
        >
          <div className="w-10 h-10 rounded-lg bg-neutral-100 flex items-center justify-center group-hover:bg-neutral-900 group-hover:text-white transition-colors">
            <FileText size={20} />
          </div>
          <div>
            <h3 className="font-medium text-neutral-900">Importar fatura</h3>
            <p className="text-sm text-neutral-500">PDF ou OFX de cartao</p>
          </div>
        </Link>

        <Link
          href="/extratos"
          className="flex items-center gap-4 p-5 bg-white rounded-lg border border-neutral-200 hover:border-neutral-300 hover:shadow-sm transition-all group"
        >
          <div className="w-10 h-10 rounded-lg bg-neutral-100 flex items-center justify-center group-hover:bg-neutral-900 group-hover:text-white transition-colors">
            <BarChart3 size={20} />
          </div>
          <div>
            <h3 className="font-medium text-neutral-900">Importar extrato</h3>
            <p className="text-sm text-neutral-500">OFX bancario</p>
          </div>
        </Link>

        <Link
          href="/reconciliacao"
          className="flex items-center gap-4 p-5 bg-white rounded-lg border border-neutral-200 hover:border-neutral-300 hover:shadow-sm transition-all group"
        >
          <div className="w-10 h-10 rounded-lg bg-neutral-100 flex items-center justify-center group-hover:bg-neutral-900 group-hover:text-white transition-colors">
            <RefreshCw size={20} />
          </div>
          <div>
            <h3 className="font-medium text-neutral-900">Reconciliacao</h3>
            <p className="text-sm text-neutral-500">Vincular reembolsos</p>
          </div>
        </Link>
      </div>
    </div>
  )
}
