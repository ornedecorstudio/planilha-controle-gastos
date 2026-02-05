'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const CATEGORIA_EXTRATO_COLORS = {
  'Reembolso Sócio': 'bg-amber-100 text-amber-800',
  'Aporte Sócio': 'bg-emerald-100 text-emerald-800',
  'Logística': 'bg-blue-100 text-blue-800',
  'Impostos': 'bg-red-100 text-red-800',
  'Contabilidade': 'bg-purple-100 text-purple-800',
  'Câmbio': 'bg-green-100 text-green-800',
  'Taxas/Checkout': 'bg-yellow-100 text-yellow-800',
  'Receitas': 'bg-teal-100 text-teal-800',
  'Transferência Interna': 'bg-slate-100 text-slate-800',
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

  const bancos = [
    { id: 'itau', nome: 'Itaú' },
    { id: 'nubank', nome: 'Nubank' },
    { id: 'santander', nome: 'Santander' },
    { id: 'bradesco', nome: 'Bradesco' },
    { id: 'inter', nome: 'Banco Inter' },
    { id: 'bb', nome: 'Banco do Brasil' },
    { id: 'caixa', nome: 'Caixa Econômica' },
    { id: 'outro', nome: 'Outro' },
  ]

  const handleArquivoChange = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      setArquivo(file)
      setArquivoFile(file) // Salva o arquivo original para upload posterior
      const ext = file.name.split('.').pop()?.toLowerCase()
      setTipoArquivo(ext)
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
        <h1 className="text-2xl font-bold text-slate-800">
          Importar Extrato Bancário - Passo {step}/2
        </h1>
        {step === 1 && (
          <Link href="/reconciliacao" className="text-amber-600 hover:underline text-sm">
            Ver Reconciliação →
          </Link>
        )}
      </div>

      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>}
      {success && <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">{success}</div>}

      {step === 1 && (
        <div className="bg-white rounded-xl border p-6 space-y-6">
          {/* Info OFX */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <h3 className="font-semibold text-amber-800 mb-2">🏆 Recomendado: Arquivo OFX</h3>
            <p className="text-amber-700 text-sm">
              O formato OFX é processado de forma determinística, sem uso de IA, garantindo 100% de precisão.
              Você pode baixar o extrato em OFX diretamente no internet banking do seu banco.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Banco (opcional)</label>
              <select value={banco} onChange={(e) => setBanco(e.target.value)}
                className="w-full p-3 border rounded-lg">
                <option value="">Detectar automaticamente</option>
                {bancos.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
              </select>
              <p className="text-xs text-slate-500 mt-1">
                Se usar OFX, o banco será detectado automaticamente
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Mês Referência *</label>
              <input type="month" value={mesReferencia} onChange={(e) => setMesReferencia(e.target.value)}
                className="w-full p-3 border rounded-lg" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Upload do Extrato</label>
            <div className="flex gap-2 mb-2">
              <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded font-medium">
                .OFX (Recomendado)
              </span>
              <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">
                .PDF (usa IA)
              </span>
            </div>
            <input
              type="file"
              accept=".ofx,.qfx,.pdf"
              onChange={handleArquivoChange}
              className="w-full p-2 border rounded-lg"
            />
            {arquivo && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-green-600 text-sm">✓ {arquivo.name}</span>
                {tipoArquivo === 'ofx' || tipoArquivo === 'qfx' ? (
                  <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded">
                    Parser Determinístico
                  </span>
                ) : (
                  <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-xs rounded">
                    Processamento com IA
                  </span>
                )}
              </div>
            )}
          </div>

          <button
            onClick={handleProcessar}
            disabled={loading || !mesReferencia || !arquivo}
            className="px-6 py-3 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 font-medium"
          >
            {loading ? (
              tipoArquivo === 'pdf' ? 'Processando PDF com IA...' : 'Processando OFX...'
            ) : (
              'Processar Extrato →'
            )}
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {/* Info do Extrato */}
          {extratoInfo && (
            <div className="bg-white rounded-xl border p-4">
              <div className="flex flex-wrap gap-4 items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">
                    {extratoInfo.banco} {extratoInfo.conta && `• Conta ${extratoInfo.conta}`}
                  </p>
                  <p className="text-xs text-slate-400">
                    Período: {extratoInfo.periodo_inicio} a {extratoInfo.periodo_fim}
                    {extratoInfo.metodo === 'OFX_PARSER' && (
                      <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-800 rounded">
                        ✓ OFX Preciso
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-slate-500">Saldo Final</p>
                  <p className="font-bold text-slate-800">
                    R$ {(extratoInfo.saldo_final || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Resumo */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border p-4">
              <p className="text-sm text-slate-500">Movimentações</p>
              <p className="text-xl font-bold text-slate-800">{movimentacoes.length}</p>
            </div>
            <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4">
              <p className="text-sm text-emerald-600">Total Entradas</p>
              <p className="text-xl font-bold text-emerald-700">
                R$ {totalEntradas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
              </p>
            </div>
            <div className="bg-red-50 rounded-xl border border-red-200 p-4">
              <p className="text-sm text-red-600">Total Saídas</p>
              <p className="text-xl font-bold text-red-700">
                R$ {totalSaidas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
              </p>
            </div>
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
              <p className="text-sm text-amber-600">Reembolsos ao Sócio</p>
              <p className="text-xl font-bold text-amber-700">
                R$ {totalReembolsos.toLocaleString('pt-BR', {minimumFractionDigits: 2})}
              </p>
              <p className="text-xs text-amber-500">{reembolsos.length} transferências</p>
            </div>
          </div>

          {/* Resumo por Categoria */}
          {resumoCategorias.length > 0 && (
            <div className="bg-white rounded-xl border p-4">
              <h3 className="font-semibold text-slate-700 mb-3">Resumo por Categoria</h3>
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
            <button onClick={() => setStep(1)} className="text-amber-600 hover:underline">
              ← Voltar
            </button>
            <button onClick={handleSalvar} disabled={saving}
              className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium">
              {saving ? 'Salvando...' : '💾 Salvar e Reconciliar'}
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
                    m.isReembolso ? 'bg-amber-50' :
                    m.tipo === 'entrada' ? 'bg-emerald-50/50' : ''
                  }`}>
                    <td className="p-3 font-mono text-xs">
                      {m.data ? new Date(m.data + 'T12:00:00').toLocaleDateString('pt-BR') : '-'}
                    </td>
                    <td className="p-3 max-w-xs">
                      <div className="truncate" title={m.descricao}>{m.descricao}</div>
                      {m.subcategoria && (
                        <span className="text-xs text-slate-400">{m.subcategoria}</span>
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
