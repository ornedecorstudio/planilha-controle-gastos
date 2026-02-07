'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowUpRight, CreditCard, FileText, BarChart3, RefreshCw, ArrowRight, Building2, User } from 'lucide-react'
import MonthPicker from '@/components/MonthPicker'

// Cores para categorias PJ
const CATEGORY_COLORS_PJ = {
  'Marketing Digital': 'bg-blue-50 text-blue-700',
  'Pagamento Fornecedores': 'bg-violet-50 text-violet-700',
  'Logística': 'bg-cyan-50 text-cyan-700',
  'Taxas Checkout': 'bg-amber-50 text-amber-700',
  'Compra de Câmbio': 'bg-emerald-50 text-emerald-700',
  'IA e Automação': 'bg-indigo-50 text-indigo-700',
  'Design/Ferramentas': 'bg-purple-50 text-purple-700',
  'Telefonia': 'bg-pink-50 text-pink-700',
  'ERP': 'bg-orange-50 text-orange-700',
  'Gestão': 'bg-teal-50 text-teal-700',
  'Viagem Trabalho': 'bg-sky-50 text-sky-700',
  'IOF': 'bg-red-50 text-red-700',
  'Outros PJ': 'bg-neutral-100 text-neutral-600',
  'Outros': 'bg-neutral-100 text-neutral-600',
}

