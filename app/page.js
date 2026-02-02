'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const CATEGORY_COLORS = {
  'Marketing Digital': 'bg-blue-100 text-blue-800',
  'Pagamento Fornecedores': 'bg-purple-100 text-purple-800',
  'Taxas Checkout': 'bg-yellow-100 text-yellow-800',
  'Compra de Câmbio': 'bg-green-100 text-green-800',
  'IA e Automação': 'bg-indigo-100 text-indigo-800',
  'Design/Ferramentas': 'bg-violet-100 text-violet-800',
  'Telefonia': 'bg-pink-100 text-pink-800',
  'ERP': 'bg-orange-100 text-orange-800',
  'Gestão': 'bg-teal-100 text-teal-800',
  'Viagem Trabalho': 'bg-cyan-100 text-cyan-800',
  'Outros PJ': 'bg-gray-100 text-gray-800',
  'Pessoal': 'bg-red-100 text-red-800',
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
        // Carregar faturas
        const faturasRes = await fetch('/api/faturas')
        const faturasData = await faturasRes.json()
        const faturasLista = faturasData.faturas || []
        setFaturas(faturasLista)

        // Calcular resumo
        let totalGeral = 0
        let totalPJ = 0
        let totalPF = 0
        const categoriasMap = {}

        for (const fatura of faturasLista) {
          totalGeral += parseFloat(fatura.valor_total) || 0
          totalPJ += parseFloat(fatura.valor_pj) || 0
          totalPF += parseFloat(fatura.valor_pf) || 0
        }

        // Carregar transações para calcular por categoria
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

        // Carregar dados de reembolso
        try {
          const reembolsoRes = await fetch('/api/reembolsos?tipo=todos')
          const reembolsoResult = await reembolsoRes.json()
          if (!reembolsoResult.error) {
            setReembolsoData(reembolsoResult.resumo)
          }
        } catch (err) {
          console.log('API de reembolsos não disponível ainda')
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
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500"></div>
      </div>
    )
  }

  const pendente = reembolsoData?.total_pendente || 0
  const reembolsado = reembolsoData?.total_reembolsado || 0

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
        <div className="flex gap-2">
          <Link href="/upload" className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-medium">
            + Nova Fatura
          </Link>
          <Link href="/extratos" className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 font-medium">
            + Extrato
          </Link>
        </div>
      </div>

      {/* Cards de Resumo - Faturas */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border p-6">
          <p className="text-sm text-slate-500">Total Geral</p>
          <p className="text-2xl font-bold text-slate-800">R$ {formatCurrency(resumo.totalGeral)}</p>
          <p className="text-xs text-slate-400 mt-1">{resumo.totalFaturas} faturas</p>
        </div>
        <div className="bg-white rounded-xl border p-6 border-l-4 border-l-green-500">
          <p className="text-sm text-slate-500">Total PJ (Reembolsável)</p>
          <p className="text-2xl font-bold text-green-600">R$ {formatCurrency(resumo.totalPJ)}</p>
          <p className="text-xs text-slate-400 mt-1">{resumo.totalGeral > 0 ? ((resumo.totalPJ / resumo.totalGeral) * 100).toFixed(1) : 0}% do total</p>
        </div>
        <div className="bg-white rounded-xl border p-6 border-l-4 border-l-red-500">
          <p className="text-sm text-slate-500">Total PF (Pessoal)</p>
          <p className="text-2xl font-bold text-red-600">R$ {formatCurrency(resumo.totalPF)}</p>
          <p className="text-xs text-slate-400 mt-1">{resumo.totalGeral > 0 ? ((resumo.totalPF / resumo.totalGeral) * 100).toFixed(1) : 0}% do total</p>
        </div>
        <div className="bg-white rounded-xl border p-6 border-l-4 border-l-amber-500">
          <p className="text-sm text-slate-500">Faturas Cadastradas</p>
          <p className="text-2xl font-bold text-amber-600">{resumo.totalFaturas}</p>
          <Link href="/faturas" className="text-xs text-amber-500 hover:underline mt-1 block">Ver todas →</Link>
        </div>
      </div>

      {/* Cards de Reembolso */}
      {reembolsoData && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-amber-50 rounded-xl border border-amber-200 p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-amber-600">Pendente de Reembolso</p>
                <p className="text-2xl font-bold text-amber-700">R$ {formatCurrency(pendente)}</p>
                <p className="text-xs text-amber-500 mt-1">{reembolsoData.faturas_pendentes} faturas</p>
              </div>
              {pendente > 0 && (
                <Link href="/reconciliacao"
                  className="px-3 py-1 bg-amber-200 text-amber-800 rounded-lg text-xs hover:bg-amber-300">
                  Reconciliar →
                </Link>
              )}
            </div>
          </div>
          <div className="bg-green-50 rounded-xl border border-green-200 p-6">
            <p className="text-sm text-green-600">Total Reembolsado</p>
            <p className="text-2xl font-bold text-green-700">R$ {formatCurrency(reembolsado)}</p>
            <p className="text-xs text-green-500 mt-1">{reembolsoData.faturas_reembolsadas} faturas</p>
          </div>
          <div className="bg-blue-50 rounded-xl border border-blue-200 p-6">
            <p className="text-sm text-blue-600">PIX ao Sócio (Extrato)</p>
            <p className="text-2xl font-bold text-blue-700">R$ {formatCurrency(reembolsoData.total_movimentacoes)}</p>
            <Link href="/reconciliacao" className="text-xs text-blue-500 hover:underline mt-1 block">
              Ver reconciliação →
            </Link>
          </div>
        </div>
      )}

      {/* Gastos por Categoria PJ */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Gastos PJ por Categoria</h2>
        {resumo.categorias.length === 0 ? (
          <p className="text-slate-500 text-sm">Nenhuma transação PJ cadastrada ainda.</p>
        ) : (
          <div className="space-y-3">
            {resumo.categorias.map((cat, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${CATEGORY_COLORS[cat.nome] || 'bg-gray-100 text-gray-800'}`}>
                    {cat.nome}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-48 bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full"
                      style={{ width: `${resumo.totalPJ > 0 ? (cat.valor / resumo.totalPJ) * 100 : 0}%` }}
                    ></div>
                  </div>
                  <span className="font-mono text-sm font-medium w-28 text-right">
                    R$ {formatCurrency(cat.valor)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Últimas Faturas */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-slate-800">Últimas Faturas</h2>
          <Link href="/faturas" className="text-amber-500 text-sm hover:underline">Ver todas →</Link>
        </div>
        {faturas.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-slate-500 mb-4">Nenhuma fatura cadastrada ainda.</p>
            <Link href="/upload" className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-medium">
              Importar primeira fatura
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-3 text-left">Cartão</th>
                  <th className="p-3 text-left">Mês</th>
                  <th className="p-3 text-right">Total</th>
                  <th className="p-3 text-right">PJ</th>
                  <th className="p-3 text-right">PF</th>
                  <th className="p-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {faturas.slice(0, 5).map(f => (
                  <tr key={f.id} className="border-t hover:bg-gray-50">
                    <td className="p-3 font-medium">{f.cartoes?.nome || 'Cartão'}</td>
                    <td className="p-3">{f.mes_referencia ? new Date(f.mes_referencia).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : '-'}</td>
                    <td className="p-3 text-right font-mono">R$ {formatCurrency(f.valor_total)}</td>
                    <td className="p-3 text-right font-mono text-green-600">R$ {formatCurrency(f.valor_pj)}</td>
                    <td className="p-3 text-right font-mono text-red-600">R$ {formatCurrency(f.valor_pf)}</td>
                    <td className="p-3 text-center">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        f.status === 'pago' ? 'bg-blue-100 text-blue-800' :
                        f.status === 'reembolsado' ? 'bg-green-100 text-green-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {f.status === 'pago' ? 'Pago' : f.status === 'reembolsado' ? 'Reembolsado' : 'Pendente'}
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/upload"
          className="bg-white rounded-xl border p-6 hover:border-amber-300 hover:shadow-md transition-all group">
          <div className="text-3xl mb-2">📄</div>
          <h3 className="font-semibold text-slate-800 group-hover:text-amber-600">Importar Fatura</h3>
          <p className="text-sm text-slate-500">Upload de PDF de cartão de crédito</p>
        </Link>
        <Link href="/extratos"
          className="bg-white rounded-xl border p-6 hover:border-amber-300 hover:shadow-md transition-all group">
          <div className="text-3xl mb-2">🏦</div>
          <h3 className="font-semibold text-slate-800 group-hover:text-amber-600">Importar Extrato</h3>
          <p className="text-sm text-slate-500">Upload de OFX ou PDF bancário</p>
        </Link>
        <Link href="/reconciliacao"
          className="bg-white rounded-xl border p-6 hover:border-amber-300 hover:shadow-md transition-all group">
          <div className="text-3xl mb-2">🔗</div>
          <h3 className="font-semibold text-slate-800 group-hover:text-amber-600">Reconciliação</h3>
          <p className="text-sm text-slate-500">Vincular faturas com reembolsos</p>
        </Link>
      </div>
    </div>
  )
}
