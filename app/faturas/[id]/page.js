'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Trash2, Copy, Download, Search, X, FileText, CheckSquare, Square } from 'lucide-react'
import ConfirmModal from '@/components/ConfirmModal'
import DuplicatesModal from '@/components/DuplicatesModal'

const CATEGORY_COLORS = {
  'Marketing Digital': 'bg-blue-100 text-blue-800',
  'Pagamento Fornecedores': 'bg-purple-100 text-purple-800',
  'Taxas Checkout': 'bg-yellow-100 text-yellow-800',
  'Compra de Cambio': 'bg-green-100 text-green-800',
  'IA e Automacao': 'bg-indigo-100 text-indigo-800',
  'Design/Ferramentas': 'bg-violet-100 text-violet-800',
  'Telefonia': 'bg-pink-100 text-pink-800',
  'ERP': 'bg-orange-100 text-orange-800',
  'Gestao': 'bg-teal-100 text-teal-800',
  'Viagem Trabalho': 'bg-cyan-100 text-cyan-800',
  'Outros PJ': 'bg-gray-100 text-gray-800',
  'Pessoal': 'bg-red-100 text-red-800',
  'Tarifas Cartao': 'bg-red-100 text-red-700',
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

  // Filtros
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')

  // Selecao
  const [selectedIds, setSelectedIds] = useState(new Set())

  // Modals
  const [deleteModal, setDeleteModal] = useState({ open: false, transacao: null, multiple: false })
  const [duplicatesModal, setDuplicatesModal] = useState({ open: false, duplicatas: [] })
  const [loadingAction, setLoadingAction] = useState(false)

  useEffect(() => {
    const carregarDados = async () => {
      try {
        const faturaRes = await fetch(`/api/faturas?id=${params.id}`)
        const faturaData = await faturaRes.json()
        if (faturaData.error) throw new Error(faturaData.error)
        setFatura(faturaData.fatura)

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

  // Filtrar transacoes
  const transacoesFiltradas = transacoes.filter(t => {
    if (filtroTipo && t.tipo !== filtroTipo) return false
    if (busca && !t.descricao.toLowerCase().includes(busca.toLowerCase())) return false
    return true
  })

  // Selecao
  const toggleSelection = (id) => {
    const newSet = new Set(selectedIds)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    setSelectedIds(newSet)
  }

  const selectAll = () => {
    if (selectedIds.size === transacoesFiltradas.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(transacoesFiltradas.map(t => t.id)))
    }
  }

  // Handlers
  const handleDeleteSingle = (transacao) => {
    setDeleteModal({ open: true, transacao, multiple: false })
  }

  const handleDeleteMultiple = () => {
    if (selectedIds.size === 0) return
    setDeleteModal({ open: true, transacao: null, multiple: true })
  }

  const handleConfirmDelete = async () => {
    setLoadingAction(true)
    try {
      if (deleteModal.multiple) {
        const res = await fetch(`/api/transacoes?ids=${Array.from(selectedIds).join(',')}`, { method: 'DELETE' })
        const result = await res.json()
        if (result.error) throw new Error(result.error)
        setTransacoes(prev => prev.filter(t => !selectedIds.has(t.id)))
        setSelectedIds(new Set())
      } else {
        const res = await fetch(`/api/transacoes?id=${deleteModal.transacao.id}`, { method: 'DELETE' })
        const result = await res.json()
        if (result.error) throw new Error(result.error)
        setTransacoes(prev => prev.filter(t => t.id !== deleteModal.transacao.id))
        selectedIds.delete(deleteModal.transacao.id)
        setSelectedIds(new Set(selectedIds))
      }
      setDeleteModal({ open: false, transacao: null, multiple: false })
    } catch (err) {
      alert('Erro ao remover: ' + err.message)
    } finally {
      setLoadingAction(false)
    }
  }

  const handleCheckDuplicates = async () => {
    setLoadingAction(true)
    try {
      const res = await fetch(`/api/transacoes?fatura_id=${params.id}&duplicates=true`, { method: 'DELETE' })
      const result = await res.json()
      if (result.error) throw new Error(result.error)
      if (result.duplicadas && result.duplicadas.length > 0) {
        setDuplicatesModal({ open: true, duplicatas: result.duplicadas })
      } else {
        alert('Nenhuma transacao duplicada encontrada.')
      }
    } catch (err) {
      alert('Erro ao verificar duplicadas: ' + err.message)
    } finally {
      setLoadingAction(false)
    }
  }

  const handleDeleteDuplicates = async (ids) => {
    if (ids.length === 0) return
    setLoadingAction(true)
    try {
      const res = await fetch(`/api/transacoes?ids=${ids.join(',')}`, { method: 'DELETE' })
      const result = await res.json()
      if (result.error) throw new Error(result.error)
      setTransacoes(prev => prev.filter(t => !ids.includes(t.id)))
      setDuplicatesModal({ open: false, duplicatas: [] })
    } catch (err) {
      alert('Erro ao remover duplicadas: ' + err.message)
    } finally {
      setLoadingAction(false)
    }
  }

  const handleExportCSV = () => {
    window.open(`/api/transacoes/export?fatura_id=${params.id}`, '_blank')
  }

  const handleOpenPDF = () => {
    if (fatura?.pdf_url) {
      window.open(fatura.pdf_url, '_blank')
    }
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
        <Link href="/faturas" className="text-amber-600 hover:underline">← Voltar para faturas</Link>
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <h2 className="text-lg font-bold text-red-800">Erro ao carregar fatura</h2>
          <p className="text-red-600">{error || 'Fatura nao encontrada'}</p>
        </div>
      </div>
    )
  }

  const totalPJ = transacoesFiltradas.filter(t => t.tipo === 'PJ').reduce((a, t) => a + parseFloat(t.valor || 0), 0)
  const totalPF = transacoesFiltradas.filter(t => t.tipo === 'PF').reduce((a, t) => a + parseFloat(t.valor || 0), 0)

  const deleteMessage = deleteModal.multiple
    ? `Tem certeza que deseja remover ${selectedIds.size} transacoes selecionadas? Esta acao nao pode ser desfeita.`
    : `Tem certeza que deseja remover "${deleteModal.transacao?.descricao}"? Esta acao nao pode ser desfeita.`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link href="/faturas" className="text-amber-600 hover:underline text-sm">← Voltar para faturas</Link>
          <h1 className="text-2xl font-bold text-slate-800 mt-1">
            {fatura.cartoes?.nome || 'Fatura'}
          </h1>
          <p className="text-slate-500">
            {new Date(fatura.mes_referencia).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={handleDeleteMultiple}
              className="px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm flex items-center gap-2"
            >
              <Trash2 size={16} />
              Remover {selectedIds.size} selecionadas
            </button>
          )}
          {fatura?.pdf_url && (
            <button
              onClick={handleOpenPDF}
              className="px-3 py-2 text-amber-600 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 text-sm flex items-center gap-2"
            >
              <FileText size={16} />
              Ver PDF
            </button>
          )}
          <button
            onClick={handleCheckDuplicates}
            disabled={loadingAction}
            className="px-3 py-2 text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-sm flex items-center gap-2 disabled:opacity-50"
          >
            <Copy size={16} />
            Verificar duplicadas
          </button>
          <button
            onClick={handleExportCSV}
            className="px-3 py-2 text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-sm flex items-center gap-2"
          >
            <Download size={16} />
            Exportar CSV
          </button>
        </div>
      </div>

      {/* Totais */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm text-slate-500">Total da fatura</p>
          <p className="text-2xl font-bold text-slate-800">R$ {formatCurrency(totalPJ + totalPF)}</p>
          <p className="text-xs text-slate-400">{transacoesFiltradas.length} transacoes</p>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-200 p-4">
          <p className="text-sm text-green-600">Total PJ (reembolsavel)</p>
          <p className="text-2xl font-bold text-green-700">R$ {formatCurrency(totalPJ)}</p>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-200 p-4">
          <p className="text-sm text-red-600">Total PF (pessoal)</p>
          <p className="text-2xl font-bold text-red-700">R$ {formatCurrency(totalPF)}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-lg border p-4 flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por descricao..."
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm"
          />
          {busca && (
            <button onClick={() => setBusca('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          )}
        </div>
        <select
          value={filtroTipo}
          onChange={(e) => setFiltroTipo(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
        >
          <option value="">Todos os tipos</option>
          <option value="PJ">PJ (empresarial)</option>
          <option value="PF">PF (pessoal)</option>
        </select>
      </div>

      {/* Lista de Transacoes */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-3 text-center w-12">
                  <button onClick={selectAll} className="text-slate-400 hover:text-slate-600">
                    {selectedIds.size === transacoesFiltradas.length && transacoesFiltradas.length > 0 ? <CheckSquare size={18} /> : <Square size={18} />}
                  </button>
                </th>
                <th className="p-3 text-left">Data</th>
                <th className="p-3 text-left">Descricao</th>
                <th className="p-3 text-left">Categoria</th>
                <th className="p-3 text-center">Tipo</th>
                <th className="p-3 text-right">Valor</th>
                <th className="p-3 text-center w-12"></th>
              </tr>
            </thead>
            <tbody>
              {transacoesFiltradas.map(t => (
                <tr key={t.id} className={`border-t hover:bg-gray-50 ${t.tipo === 'PF' ? 'bg-red-50/50' : ''} ${selectedIds.has(t.id) ? 'bg-amber-50' : ''}`}>
                  <td className="p-3 text-center">
                    <button onClick={() => toggleSelection(t.id)} className="text-slate-400 hover:text-slate-600">
                      {selectedIds.has(t.id) ? <CheckSquare size={18} className="text-amber-500" /> : <Square size={18} />}
                    </button>
                  </td>
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
                  <td className="p-3 text-center">
                    <button
                      onClick={() => handleDeleteSingle(t)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                      title="Remover transacao"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Modal */}
      <ConfirmModal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, transacao: null, multiple: false })}
        onConfirm={handleConfirmDelete}
        title={deleteModal.multiple ? `Remover ${selectedIds.size} transacoes` : 'Remover transacao'}
        message={deleteMessage}
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
