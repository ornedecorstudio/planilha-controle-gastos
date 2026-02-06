'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Trash2, CheckSquare, Square } from 'lucide-react'
import MonthPicker from '@/components/MonthPicker'
import ConfirmModal from '@/components/ConfirmModal'
import DropZone from '@/components/DropZone'
import UploadButton from '@/components/UploadButton'

const CATEGORIA_EXTRATO_COLORS = {
  'Reembolso Sócio': 'bg-blue-100 text-blue-800',
  'Aporte Sócio': 'bg-emerald-100 text-emerald-800',
  'Logística': 'bg-blue-100 text-blue-800',
  'Impostos': 'bg-red-100 text-red-800',
  'Contabilidade': 'bg-purple-100 text-purple-800',
  'Câmbio': 'bg-green-100 text-green-800',
  'Taxas/Checkout': 'bg-yellow-100 text-yellow-800',
  'Receitas': 'bg-teal-100 text-teal-800',
  'Transferência Interna': 'bg-neutral-100 text-neutral-900',
  'Funcionários': 'bg-indigo-100 text-indigo-800',
  'Rendimentos': 'bg-cyan-100 text-cyan-800',
  'Pagamentos': 'bg-orange-100 text-orange-800',
  'Outros': 'bg-gray-100 text-gray-800',
}

const CATEGORIAS_EXTRATO = [
  'Reembolso Sócio',
  'Aporte Sócio',
  'Logística',
  'Impostos',
  'Contabilidade',
  'Câmbio',
  'Taxas/Checkout',
  'Receitas',
  'Transferência Interna',
  'Funcionários',
  'Rendimentos',
  'Pagamentos',
  'Outros',
]

