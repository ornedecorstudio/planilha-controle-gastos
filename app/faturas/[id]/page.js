'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
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
  'Tarifas Cartão': 'bg-red-100 text-red-700',
  'Entretenimento': 'bg-red-100 text-red-600',
  'Transporte Pessoal': 'bg-red-100 text-red-600',
  'Compras Pessoais': 'bg-red-100 text-red-600',
}

export default function FaturaDetalhesPage() {
  const params = useParams()
  const router = useRouter()
  const [fatura, setFatura] = useState(null)
  const [transacoes, setTransacoes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const carregarDados = async () => {
      try {
        // Carregar fatura
        const faturaRes = await fetch(`/api/faturas?id=${params.id}`)
        const faturaData = await faturaRes.json()
        if (faturaData.error) throw new Error(faturaData.error)
        setFatura(faturaData.fatura)

        // Carregar transações
        const transacoesRes = await fetch(`/api/transacoes?fatura_id=${params.id}`)
        const transacoesData = await transacoesRes.json()
        if (transacoesData.error) throw new Error(transacoesData.error)
        setTransacoes(transacoesData.transacoes || [])
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    if (params.id) {
      carregarDados()
    }
  }, [params.id])

  const formatCurrency = (value) => {
    return (parseFloat(value) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const formatDate = (date) => {
    if (!date) return '-'
    return new Date(date + 'T12:00:00').toLocaleDateString('pt-BR')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500"></div>
      </div>
    )
  }

  if (error || !fatura) {
    return (
      <div className="space-y-4">
        <Link href="/faturas" className="text-amber-600 hover:underline">← Voltar para Faturas</Link>
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <h2 className="text-lg font-bold text-red-800">Erro ao carregar fatura</h2>
          <p className="text-red-600">{error || 'Fatura não encontrada'}</p>
        </div>
      </div>
    )
  }

  const totalPJ = transacoes.filter(t => t.tipo === 'PJ').reduce((a, t) => a + parseFloat(t.valor || 0), 0)
  const totalPF = transacoes.filter(t => t.tipo === 'PF').reduce((a, t) => a + parseFloat(t.valor || 0), 0)

  // Agrupar por categoria
  const porCategoria = {}
  transacoes.forEach(t => {
    const cat = t.categoria || 'Outros'
    if (!porCategoria[cat]) porCategoria[cat] = { total: 0, count: 0, tipo: t.tipo }
    porCategoria[cat].total += parseFloat(t.valor || 0)
    porCategoria[cat].count++
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/faturas" className="text-amber-600 hover:underline text-sm">← Voltar para Faturas</Link>
          <h1 className="text-2xl font-bold text-slate-800 mt-1">
            {fatura.cartoes?.nome || 'Fatura'}
          </h1>
          <p className="text-slate-500">
            {new Date(fatura.mes_referencia).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
          </p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium
          ${fatura.status === 'pendente' ? 'bg-amber-100 text-amber-800' : ''}
          ${fatura.status === 'pago' ? 'bg-blue-100 text-blue-800' : ''}
          ${fatura.status === 'reembolsado' ? 'bg-green-100 text-green-800' : ''}
        `}>
          {fatura.status === 'pendente' ? 'Pendente' : fatura.status === 'pago' ? 'Pago' : 'Reembolsado'}
        </span>
      </div>

      {/* Totais */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm text-slate-500">Total da Fatura</p>
          <p className="text-2xl font-bold text-slate-800">R$ {formatCurrency(totalPJ + totalPF)}</p>
          <p className="text-xs text-slate-400">{transacoes.length} transações</p>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-200 p-4">
          <p className="text-sm text-green-600">Total PJ (Reembolsável)</p>
          <p className="text-2xl font-bold text-green-700">R$ {formatCurrency(totalPJ)}</p>
          <p className="text-xs text-green-500">{transacoes.filter(t => t.tipo === 'PJ').length} transações</p>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-200 p-4">
          <p className="text-sm text-red-600">Total PF (Pessoal)</p>
          <p className="text-2xl font-bold text-red-700">R$ {formatCurrency(totalPF)}</p>
          <p className="text-xs text-red-500">{transacoes.filter(t => t.tipo === 'PF').length} transações</p>
        </div>
      </div>

      {/* Resumo por Categoria */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Resumo por Categoria</h2>
        <div className="space-y-2">
          {Object.entries(porCategoria)
            .sort((a, b) => b[1].total - a[1].total)
            .map(([cat, data]) => (
              <div key={cat} className="flex items-center justify-between py-2 border-b last:border-0">
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${CATEGORY_COLORS[cat] || 'bg-gray-100 text-gray-800'}`}>
                    {cat}
                  </span>
                  <span className="text-slate-500 text-sm">{data.count} transações</span>
                </div>
                <span className={`font-mono font-medium ${data.tipo === 'PJ' ? 'text-green-600' : 'text-red-600'}`}>
                  R$ {formatCurrency(data.total)}
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* Lista de Transações */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-4 border-b bg-gray-50">
          <h2 className="text-lg font-semibold text-slate-800">Transações</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-3 text-left">Data</th>
                <th className="p-3 text-left">Descrição</th>
                <th className="p-3 text-left">Categoria</th>
                <th className="p-3 text-center">Tipo</th>
                <th className="p-3 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {transacoes.map(t => (
                <tr key={t.id} className={`border-t hover:bg-gray-50 ${t.tipo === 'PF' ? 'bg-red-50/50' : ''}`}>
                  <td className="p-3 font-mono text-xs">{formatDate(t.data)}</td>
                  <td className="p-3 max-w-xs">
                    <span className="truncate block" title={t.descricao}>{t.descricao}</span>
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${CATEGORY_COLORS[t.categoria] || 'bg-gray-100 text-gray-800'}`}>
                      {t.categoria || 'Outros'}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${t.tipo === 'PJ' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {t.tipo}
                    </span>
                  </td>
                  <td className="p-3 text-right font-mono font-medium">
                    R$ {formatCurrency(t.valor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
