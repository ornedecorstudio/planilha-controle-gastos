'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Trash2, Copy } from 'lucide-react'
import ConfirmModal from '@/components/ConfirmModal'
import DuplicatesModal from '@/components/DuplicatesModal'

export default function ReconciliacaoPage() {
  const [loading, setLoading] = useState(true)
  const [faturas, setFaturas] = useState([])
  const [movimentacoes, setMovimentacoes] = useState([])
  const [resumo, setResumo] = useState({})
  const [sugestoes, setSugestoes] = useState([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [deleteModal, setDeleteModal] = useState({ open: false, movimentacao: null })
  const [duplicatesModal, setDuplicatesModal] = useState({ open: false, duplicatas: [] })
  const [loadingAction, setLoadingAction] = useState(false)

  useEffect(() => {
    carregarDados()
  }, [])

  const carregarDados = async () => {
    try {
      setLoading(true)

      // Carregar faturas e movimentações
      const response = await fetch('/api/reembolsos?tipo=todos')
      const data = await response.json()

      if (data.error) throw new Error(data.error)

      setFaturas(data.faturas || [])
      setMovimentacoes(data.movimentacoes_reembolso || [])
      setResumo(data.resumo || {})

      // Carregar sugestões de vinculação
      const sugResponse = await fetch('/api/reembolsos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'sugerir' })
      })
      const sugData = await sugResponse.json()
      setSugestoes(sugData.sugestoes || [])

    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const marcarReembolsado = async (faturaId, movimentacaoId = null) => {
    try {
      const response = await fetch('/api/reembolsos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fatura_id: faturaId,
          movimentacao_id: movimentacaoId
        })
      })
      const data = await response.json()

      if (data.error) throw new Error(data.error)

      setSuccess('Fatura marcada como reembolsada!')
      setTimeout(() => setSuccess(''), 3000)
      carregarDados()

    } catch (err) {
      setError(err.message)
      setTimeout(() => setError(''), 3000)
    }
  }

  const handleDeleteMovimentacao = async () => {
    if (!deleteModal.movimentacao) return
    setLoadingAction(true)
    try {
      const res = await fetch(`/api/reembolsos?id=${deleteModal.movimentacao.id}`, { method: 'DELETE' })
      const result = await res.json()
      if (result.error) throw new Error(result.error)
      setMovimentacoes(prev => prev.filter(m => m.id !== deleteModal.movimentacao.id))
      setDeleteModal({ open: false, movimentacao: null })
      setSuccess('Movimentação removida')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError('Erro ao remover: ' + err.message)
      setTimeout(() => setError(''), 3000)
    } finally {
      setLoadingAction(false)
    }
  }

  const handleCheckDuplicates = async () => {
    setLoadingAction(true)
    try {
      const res = await fetch('/api/reembolsos?duplicates=true', { method: 'DELETE' })
      const result = await res.json()
      if (result.error) throw new Error(result.error)
      if (result.duplicadas && result.duplicadas.length > 0) {
        setDuplicatesModal({ open: true, duplicatas: result.duplicadas })
      } else {
        setSuccess('Nenhuma movimentação duplicada encontrada.')
        setTimeout(() => setSuccess(''), 3000)
      }
    } catch (err) {
      setError('Erro ao verificar duplicadas: ' + err.message)
      setTimeout(() => setError(''), 3000)
    } finally {
      setLoadingAction(false)
    }
  }

  const handleDeleteDuplicates = async (ids) => {
    if (ids.length === 0) return
    setLoadingAction(true)
    try {
      const res = await fetch(`/api/reembolsos?ids=${ids.join(',')}`, { method: 'DELETE' })
      const result = await res.json()
      if (result.error) throw new Error(result.error)
      setMovimentacoes(prev => prev.filter(m => !ids.includes(m.id)))
      setDuplicatesModal({ open: false, duplicatas: [] })
      setSuccess(`${ids.length} movimentacoes duplicadas removidas`)
      setTimeout(() => setSuccess(''), 3000)
      carregarDados()
    } catch (err) {
      setError('Erro ao remover duplicadas: ' + err.message)
      setTimeout(() => setError(''), 3000)
    } finally {
      setLoadingAction(false)
    }
  }

  const formatCurrency = (value) => {
    return (parseFloat(value) || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
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

  const faturasPendentes = faturas.filter(f => f.status !== 'reembolsado')
  const faturasReembolsadas = faturas.filter(f => f.status === 'reembolsado')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Reconciliação de Reembolsos</h1>
          <p className="text-slate-500">Vincule faturas PF com reembolsos do extrato PJ</p>
        </div>
        <Link href="/extratos" className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-medium">
          + Importar Extrato
        </Link>
      </div>

      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>}
      {success && <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">{success}</div>}

      {/* Cards de Resumo */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
          <p className="text-sm text-amber-600">Pendente de Reembolso</p>
          <p className="text-2xl font-bold text-amber-700">R$ {formatCurrency(resumo.total_pendente)}</p>
          <p className="text-xs text-amber-500">{resumo.faturas_pendentes} faturas</p>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-200 p-4">
          <p className="text-sm text-green-600">Total Reembolsado</p>
          <p className="text-2xl font-bold text-green-700">R$ {formatCurrency(resumo.total_reembolsado)}</p>
          <p className="text-xs text-green-500">{resumo.faturas_reembolsadas} faturas</p>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
          <p className="text-sm text-blue-600">PIX ao Sócio (Extrato)</p>
          <p className="text-2xl font-bold text-blue-700">R$ {formatCurrency(resumo.total_movimentacoes)}</p>
          <p className="text-xs text-blue-500">{movimentacoes.length} transferências</p>
        </div>
        <div className={`rounded-xl border p-4 ${
          Math.abs((resumo.total_reembolsado || 0) - (resumo.total_movimentacoes || 0)) < 1
            ? 'bg-green-50 border-green-200'
            : 'bg-yellow-50 border-yellow-200'
        }`}>
          <p className="text-sm text-slate-600">Diferença</p>
          <p className={`text-2xl font-bold ${
            Math.abs((resumo.total_reembolsado || 0) - (resumo.total_movimentacoes || 0)) < 1
              ? 'text-green-700'
              : 'text-yellow-700'
          }`}>
            R$ {formatCurrency(Math.abs((resumo.total_movimentacoes || 0) - (resumo.total_reembolsado || 0)))}
          </p>
          <p className="text-xs text-slate-500">Extrato vs Faturas</p>
        </div>
      </div>

      {/* Sugestões de Vinculação */}
      {sugestoes.length > 0 && (
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-6">
          <h2 className="text-lg font-semibold text-amber-800 mb-4">
            💡 Sugestões de Vinculação ({sugestoes.length})
          </h2>
          <div className="space-y-3">
            {sugestoes.filter(s => s.confianca === 'alta').map((sug, i) => (
              <div key={i} className="bg-white rounded-lg p-4 flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded">
                      Match Exato
                    </span>
                    <span className="font-medium text-slate-700">
                      {sug.fatura.cartoes?.nome || 'Cartão'}
                    </span>
                    <span className="text-slate-400">→</span>
                    <span className="text-slate-600">
                      PIX {formatDate(sug.movimentacao?.data)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 mt-1">
                    Fatura: R$ {formatCurrency(sug.fatura.valor_pj)} PJ •
                    Reembolso: R$ {formatCurrency(sug.movimentacao?.valor)}
                  </p>
                </div>
                <button
                  onClick={() => marcarReembolsado(sug.fatura.id, sug.movimentacao?.id)}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
                >
                  ✓ Vincular
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Faturas Pendentes */}
      <div className="bg-white rounded-xl border">
        <div className="p-4 border-b bg-amber-50">
          <h2 className="text-lg font-semibold text-amber-800">
            Faturas Pendentes de Reembolso ({faturasPendentes.length})
          </h2>
        </div>
        {faturasPendentes.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            <p>🎉 Todas as faturas foram reembolsadas!</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-3 text-left">Cartão</th>
                  <th className="p-3 text-left">Mês</th>
                  <th className="p-3 text-right">Valor PJ</th>
                  <th className="p-3 text-right">Valor PF</th>
                  <th className="p-3 text-center">Status</th>
                  <th className="p-3 text-center">Ações</th>
                </tr>
              </thead>
              <tbody>
                {faturasPendentes.map(f => (
                  <tr key={f.id} className="border-t hover:bg-gray-50">
                    <td className="p-3">
                      <span className="font-medium">{f.cartoes?.nome || 'N/A'}</span>
                      <span className="text-xs text-slate-400 ml-1">({f.cartoes?.banco})</span>
                    </td>
                    <td className="p-3 text-slate-600">
                      {new Date(f.mes_referencia).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}
                    </td>
                    <td className="p-3 text-right font-mono text-green-600 font-medium">
                      R$ {formatCurrency(f.valor_pj)}
                    </td>
                    <td className="p-3 text-right font-mono text-red-600">
                      R$ {formatCurrency(f.valor_pf)}
                    </td>
                    <td className="p-3 text-center">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        f.status === 'pago' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {f.status === 'pago' ? 'Pago' : 'Pendente'}
                      </span>
                    </td>
                    <td className="p-3 text-center">
                      <button
                        onClick={() => marcarReembolsado(f.id)}
                        className="px-3 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 text-xs font-medium"
                      >
                        Marcar Reembolsado
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Movimentações de Reembolso */}
      <div className="bg-white rounded-xl border">
        <div className="p-4 border-b bg-blue-50 flex justify-between items-start">
          <div>
            <h2 className="text-lg font-semibold text-blue-800">
              PIX Enviados ao Sócio ({movimentacoes.length})
            </h2>
            <p className="text-sm text-blue-600">Transferências identificadas como reembolso no extrato PJ</p>
          </div>
          {movimentacoes.length > 0 && (
            <button
              onClick={handleCheckDuplicates}
              disabled={loadingAction}
              className="px-3 py-2 text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-sm flex items-center gap-2 disabled:opacity-50"
            >
              <Copy size={16} />
              Verificar duplicadas
            </button>
          )}
        </div>
        {movimentacoes.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            <p>Nenhum reembolso identificado nos extratos.</p>
            <Link href="/extratos" className="text-amber-600 hover:underline">
              Importar extrato →
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-3 text-left">Data</th>
                  <th className="p-3 text-left">Descrição</th>
                  <th className="p-3 text-right">Valor</th>
                  <th className="p-3 text-center">Vinculado</th>
                  <th className="p-3 text-center w-12"></th>
                </tr>
              </thead>
              <tbody>
                {movimentacoes.slice(0, 20).map(m => (
                  <tr key={m.id} className={`border-t ${m.fatura_vinculada_id ? 'bg-green-50' : ''}`}>
                    <td className="p-3 font-mono text-xs">{formatDate(m.data)}</td>
                    <td className="p-3 max-w-xs truncate" title={m.descricao}>{m.descricao}</td>
                    <td className="p-3 text-right font-mono font-medium text-amber-600">
                      R$ {formatCurrency(m.valor)}
                    </td>
                    <td className="p-3 text-center">
                      {m.fatura_vinculada_id ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <button
                        onClick={() => setDeleteModal({ open: true, movimentacao: m })}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                        title="Remover movimentação"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Faturas Reembolsadas */}
      {faturasReembolsadas.length > 0 && (
        <div className="bg-white rounded-xl border">
          <div className="p-4 border-b bg-green-50">
            <h2 className="text-lg font-semibold text-green-800">
              Faturas Reembolsadas ({faturasReembolsadas.length})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-3 text-left">Cartão</th>
                  <th className="p-3 text-left">Mês</th>
                  <th className="p-3 text-right">Valor PJ</th>
                  <th className="p-3 text-center">Data Reembolso</th>
                </tr>
              </thead>
              <tbody>
                {faturasReembolsadas.slice(0, 10).map(f => (
                  <tr key={f.id} className="border-t">
                    <td className="p-3 font-medium">{f.cartoes?.nome || 'N/A'}</td>
                    <td className="p-3 text-slate-600">
                      {new Date(f.mes_referencia).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}
                    </td>
                    <td className="p-3 text-right font-mono text-green-600">
                      R$ {formatCurrency(f.valor_pj)}
                    </td>
                    <td className="p-3 text-center text-slate-500">
                      {f.data_pagamento ? formatDate(f.data_pagamento) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      <ConfirmModal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, movimentacao: null })}
        onConfirm={handleDeleteMovimentacao}
        title="Remover movimentação"
        message={`Tem certeza que deseja remover "${deleteModal.movimentacao?.descricao?.substring(0, 50)}..."? Esta ação não pode ser desfeita.`}
        confirmText="Remover"
        variant="danger"
        loading={loadingAction}
      />

      {/* Duplicates Modal */}
      <DuplicatesModal
        isOpen={duplicatesModal.open}
        onClose={() => setDuplicatesModal({ open: false, duplicatas: [] })}
        duplicatas={duplicatesModal.duplicatas}
        onConfirm={handleDeleteDuplicates}
        loading={loadingAction}
      />
    </div>
  )
}