export default function ExtratosPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [banco, setBanco] = useState('')
  const [mesReferencia, setMesReferencia] = useState('')
  const [arquivo, setArquivo] = useState(null)
  const [arquivoFile, setArquivoFile] = useState(null) // Arquivo original para upload
  const [tipoArquivo, setTipoArquivo] = useState('')
  const [movimentacoes, setMovimentacoes] = useState([])
  const [extratoInfo, setExtratoInfo] = useState(null)
  const [resumoCategorias, setResumoCategorias] = useState([])
  const [reembolsos, setReembolsos] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [extratosImportados, setExtratosImportados] = useState([])
  const [loadingExtratos, setLoadingExtratos] = useState(true)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [deleteModal, setDeleteModal] = useState({ open: false, extrato: null, multiple: false })
  const [loadingAction, setLoadingAction] = useState(false)

  useEffect(() => {
    const carregarExtratos = async () => {
      try {
        const res = await fetch('/api/extratos?limit=50')
        const data = await res.json()
        setExtratosImportados(data.extratos || [])
      } catch (err) {
        console.error('Erro ao carregar extratos:', err)
      } finally {
        setLoadingExtratos(false)
      }
    }
    carregarExtratos()
  }, [])

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
    if (selectedIds.size === extratosImportados.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(extratosImportados.map(e => e.id)))
    }
  }

  const handleDeleteSingle = (extrato) => {
    setDeleteModal({ open: true, extrato, multiple: false })
  }

  const handleDeleteMultiple = () => {
    if (selectedIds.size === 0) return
    setDeleteModal({ open: true, extrato: null, multiple: true })
  }

  const handleConfirmDelete = async () => {
    setLoadingAction(true)
    try {
      if (deleteModal.multiple) {
        const res = await fetch(`/api/extratos?ids=${Array.from(selectedIds).join(',')}`, { method: 'DELETE' })
        const result = await res.json()
        if (result.error) throw new Error(result.error)
        setExtratosImportados(prev => prev.filter(e => !selectedIds.has(e.id)))
        setSelectedIds(new Set())
      } else {
        const res = await fetch(`/api/extratos?id=${deleteModal.extrato.id}`, { method: 'DELETE' })
        const result = await res.json()
        if (result.error) throw new Error(result.error)
        setExtratosImportados(prev => prev.filter(e => e.id !== deleteModal.extrato.id))
        selectedIds.delete(deleteModal.extrato.id)
        setSelectedIds(new Set(selectedIds))
      }
      setDeleteModal({ open: false, extrato: null, multiple: false })
    } catch (err) {
      alert('Erro ao remover: ' + err.message)
    } finally {
      setLoadingAction(false)
    }
  }

  const deleteMessage = deleteModal.multiple
    ? `Tem certeza que deseja remover ${selectedIds.size} extratos selecionados? Todas as movimentações desses extratos também serão removidas. Esta ação não pode ser desfeita.`
    : `Tem certeza que deseja remover o extrato "${deleteModal.extrato?.banco || 'N/A'} - ${deleteModal.extrato?.mes_referencia ? new Date(deleteModal.extrato.mes_referencia).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : ''}"? Todas as movimentações desse extrato também serão removidas. Esta ação não pode ser desfeita.`

  const bancos = [
    { id: 'itau', nome: 'Itaú' },
    { id: 'nubank', nome: 'Nubank' },
    { id: 'santander', nome: 'Santander' },
    { id: 'bradesco', nome: 'Bradesco' },
    { id: 'inter', nome: 'Banco Inter' },
    { id: 'bb', nome: 'Banco do Brasil' },
    { id: 'caixa', nome: 'Caixa Econômica' },
    { id: 'c6bank', nome: 'C6 Bank' },
    { id: 'outro', nome: 'Outro' },
  ]

  const handleArquivoChange = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      setArquivo(file)
      setArquivoFile(file)
      const ext = file.name.split('.').pop()?.toLowerCase()
      setTipoArquivo(ext)
    }
  }

  const handleDropZoneFile = (file) => {
    if (file) {
      setArquivo(file)
      setArquivoFile(file)
      const ext = file.name.split('.').pop()?.toLowerCase()
      setTipoArquivo(ext)
    } else {
      setArquivo(null)
      setArquivoFile(null)
      setTipoArquivo('')
    }
  }

  const handleProcessar = async () => {
    if (!arquivo) { setError('Selecione um arquivo'); return }
    if (!mesReferencia) { setError('Informe o mês de referência'); return }

    setError('')
    setLoading(true)

    try {
      const formData = new FormData()
      formData.append('file', arquivo)
      formData.append('banco', banco)

      const response = await fetch('/api/parse-extrato', {
        method: 'POST',
        body: formData
      })
      const result = await response.json()

      if (result.error) {
        throw new Error(result.error)
      }

      if (!result.movimentacoes || result.movimentacoes.length === 0) {
        throw new Error('Nenhuma movimentação encontrada no arquivo')
      }

      // Armazenar informações do extrato
      setExtratoInfo({
        metodo: result.metodo,
        banco: result.banco,
        conta: result.conta,
        periodo_inicio: result.periodo_inicio,
        periodo_fim: result.periodo_fim,
        saldo_final: result.saldo_final,
        total_entradas: result.total_entradas,
        total_saidas: result.total_saidas,
        total_reembolsos: result.total_reembolsos
      })

      // Adicionar IDs únicos se não existirem
      const movsComId = result.movimentacoes.map((m, i) => ({
        ...m,
        id: m.id || `mov_${Date.now()}_${i}`
      }))

      setMovimentacoes(movsComId)
      setResumoCategorias(result.resumo_categorias || [])
      setReembolsos(result.reembolsos_identificados || [])
      setStep(2)
    } catch (err) {
      setError(`Erro: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleSalvar = async () => {
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/extratos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          banco: extratoInfo?.banco || banco,
          mes_referencia: `${mesReferencia}-01`,
          movimentacoes: movimentacoes.map(m => ({
            data: m.data,
            descricao: m.descricao,
            valor: m.valor,
            tipo: m.tipo,
            categoria: m.categoria,
          }))
        })
      })
      const result = await response.json()
      if (result.error) throw new Error(result.error)

      // Mensagem personalizada baseada no resultado
      if (result.warning) {
        setError(result.warning)
        return
      }

      // Fazer upload do arquivo original se existir
      if (arquivoFile && result.extrato?.id) {
        try {
          const uploadForm = new FormData()
          uploadForm.append('extrato_id', result.extrato.id)
          uploadForm.append('arquivo', arquivoFile)

          await fetch('/api/extratos/upload-arquivo', {
            method: 'POST',
            body: uploadForm
          })
        } catch (uploadErr) {
          console.error('Erro ao fazer upload do arquivo:', uploadErr)
          // Não falha se o upload falhar - o extrato já foi salvo
        }
      }

      const msgDuplicadas = result.duplicadas_ignoradas > 0
        ? ` (${result.duplicadas_ignoradas} duplicadas ignoradas)`
        : ''
      setSuccess(`${result.message || `Extrato salvo com ${result.quantidade} movimentações`}${msgDuplicadas}`)
      setTimeout(() => router.push('/reconciliacao'), 2500)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const updateMovimentacao = (id, field, value) => {
    setMovimentacoes(prev => prev.map(m =>
      m.id === id ? { ...m, [field]: value } : m
    ))
  }

  const totalEntradas = movimentacoes.filter(m => m.tipo === 'entrada').reduce((a, m) => a + m.valor, 0)
  const totalSaidas = movimentacoes.filter(m => m.tipo === 'saida').reduce((a, m) => a + m.valor, 0)
  const totalReembolsos = movimentacoes.filter(m => m.isReembolso).reduce((a, m) => a + m.valor, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">
            Importar extrato bancário
          </h1>
          {step === 2 && <p className="text-neutral-500 mt-1">Passo 2 de 2 - Revisar movimentacoes</p>}
        </div>
        {step === 1 && (
          <Link href="/reconciliacao" className="text-neutral-500 hover:text-neutral-900 text-sm">
            Ver Reconciliacao
          </Link>
        )}
      </div>

      {error && <div className="p-4 bg-red-50 border border-neutral-200 rounded-lg text-red-700">{error}</div>}
      {success && <div className="p-4 bg-green-50 border border-neutral-200 rounded-lg text-green-700">{success}</div>}

      {step === 1 && (
        <div className="bg-white rounded-xl border p-6 md:p-8 space-y-6">
          <div className="bg-blue-50/60 rounded-lg p-4 flex items-start gap-3">
            <span className="text-blue-500 text-lg mt-0.5">i</span>
            <div>
              <p className="text-sm text-blue-800 font-medium">Recomendado: Arquivo OFX</p>
              <p className="text-xs text-blue-600 mt-0.5">
                Processamento deterministico, sem IA, com 100% de precisao.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-neutral-700">Banco (opcional)</label>
              <select value={banco} onChange={(e) => setBanco(e.target.value)}
                className="w-full p-3 border border-neutral-300 rounded-lg bg-white text-neutral-900 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200 focus:outline-none">
                <option value="">Detectar automaticamente</option>
                {bancos.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
              </select>
              <p className="text-xs text-neutral-400 mt-1">
                Com OFX, o banco e detectado automaticamente
              </p>
            </div>
            <MonthPicker
              value={mesReferencia}
              onChange={setMesReferencia}
              label="Mes de referencia"
              required
            />
          </div>

          <DropZone
            onFileSelect={handleDropZoneFile}
            accept=".ofx,.qfx,.pdf"
            file={arquivo}
            formats={[
              { ext: '.OFX', label: 'Recomendado', color: 'bg-emerald-50 text-emerald-700' },
              { ext: '.PDF', label: 'usa IA', color: 'bg-neutral-100 text-neutral-600' },
            ]}
          />

          <div className="flex justify-center">
            <UploadButton
              onClick={handleProcessar}
              loading={loading}
              disabled={!mesReferencia || !arquivo}
              label="Processar extrato"
            />
          </div>
        </div>
      )}

      {/* Lista de extratos importados */}
      {step === 1 && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="p-4 border-b flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-neutral-900">Extratos importados</h2>
              <p className="text-sm text-neutral-500">{extratosImportados.length} extratos</p>
            </div>
            {selectedIds.size > 0 && (
              <button
                onClick={handleDeleteMultiple}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium flex items-center gap-2 text-sm"
              >
                <Trash2 size={16} />
                Remover {selectedIds.size} {selectedIds.size === 1 ? 'extrato' : 'extratos'}
              </button>
            )}
          </div>
          {loadingExtratos ? (
            <div className="flex items-center justify-center h-24">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-neutral-300 border-t-neutral-900"></div>
            </div>
          ) : extratosImportados.length === 0 ? (
            <div className="p-8 text-center text-neutral-500">
              Nenhum extrato importado ainda.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="p-3 text-center w-12">
                      <button onClick={selectAll} className="text-neutral-400 hover:text-neutral-600">
                        {selectedIds.size === extratosImportados.length && extratosImportados.length > 0 ? <CheckSquare size={18} /> : <Square size={18} />}
                      </button>
                    </th>
                    <th className="p-3 text-left font-medium text-neutral-600">Banco</th>
                    <th className="p-3 text-left font-medium text-neutral-600">Mês</th>
                    <th className="p-3 text-right font-medium text-neutral-600">Entradas</th>
                    <th className="p-3 text-right font-medium text-neutral-600">Saídas</th>
                    <th className="p-3 text-right font-medium text-neutral-600">Saldo</th>
                    <th className="p-3 text-center font-medium text-neutral-600">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {extratosImportados.map(ext => (
                    <tr key={ext.id} className={`border-t hover:bg-neutral-50 ${selectedIds.has(ext.id) ? 'bg-neutral-100' : ''}`}>
                      <td className="p-3 text-center">
                        <button onClick={() => toggleSelection(ext.id)} className="text-neutral-400 hover:text-neutral-600">
                          {selectedIds.has(ext.id) ? <CheckSquare size={18} className="text-neutral-900" /> : <Square size={18} />}
                        </button>
                      </td>
                      <td className="p-3 font-medium text-neutral-900">{ext.banco}</td>
                      <td className="p-3 text-neutral-600">
                        {ext.mes_referencia ? new Date(ext.mes_referencia).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : '-'}
                      </td>
                      <td className="p-3 text-right font-mono text-emerald-600">
                        R$ {(parseFloat(ext.total_entradas) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-3 text-right font-mono text-rose-600">
                        R$ {(parseFloat(ext.total_saidas) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-3 text-right font-mono font-medium text-neutral-900">
                        R$ {(parseFloat(ext.saldo) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Link href={`/extratos/${ext.id}`} className="text-neutral-500 hover:text-neutral-900 text-xs">
                            Ver detalhes
                          </Link>
                          <button
                            onClick={() => handleDeleteSingle(ext)}
                            className="p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                            title="Remover extrato"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, extrato: null, multiple: false })}
        onConfirm={handleConfirmDelete}
        title={deleteModal.multiple ? `Remover ${selectedIds.size} extratos` : 'Remover extrato'}
        message={deleteMessage}
        confirmText="Remover"
        variant="danger"
        loading={loadingAction}
      />

      {step === 2 && (
        <div className="space-y-4">
          {/* Info do Extrato */}
          {extratoInfo && (
            <div className="bg-white rounded-xl border p-4">
              <div className="flex flex-wrap gap-4 items-center justify-between">
                <div>
                  <p className="text-sm text-neutral-500">
                    {extratoInfo.banco} {extratoInfo.conta && `• Conta ${extratoInfo.conta}`}
                  </p>
                  <p className="text-xs text-neutral-400">
                    Período: {extratoInfo.periodo_inicio} a {extratoInfo.periodo_fim}
                    {extratoInfo.metodo === 'OFX_PARSER' && (
                      <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-800 rounded">
                        OFX Preciso
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-neutral-500">Saldo Final</p>
                  <p className="font-bold text-neutral-900">
                    R$ {(extratoInfo.saldo_final || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Resumo */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border p-4">
              <p className="text-sm text-neutral-500">Movimentações</p>
              <p className="text-xl font-bold text-neutral-900">{movimentacoes.length}</p>
            </div>
            <div className="bg-emerald-50 rounded-xl border border-neutral-200 p-4">
              <p className="text-sm text-emerald-600">Total Entradas</p>
              <p className="text-xl font-bold text-emerald-700">
                R$ {totalEntradas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
              </p>
            </div>
            <div className="bg-red-50 rounded-xl border border-neutral-200 p-4">
              <p className="text-sm text-red-600">Total Saídas</p>
              <p className="text-xl font-bold text-red-700">
                R$ {totalSaidas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
              </p>
            </div>
            <div className="bg-blue-50 rounded-xl border border-neutral-200 p-4">
              <p className="text-sm text-blue-600">Reembolsos ao Socio</p>
              <p className="text-xl font-bold text-blue-700">
                R$ {totalReembolsos.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
              </p>
              <p className="text-xs text-blue-500">{reembolsos.length} transferencias</p>
            </div>
          </div>

          {/* Resumo por Categoria */}
          {resumoCategorias.length > 0 && (
            <div className="bg-white rounded-xl border p-4">
              <h3 className="font-semibold text-neutral-700 mb-3">Resumo por Categoria</h3>
              <div className="flex flex-wrap gap-2">
                {resumoCategorias.slice(0, 8).map((cat, i) => (
                  <div key={i} className={`px-3 py-1 rounded-lg text-sm ${CATEGORIA_EXTRATO_COLORS[cat.categoria] || 'bg-gray-100'}`}>
                    {cat.categoria}: R$ {cat.total.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                    <span className="text-xs opacity-70 ml-1">({cat.quantidade})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ações */}
          <div className="bg-white rounded-xl border p-4 flex justify-between items-center">
            <button onClick={() => setStep(1)} className="text-neutral-600 hover:underline">
              ← Voltar
            </button>
            <button onClick={handleSalvar} disabled={saving}
              className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium">
              {saving ? 'Salvando...' : 'Salvar e Reconciliar'}
            </button>
          </div>

          {/* Tabela de Movimentações */}
          <div className="bg-white rounded-xl border overflow-x-auto">
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
                {movimentacoes.map(m => (
                  <tr key={m.id} className={`border-t ${
                    m.isReembolso ? 'bg-blue-50' :
                    m.tipo === 'entrada' ? 'bg-emerald-50/50' : ''
                  }`}>
                    <td className="p-3 font-mono text-xs">
                      {m.data ? new Date(m.data + 'T12:00:00').toLocaleDateString('pt-BR') : '-'}
                    </td>
                    <td className="p-3 max-w-xs">
                      <div className="truncate" title={m.descricao}>{m.descricao}</div>
                      {m.subcategoria && (
                        <span className="text-xs text-neutral-400">{m.subcategoria}</span>
                      )}
                    </td>
                    <td className="p-3">
                      <select
                        value={m.categoria}
                        onChange={(e) => updateMovimentacao(m.id, 'categoria', e.target.value)}
                        className={`px-2 py-1 rounded text-xs font-medium ${CATEGORIA_EXTRATO_COLORS[m.categoria] || 'bg-gray-100'}`}
                      >
                        {CATEGORIAS_EXTRATO.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="p-3 text-center">
                      <select
                        value={m.tipo}
                        onChange={(e) => updateMovimentacao(m.id, 'tipo', e.target.value)}
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          m.tipo === 'entrada' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                        }`}
                      >
                        <option value="entrada">Entrada</option>
                        <option value="saida">Saída</option>
                      </select>
                    </td>
                    <td className={`p-3 text-right font-mono font-medium ${
                      m.tipo === 'entrada' ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      {m.tipo === 'entrada' ? '+' : '-'}R$ {m.valor.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