// Cores para categorias PF
const CATEGORY_COLORS_PF = {
  'Alimentação': 'bg-rose-50 text-rose-700',
  'Saúde/Farmácia': 'bg-red-50 text-red-700',
  'Moda': 'bg-pink-50 text-pink-700',
  'Supermercado': 'bg-orange-50 text-orange-700',
  'Transporte': 'bg-amber-50 text-amber-700',
  'Viagens': 'bg-yellow-50 text-yellow-700',
  'Entretenimento': 'bg-fuchsia-50 text-fuchsia-700',
  'Lojas': 'bg-purple-50 text-purple-700',
  'Serviços Pessoais': 'bg-violet-50 text-violet-700',
  'Tarifas Bancárias': 'bg-neutral-100 text-neutral-600',
  'Pessoal': 'bg-rose-50 text-rose-600',
  'Outros PF': 'bg-neutral-100 text-neutral-600',
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [faturas, setFaturas] = useState([])
  const [reembolsoData, setReembolsoData] = useState(null)
  const [mesSelecionado, setMesSelecionado] = useState(null)
  const [resumo, setResumo] = useState({
    totalGeral: 0,
    totalPJ: 0,
    totalPF: 0,
    totalFaturas: 0,
    categoriasPJ: [],
    categoriasPF: []
  })

  useEffect(() => {
    const carregarDados = async () => {
      setLoading(true)
      try {
        let faturasUrl = '/api/faturas'
        if (mesSelecionado) {
          faturasUrl += `?mes_referencia=${mesSelecionado}`
        }
        const faturasRes = await fetch(faturasUrl)
        const faturasData = await faturasRes.json()
        const faturasLista = faturasData.faturas || []
        setFaturas(faturasLista)

        let totalGeral = 0
        let totalPJ = 0
        let totalPF = 0

        for (const fatura of faturasLista) {
          totalGeral += parseFloat(fatura.valor_total) || 0
          totalPJ += parseFloat(fatura.valor_pj) || 0
          totalPF += parseFloat(fatura.valor_pf) || 0
        }

        let transacoesUrl = '/api/transacoes?all=true'
        if (mesSelecionado) {
          transacoesUrl += `&mes_referencia=${mesSelecionado}`
        }
        const transacoesRes = await fetch(transacoesUrl)
        const transacoesData = await transacoesRes.json()
        const transacoes = transacoesData.transacoes || []

        const categoriasPJMap = {}
        const categoriasPFMap = {}

        for (const t of transacoes) {
          const valor = parseFloat(t.valor) || 0
          const cat = t.categoria || 'Outros'

          if (t.tipo === 'PJ') {
            categoriasPJMap[cat] = (categoriasPJMap[cat] || 0) + valor
          } else {
            categoriasPFMap[cat] = (categoriasPFMap[cat] || 0) + valor
          }
        }

        const categoriasPJ = Object.entries(categoriasPJMap)
          .map(([nome, valor]) => ({ nome, valor }))
          .sort((a, b) => b.valor - a.valor)

        const categoriasPF = Object.entries(categoriasPFMap)
          .map(([nome, valor]) => ({ nome, valor }))
          .sort((a, b) => b.valor - a.valor)

        setResumo({
          totalGeral,
          totalPJ,
          totalPF,
          totalFaturas: faturasLista.length,
          categoriasPJ,
          categoriasPF
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
  }, [mesSelecionado])

  const formatCurrency = (value) => {
    return (value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const handleMesChange = (valor) => {
    setMesSelecionado(valor || null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-neutral-300 border-t-neutral-900"></div>
      </div>
    )
  }

  const pendente = reembolsoData?.total_pendente || 0
  const reembolsado = reembolsoData?.total_reembolsado || 0

  return (
    <div className="space-y-6">
      {/* Cabecalho */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-page-title text-neutral-900">Dashboard</h1>
          <p className="text-body text-neutral-500 mt-0.5">Visão geral das suas despesas</p>
        </div>
        <MonthPicker
          onChange={handleMesChange}
          placeholder="Todos os meses"
          allowClear={true}
          label={null}
        />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {/* Total Geral */}
        <div className="bg-white rounded-lg border border-neutral-200 p-3 md:p-4">
          <div className="flex items-center justify-between">
            <p className="text-label text-neutral-500">Total Geral</p>
            <CreditCard size={16} strokeWidth={1.5} className="text-neutral-400 hidden sm:block" />
          </div>
          <p className="text-[16px] md:text-kpi font-semibold text-neutral-900 mt-1">
            R$ {formatCurrency(resumo.totalGeral)}
          </p>
          <p className="text-label text-neutral-400 mt-0.5">{resumo.totalFaturas} faturas</p>
        </div>

        {/* Total PJ */}
        <div className="bg-white rounded-lg border border-neutral-200 p-3 md:p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <p className="text-label text-neutral-500">Gastos PJ</p>
            </div>
            <Building2 size={16} strokeWidth={1.5} className="text-neutral-400 hidden sm:block" />
          </div>
          <p className="text-[16px] md:text-kpi font-semibold text-neutral-900 mt-1">
            R$ {formatCurrency(resumo.totalPJ)}
          </p>
          <p className="text-label text-neutral-400 mt-0.5">
            {resumo.totalGeral > 0 ? ((resumo.totalPJ / resumo.totalGeral) * 100).toFixed(1) : 0}% reembolsável
          </p>
        </div>

        {/* Total PF */}
        <div className="bg-white rounded-lg border border-neutral-200 p-3 md:p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              <p className="text-label text-neutral-500">Gastos PF</p>
            </div>
            <User size={16} strokeWidth={1.5} className="text-neutral-400 hidden sm:block" />
          </div>
          <p className="text-[16px] md:text-kpi font-semibold text-neutral-900 mt-1">
            R$ {formatCurrency(resumo.totalPF)}
          </p>
          <p className="text-label text-neutral-400 mt-0.5">
            {resumo.totalGeral > 0 ? ((resumo.totalPF / resumo.totalGeral) * 100).toFixed(1) : 0}% pessoal
          </p>
        </div>

        {/* Pendente */}
        <div className="bg-white rounded-lg border border-neutral-200 p-3 md:p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              <p className="text-label text-neutral-500">Pendente</p>
            </div>
            <RefreshCw size={16} strokeWidth={1.5} className="text-neutral-400 hidden sm:block" />
          </div>
          <p className="text-[16px] md:text-kpi font-semibold text-neutral-900 mt-1">
            R$ {formatCurrency(pendente)}
          </p>
          {pendente > 0 && (
            <Link
              href="/reconciliacao"
              className="text-label text-neutral-500 hover:text-neutral-900 mt-0.5 inline-flex items-center gap-1"
            >
              Reconciliar <ArrowUpRight size={10} strokeWidth={1.5} />
            </Link>
          )}
        </div>
      </div>

      {/* Fluxo entre Contas */}
      <div className="bg-white rounded-lg border border-neutral-200 p-3 md:p-4">
        <h2 className="text-section-title text-neutral-900 mb-3">Fluxo entre Contas</h2>
        <div className="flex md:grid md:grid-cols-3 gap-3 overflow-x-auto scrollbar-hide -mx-3 px-3 md:mx-0 md:px-0">
          <div className="p-3 bg-white rounded-lg border border-neutral-200 min-w-[200px] md:min-w-0 shrink-0 md:shrink">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Building2 size={14} strokeWidth={1.5} className="text-neutral-400" />
              <ArrowRight size={12} strokeWidth={1.5} className="text-neutral-300" />
              <User size={14} strokeWidth={1.5} className="text-neutral-400" />
            </div>
            <p className="text-label text-neutral-500">PJ → PF (Reembolsos)</p>
            <p className="text-[16px] md:text-kpi font-semibold text-neutral-900">R$ {formatCurrency(reembolsado)}</p>
          </div>

          <div className="p-3 bg-white rounded-lg border border-neutral-200 min-w-[200px] md:min-w-0 shrink-0 md:shrink">
            <div className="flex items-center gap-1.5 mb-1.5">
              <CreditCard size={14} strokeWidth={1.5} className="text-neutral-400" />
              <span className="text-[10px] bg-neutral-100 text-neutral-600 px-1 py-0.5 rounded">PF</span>
            </div>
            <p className="text-label text-neutral-500">Gastos PJ em Cartões PF</p>
            <p className="text-[16px] md:text-kpi font-semibold text-neutral-900">R$ {formatCurrency(resumo.totalPJ)}</p>
          </div>

          <div className="p-3 bg-white rounded-lg border border-neutral-200 min-w-[200px] md:min-w-0 shrink-0 md:shrink">
            <div className="flex items-center gap-1.5 mb-1.5">
              <RefreshCw size={14} strokeWidth={1.5} className="text-neutral-400" />
            </div>
            <p className="text-label text-neutral-500">Status Reconciliação</p>
            <p className="text-[16px] md:text-kpi font-semibold text-neutral-900">
              {pendente === 0 && resumo.totalPJ > 0 ? 'Conciliado' : pendente > 0 ? 'Pendente' : 'Sem dados'}
            </p>
          </div>
        </div>
      </div>

      {/* Categorias */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* PJ */}
        <div className="bg-white rounded-lg border border-neutral-200 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-section-title text-neutral-900">Gastos PJ por Categoria</h2>
            <span className="text-label text-neutral-400">Reembolsáveis</span>
          </div>

          {resumo.categoriasPJ.length === 0 ? (
            <p className="text-neutral-500 text-[13px] py-6 text-center">
              Nenhuma transação PJ cadastrada.
            </p>
          ) : (
            <div className="space-y-2">
              {resumo.categoriasPJ.slice(0, 10).map((cat, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] md:text-[11px] font-medium whitespace-nowrap min-w-[80px] md:min-w-[100px] text-center ${CATEGORY_COLORS_PJ[cat.nome] || 'bg-neutral-100 text-neutral-600'}`}>
                    {cat.nome}
                  </span>
                  <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{ width: `${resumo.totalPJ > 0 ? (cat.valor / resumo.totalPJ) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="font-mono text-[12px] md:text-[13px] font-medium text-neutral-900 min-w-[80px] md:w-24 text-right">
                    R$ {formatCurrency(cat.valor)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* PF */}
        <div className="bg-white rounded-lg border border-neutral-200 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-section-title text-neutral-900">Gastos PF por Categoria</h2>
            <span className="text-label text-neutral-400">Não reembolsáveis</span>
          </div>

          {resumo.categoriasPF.length === 0 ? (
            <p className="text-neutral-500 text-[13px] py-6 text-center">
              Nenhuma transação PF cadastrada.
            </p>
          ) : (
            <div className="space-y-2">
              {resumo.categoriasPF.slice(0, 10).map((cat, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] md:text-[11px] font-medium whitespace-nowrap min-w-[80px] md:min-w-[100px] text-center ${CATEGORY_COLORS_PF[cat.nome] || 'bg-neutral-100 text-neutral-600'}`}>
                    {cat.nome}
                  </span>
                  <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-rose-500 rounded-full transition-all"
                      style={{ width: `${resumo.totalPF > 0 ? (cat.valor / resumo.totalPF) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="font-mono text-[12px] md:text-[13px] font-medium text-neutral-900 min-w-[80px] md:w-24 text-right">
                    R$ {formatCurrency(cat.valor)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Últimas Faturas */}
      <div className="bg-white rounded-lg border border-neutral-200 p-3 md:p-4">
        <div className="flex items-center justify-between mb-3 md:mb-4">
          <h2 className="text-section-title text-neutral-900">Últimas Faturas</h2>
          <Link href="/faturas" className="text-label text-neutral-500 hover:text-neutral-900 flex items-center gap-1">
            Ver todas <ArrowUpRight size={10} strokeWidth={1.5} />
          </Link>
        </div>

        {faturas.length === 0 ? (
          <div className="text-center py-6">
            <FileText size={24} strokeWidth={1.5} className="mx-auto text-neutral-300 mb-2" />
            <p className="text-neutral-500 text-[13px] mb-3">Nenhuma fatura cadastrada.</p>
            <Link
              href="/upload"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 text-white text-[13px] font-medium rounded-lg hover:bg-neutral-800"
            >
              Importar fatura
            </Link>
          </div>
        ) : (
          <>
            {/* Mobile card view */}
            <div className="mobile-cards space-y-2">
              {faturas.slice(0, 5).map(f => (
                <Link key={f.id} href={`/faturas/${f.id}`} className="block p-3 rounded-lg border border-neutral-100 hover:bg-neutral-50 active:bg-neutral-100 transition-colors">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[13px] font-medium text-neutral-900">{f.cartoes?.nome || 'Cartao'}</span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${
                      f.status === 'reembolsado'
                        ? 'bg-emerald-100 text-emerald-700'
                        : f.status === 'pago'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-amber-100 text-amber-700'
                    }`}>
                      {f.status === 'reembolsado' ? 'Reembolsado' : f.status === 'pago' ? 'Pago' : 'Pendente'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-neutral-500">
                      {f.mes_referencia ? new Date(f.mes_referencia).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : '-'}
                    </span>
                    <span className="font-mono text-[14px] font-medium text-neutral-900">
                      R$ {formatCurrency(f.valor_total)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[11px] text-emerald-600">PJ: R$ {formatCurrency(f.valor_pj)}</span>
                    <span className="text-[11px] text-rose-600">PF: R$ {formatCurrency(f.valor_pf)}</span>
                  </div>
                </Link>
              ))}
            </div>

            {/* Desktop table view */}
            <div className="desktop-table overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-neutral-100">
                    <th className="text-left text-[11px] uppercase tracking-wider font-medium text-neutral-400 pb-2.5">Cartao</th>
                    <th className="text-left text-[11px] uppercase tracking-wider font-medium text-neutral-400 pb-2.5">Mes</th>
                    <th className="text-right text-[11px] uppercase tracking-wider font-medium text-neutral-400 pb-2.5">Total</th>
                    <th className="text-right text-[11px] uppercase tracking-wider font-medium text-neutral-400 pb-2.5">PJ</th>
                    <th className="text-right text-[11px] uppercase tracking-wider font-medium text-neutral-400 pb-2.5">PF</th>
                    <th className="text-center text-[11px] uppercase tracking-wider font-medium text-neutral-400 pb-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {faturas.slice(0, 5).map(f => (
                    <tr key={f.id} className="border-b border-neutral-50 hover:bg-neutral-50">
                      <td className="py-2.5">
                        <Link href={`/faturas/${f.id}`} className="text-[13px] font-medium text-neutral-900 hover:text-neutral-700">
                          {f.cartoes?.nome || 'Cartao'}
                        </Link>
                      </td>
                      <td className="py-2.5 text-[13px] text-neutral-500">
                        {f.mes_referencia ? new Date(f.mes_referencia).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : '-'}
                      </td>
                      <td className="py-2.5 text-right font-mono text-[13px] text-neutral-900">
                        R$ {formatCurrency(f.valor_total)}
                      </td>
                      <td className="py-2.5 text-right font-mono text-[13px] text-neutral-600">
                        R$ {formatCurrency(f.valor_pj)}
                      </td>
                      <td className="py-2.5 text-right font-mono text-[13px] text-neutral-600">
                        R$ {formatCurrency(f.valor_pf)}
                      </td>
                      <td className="py-2.5 text-center">
                        <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${
                          f.status === 'reembolsado'
                            ? 'bg-emerald-100 text-emerald-700'
                            : f.status === 'pago'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-amber-100 text-amber-700'
                        }`}>
                          {f.status === 'reembolsado' ? 'Reembolsado' : f.status === 'pago' ? 'Pago' : 'Pendente'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Acoes Rapidas */}
      <div className="grid grid-cols-3 gap-2 md:gap-3">
        <Link
          href="/upload"
          className="flex flex-col md:flex-row items-center md:items-center gap-2 md:gap-3 p-3 md:p-4 bg-white rounded-lg border border-neutral-200 hover:border-neutral-300 active:bg-neutral-50 transition-all group text-center md:text-left"
        >
          <div className="w-10 h-10 md:w-8 md:h-8 rounded-lg bg-neutral-100 flex items-center justify-center group-hover:bg-neutral-900 group-hover:text-white transition-colors shrink-0">
            <FileText size={18} strokeWidth={1.5} className="md:w-4 md:h-4" />
          </div>
          <div>
            <h3 className="text-[12px] md:text-[13px] font-medium text-neutral-900">Importar Fatura</h3>
            <p className="text-[11px] md:text-[12px] text-neutral-500 hidden sm:block">PDF ou OFX</p>
          </div>
        </Link>

        <Link
          href="/extratos"
          className="flex flex-col md:flex-row items-center md:items-center gap-2 md:gap-3 p-3 md:p-4 bg-white rounded-lg border border-neutral-200 hover:border-neutral-300 active:bg-neutral-50 transition-all group text-center md:text-left"
        >
          <div className="w-10 h-10 md:w-8 md:h-8 rounded-lg bg-neutral-100 flex items-center justify-center group-hover:bg-neutral-900 group-hover:text-white transition-colors shrink-0">
            <BarChart3 size={18} strokeWidth={1.5} className="md:w-4 md:h-4" />
          </div>
          <div>
            <h3 className="text-[12px] md:text-[13px] font-medium text-neutral-900">Importar Extrato</h3>
            <p className="text-[11px] md:text-[12px] text-neutral-500 hidden sm:block">OFX bancario</p>
          </div>
        </Link>

        <Link
          href="/reconciliacao"
          className="flex flex-col md:flex-row items-center md:items-center gap-2 md:gap-3 p-3 md:p-4 bg-white rounded-lg border border-neutral-200 hover:border-neutral-300 active:bg-neutral-50 transition-all group text-center md:text-left"
        >
          <div className="w-10 h-10 md:w-8 md:h-8 rounded-lg bg-neutral-100 flex items-center justify-center group-hover:bg-neutral-900 group-hover:text-white transition-colors shrink-0">
            <RefreshCw size={18} strokeWidth={1.5} className="md:w-4 md:h-4" />
          </div>
          <div>
            <h3 className="text-[12px] md:text-[13px] font-medium text-neutral-900">Reconciliacao</h3>
            <p className="text-[11px] md:text-[12px] text-neutral-500 hidden sm:block">Vincular reembolsos</p>
          </div>
        </Link>
      </div>
    </div>
  )
}
