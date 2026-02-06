'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowUpRight, TrendingUp, TrendingDown, CreditCard, FileText, BarChart3, RefreshCw, ArrowRight, Building2, User, Calendar } from 'lucide-react'
import MonthPicker from '@/components/MonthPicker'

// Cores para categorias PJ - tons de verde/azul (empresarial)
const CATEGORY_COLORS_PJ = {
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
}

// Cores para categorias PF - tons de rosa/vermelho (pessoal)
const CATEGORY_COLORS_PF = {
  'Alimentação': 'bg-rose-50 text-rose-700 border border-rose-200',
  'Saúde/Farmácia': 'bg-red-50 text-red-700 border border-red-200',
  'Moda': 'bg-pink-50 text-pink-700 border border-pink-200',
  'Supermercado': 'bg-orange-50 text-orange-700 border border-orange-200',
  'Transporte': 'bg-amber-50 text-amber-700 border border-amber-200',
  'Viagens': 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  'Entretenimento': 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200',
  'Lojas': 'bg-purple-50 text-purple-700 border border-purple-200',
  'Serviços Pessoais': 'bg-violet-50 text-violet-700 border border-violet-200',
  'Tarifas Bancárias': 'bg-neutral-100 text-neutral-600 border border-neutral-200',
  'Pessoal': 'bg-rose-50 text-rose-600 border border-rose-200',
  'Outros PF': 'bg-neutral-100 text-neutral-600 border border-neutral-200',
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [faturas, setFaturas] = useState([])
  const [reembolsoData, setReembolsoData] = useState(null)
  const [mesSelecionado, setMesSelecionado] = useState(null) // null = todos os meses
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
        // Carrega faturas com filtro de mês se selecionado
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

        // Carrega TODAS as transações para cálculo correto de categorias
        let transacoesUrl = '/api/transacoes?all=true'
        if (mesSelecionado) {
          transacoesUrl += `&mes_referencia=${mesSelecionado}`
        }
        const transacoesRes = await fetch(transacoesUrl)
        const transacoesData = await transacoesRes.json()
        const transacoes = transacoesData.transacoes || []

        // Separa categorias PJ e PF
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

        // Carrega dados de reembolso
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

  const handleMesChange = (mes, ano) => {
    if (mes && ano) {
      const mesFormatado = `${ano}-${String(mes).padStart(2, '0')}`
      setMesSelecionado(mesFormatado)
    } else {
      setMesSelecionado(null)
    }
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
  const totalMovimentacoes = reembolsoData?.total_movimentacoes || 0

  return (
    <div className="space-y-8">
      {/* Cabeçalho com Filtro de Período */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Dashboard</h1>
          <p className="text-neutral-500 mt-1">Visão geral das suas despesas</p>
        </div>
        <div className="flex items-center gap-3">
          <Calendar size={18} className="text-neutral-400" />
          <MonthPicker
            onChange={handleMesChange}
            placeholder="Todos os meses"
            allowClear={true}
          />
        </div>
      </div>

      {/* Cards de Métricas */}
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

        {/* Total PJ - Reembolsável */}
        <div className="bg-white rounded-lg border border-emerald-200 p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-emerald-600">Gastos PJ</p>
            <Building2 size={18} className="text-emerald-500" />
          </div>
          <p className="text-2xl font-semibold text-emerald-600 mt-2">
            R$ {formatCurrency(resumo.totalPJ)}
          </p>
          <p className="text-xs text-emerald-500 mt-1">
            {resumo.totalGeral > 0 ? ((resumo.totalPJ / resumo.totalGeral) * 100).toFixed(1) : 0}% reembolsável
          </p>
        </div>

        {/* Total PF - Pessoal */}
        <div className="bg-white rounded-lg border border-rose-200 p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-rose-600">Gastos PF</p>
            <User size={18} className="text-rose-500" />
          </div>
          <p className="text-2xl font-semibold text-rose-600 mt-2">
            R$ {formatCurrency(resumo.totalPF)}
          </p>
          <p className="text-xs text-rose-500 mt-1">
            {resumo.totalGeral > 0 ? ((resumo.totalPF / resumo.totalGeral) * 100).toFixed(1) : 0}% pessoal
          </p>
        </div>

        {/* Pendente de Reembolso */}
        <div className="bg-white rounded-lg border border-amber-200 p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-amber-600">Pendente</p>
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

      {/* Fluxo entre Contas PJ ↔ PF */}
      <div className="bg-white rounded-lg border border-neutral-200 p-6">
        <h2 className="text-lg font-semibold text-neutral-900 mb-4">Fluxo entre Contas</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* PJ → PF (Reembolsos) */}
          <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-200">
            <div className="flex items-center gap-2 mb-2">
              <Building2 size={16} className="text-emerald-600" />
              <ArrowRight size={14} className="text-emerald-500" />
              <User size={16} className="text-emerald-600" />
            </div>
            <p className="text-sm text-emerald-600 font-medium">PJ → PF (Reembolsos)</p>
            <p className="text-xl font-semibold text-emerald-700">R$ {formatCurrency(reembolsado)}</p>
          </div>

          {/* Gastos PJ em Cartões PF */}
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center gap-2 mb-2">
              <CreditCard size={16} className="text-blue-600" />
              <span className="text-xs bg-blue-200 text-blue-700 px-1.5 py-0.5 rounded">PF</span>
            </div>
            <p className="text-sm text-blue-600 font-medium">Gastos PJ em Cartões PF</p>
            <p className="text-xl font-semibold text-blue-700">R$ {formatCurrency(resumo.totalPJ)}</p>
          </div>

          {/* Status da Reconciliação */}
          <div className={`p-4 rounded-lg border ${
            pendente === 0 && resumo.totalPJ > 0
              ? 'bg-emerald-50 border-emerald-200'
              : pendente > 0
                ? 'bg-amber-50 border-amber-200'
                : 'bg-neutral-50 border-neutral-200'
          }`}>
            <div className="flex items-center gap-2 mb-2">
              <RefreshCw size={16} className={
                pendente === 0 && resumo.totalPJ > 0
                  ? 'text-emerald-600'
                  : pendente > 0
                    ? 'text-amber-600'
                    : 'text-neutral-500'
              } />
            </div>
            <p className={`text-sm font-medium ${
              pendente === 0 && resumo.totalPJ > 0
                ? 'text-emerald-600'
                : pendente > 0
                  ? 'text-amber-600'
                  : 'text-neutral-500'
            }`}>Status Reconciliação</p>
            <p className={`text-xl font-semibold ${
              pendente === 0 && resumo.totalPJ > 0
                ? 'text-emerald-700'
                : pendente > 0
                  ? 'text-amber-700'
                  : 'text-neutral-600'
            }`}>
              {pendente === 0 && resumo.totalPJ > 0 ? 'Conciliado' : pendente > 0 ? 'Pendente' : 'Sem dados'}
            </p>
          </div>
        </div>
      </div>

      {/* Grid de Categorias */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gastos PJ por Categoria */}
        <div className="bg-white rounded-lg border border-emerald-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Building2 size={18} className="text-emerald-600" />
              <h2 className="text-lg font-semibold text-neutral-900">Gastos PJ por Categoria</h2>
            </div>
            <span className="text-sm text-emerald-600 font-medium">Reembolsáveis</span>
          </div>

          {resumo.categoriasPJ.length === 0 ? (
            <p className="text-neutral-500 text-sm py-8 text-center">
              Nenhuma transação PJ cadastrada.
            </p>
          ) : (
            <div className="space-y-3">
              {resumo.categoriasPJ.slice(0, 10).map((cat, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap min-w-[120px] text-center ${CATEGORY_COLORS_PJ[cat.nome] || 'bg-neutral-100 text-neutral-600 border border-neutral-200'}`}>
                    {cat.nome}
                  </span>
                  <div className="flex-1 h-2 bg-neutral-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{ width: `${resumo.totalPJ > 0 ? (cat.valor / resumo.totalPJ) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="font-mono text-sm font-medium text-neutral-900 w-24 text-right">
                    R$ {formatCurrency(cat.valor)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Gastos PF por Categoria */}
        <div className="bg-white rounded-lg border border-rose-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <User size={18} className="text-rose-600" />
              <h2 className="text-lg font-semibold text-neutral-900">Gastos PF por Categoria</h2>
            </div>
            <span className="text-sm text-rose-600 font-medium">Não reembolsáveis</span>
          </div>

          {resumo.categoriasPF.length === 0 ? (
            <p className="text-neutral-500 text-sm py-8 text-center">
              Nenhuma transação PF cadastrada.
            </p>
          ) : (
            <div className="space-y-3">
              {resumo.categoriasPF.slice(0, 10).map((cat, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap min-w-[120px] text-center ${CATEGORY_COLORS_PF[cat.nome] || 'bg-neutral-100 text-neutral-600 border border-neutral-200'}`}>
                    {cat.nome}
                  </span>
                  <div className="flex-1 h-2 bg-neutral-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-rose-500 rounded-full transition-all"
                      style={{ width: `${resumo.totalPF > 0 ? (cat.valor / resumo.totalPF) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="font-mono text-sm font-medium text-neutral-900 w-24 text-right">
                    R$ {formatCurrency(cat.valor)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Últimas Faturas */}
      <div className="bg-white rounded-lg border border-neutral-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-neutral-900">Últimas Faturas</h2>
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
              className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded-lg hover:bg-neutral-800"
            >
              Importar fatura
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-neutral-100">
                  <th className="text-left text-xs font-medium text-neutral-500 pb-3">Cartão</th>
                  <th className="text-left text-xs font-medium text-neutral-500 pb-3">Mês</th>
                  <th className="text-right text-xs font-medium text-neutral-500 pb-3">Total</th>
                  <th className="text-right text-xs font-medium text-emerald-600 pb-3">PJ</th>
                  <th className="text-right text-xs font-medium text-rose-600 pb-3">PF</th>
                  <th className="text-center text-xs font-medium text-neutral-500 pb-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {faturas.slice(0, 5).map(f => (
                  <tr key={f.id} className="border-b border-neutral-50 hover:bg-neutral-50">
                    <td className="py-3">
                      <Link href={`/faturas/${f.id}`} className="font-medium text-neutral-900 hover:text-neutral-700">
                        {f.cartoes?.nome || 'Cartão'}
                      </Link>
                    </td>
                    <td className="py-3 text-sm text-neutral-500">
                      {f.mes_referencia ? new Date(f.mes_referencia).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : '-'}
                    </td>
                    <td className="py-3 text-right font-mono text-sm">
                      R$ {formatCurrency(f.valor_total)}
                    </td>
                    <td className="py-3 text-right font-mono text-sm text-emerald-600">
                      R$ {formatCurrency(f.valor_pj)}
                    </td>
                    <td className="py-3 text-right font-mono text-sm text-rose-600">
                      R$ {formatCurrency(f.valor_pf)}
                    </td>
                    <td className="py-3 text-center">
                      <span className={`text-xs px-2 py-1 rounded-full ${
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
        )}
      </div>

      {/* Ações Rápidas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link
          href="/upload"
          className="flex items-center gap-4 p-5 bg-white rounded-lg border border-neutral-200 hover:border-neutral-300 hover:shadow-sm transition-all group"
        >
          <div className="w-10 h-10 rounded-lg bg-neutral-100 flex items-center justify-center group-hover:bg-neutral-900 group-hover:text-white transition-colors">
            <FileText size={20} />
          </div>
          <div>
            <h3 className="font-medium text-neutral-900">Importar Fatura</h3>
            <p className="text-sm text-neutral-500">PDF ou OFX de cartão</p>
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
            <h3 className="font-medium text-neutral-900">Importar Extrato</h3>
            <p className="text-sm text-neutral-500">OFX bancário</p>
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
            <h3 className="font-medium text-neutral-900">Reconciliação</h3>
            <p className="text-sm text-neutral-500">Vincular reembolsos</p>
          </div>
        </Link>
      </div>
    </div>
  )
}
