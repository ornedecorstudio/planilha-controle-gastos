'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const CATEGORIA_EXTRATO_COLORS = {
  'Pagamento Funcionários': 'bg-blue-100 text-blue-800',
  'Transferência Sócios': 'bg-purple-100 text-purple-800',
  'Pagamento Fornecedores': 'bg-yellow-100 text-yellow-800',
  'Impostos e Taxas': 'bg-red-100 text-red-800',
  'Aluguel': 'bg-green-100 text-green-800',
  'Energia/Água/Internet': 'bg-cyan-100 text-cyan-800',
  'Empréstimo/Financiamento': 'bg-orange-100 text-orange-800',
  'Investimento': 'bg-indigo-100 text-indigo-800',
  'Receita/Entrada': 'bg-emerald-100 text-emerald-800',
  'Transferência Entre Contas': 'bg-slate-100 text-slate-800',
  'Outros': 'bg-gray-100 text-gray-800',
}

const CATEGORIAS_EXTRATO = [
  'Pagamento Funcionários',
  'Transferência Sócios',
  'Pagamento Fornecedores',
  'Impostos e Taxas',
  'Aluguel',
  'Energia/Água/Internet',
  'Empréstimo/Financiamento',
  'Investimento',
  'Receita/Entrada',
  'Transferência Entre Contas',
  'Outros',
]

export default function ExtratosPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [banco, setBanco] = useState('')
  const [mesReferencia, setMesReferencia] = useState('')
  const [pdfFile, setPdfFile] = useState(null)
  const [movimentacoes, setMovimentacoes] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const bancos = [
    { id: 'nubank', nome: 'Nubank' },
    { id: 'itau', nome: 'Itaú' },
    { id: 'santander', nome: 'Santander' },
    { id: 'bradesco', nome: 'Bradesco' },
    { id: 'inter', nome: 'Banco Inter' },
    { id: 'bb', nome: 'Banco do Brasil' },
    { id: 'caixa', nome: 'Caixa Econômica' },
    { id: 'outro', nome: 'Outro' },
  ]

  const categorizarMovimentacao = (descricao) => {
    const desc = descricao.toUpperCase()

    // Pagamento Funcionários
    if (desc.match(/SALARIO|FOLHA|CLT|FGTS|INSS|FERIAS|13|DECIMO|ADIANTAMENTO|FUNCIONARIO|EMPREGADO/)) {
      return { categoria: 'Pagamento Funcionários', tipo: 'saida' }
    }

    // Transferência Sócios
    if (desc.match(/PRO.?LABORE|SOCIO|DISTRIBUICAO|DIVIDENDO|LUCRO/)) {
      return { categoria: 'Transferência Sócios', tipo: 'saida' }
    }

    // Impostos e Taxas
    if (desc.match(/DAS|SIMPLES|DARF|GPS|IPTU|IPVA|ISS|ICMS|PIS|COFINS|CSLL|IRPJ|IMPOSTO|TAXA|TRIBUTO|GUIA|GNRE/)) {
      return { categoria: 'Impostos e Taxas', tipo: 'saida' }
    }

    // Aluguel
    if (desc.match(/ALUGUEL|LOCACAO|CONDOMINIO/)) {
      return { categoria: 'Aluguel', tipo: 'saida' }
    }

    // Energia/Água/Internet
    if (desc.match(/ENERGIA|ELETRIC|CPFL|ENEL|LIGHT|CEMIG|CELPE|COELBA|AGUA|SANEAMENTO|SABESP|COPASA|INTERNET|VIVO|CLARO|TIM|OI|NET|TELEFON/)) {
      return { categoria: 'Energia/Água/Internet', tipo: 'saida' }
    }

    // Empréstimo/Financiamento
    if (desc.match(/EMPRESTIMO|FINANCIAMENTO|PARCELA|PRESTACAO|CDC|LEASING/)) {
      return { categoria: 'Empréstimo/Financiamento', tipo: 'saida' }
    }

    // Investimento
    if (desc.match(/INVESTIMENTO|APLICACAO|CDB|LCI|LCA|TESOURO|FUNDO|ACAO|BOLSA/)) {
      return { categoria: 'Investimento', tipo: 'saida' }
    }

    // Transferência Entre Contas
    if (desc.match(/TED|DOC|PIX|TRANSF.*MESMA|TRANSF.*PROPRIA|ENTRE CONTAS/)) {
      return { categoria: 'Transferência Entre Contas', tipo: 'saida' }
    }

    // Pagamento Fornecedores (genérico - boletos)
    if (desc.match(/BOLETO|PAGTO|PAG\s|FORNEC/)) {
      return { categoria: 'Pagamento Fornecedores', tipo: 'saida' }
    }

    // Receitas/Entradas
    if (desc.match(/RECEB|CREDITO|DEPOSITO|ENTRADA|VENDA|CLIENTE|FATURAMENTO/)) {
      return { categoria: 'Receita/Entrada', tipo: 'entrada' }
    }

    return { categoria: 'Outros', tipo: 'saida' }
  }

  const handleProcessar = async () => {
    if (!pdfFile) { setError('Selecione um arquivo PDF do extrato'); return }
    if (!banco) { setError('Selecione o banco'); return }
    if (!mesReferencia) { setError('Informe o mês de referência'); return }

    setError('')
    setLoading(true)

    try {
      const formData = new FormData()
      formData.append('pdf', pdfFile)
      formData.append('tipo', 'extrato')
      formData.append('banco', banco)

      const pdfResponse = await fetch('/api/parse-extrato', {
        method: 'POST',
        body: formData
      })
      const pdfResult = await pdfResponse.json()

      if (pdfResult.error) {
        throw new Error(pdfResult.error)
      }

      if (!pdfResult.movimentacoes || pdfResult.movimentacoes.length === 0) {
        throw new Error('Nenhuma movimentação encontrada no PDF')
      }

      const parsed = pdfResult.movimentacoes.map(m => {
        const categorizacao = categorizarMovimentacao(m.descricao)
        return {
          id: Math.random().toString(36).substr(2, 9),
          data: m.data ? formatarData(m.data) : null,
          descricao: m.descricao,
          valor: Math.abs(parseFloat(m.valor) || 0),
          tipo: m.tipo || categorizacao.tipo,
          categoria: categorizacao.categoria,
        }
      }).filter(m => m.data && m.valor > 0)

      if (parsed.length === 0) {
        throw new Error('Nenhuma movimentação válida encontrada no PDF')
      }

      setMovimentacoes(parsed)
      setStep(2)
    } catch (err) {
      setError(`Erro: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const formatarData = (dataStr) => {
    if (!dataStr) return null

    if (/^\d{4}-\d{2}-\d{2}$/.test(dataStr)) {
      return dataStr
    }

    const match = dataStr.match(/(\d{2})\/(\d{2})\/(\d{4})/)
    if (match) {
      const [, dia, mes, ano] = match
      return `${ano}-${mes}-${dia}`
    }

    const matchSemAno = dataStr.match(/(\d{2})\/(\d{2})/)
    if (matchSemAno && mesReferencia) {
      const [, dia, mes] = matchSemAno
      const [ano] = mesReferencia.split('-')
      return `${ano}-${mes}-${dia}`
    }

    return null
  }

  const handleSalvar = async () => {
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/extratos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          banco,
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

      setSuccess(`Extrato salvo com ${result.quantidade || movimentacoes.length} movimentações!`)
      setTimeout(() => router.push('/'), 2000)
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Adicionar Extrato Bancário - Passo {step}/2</h1>

      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>}
      {success && <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">{success}</div>}

      {step === 1 && (
        <div className="bg-white rounded-xl border p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Banco *</label>
              <select value={banco} onChange={(e) => setBanco(e.target.value)}
                className="w-full p-3 border rounded-lg">
                <option value="">Selecione o banco...</option>
                {bancos.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Mês Referência *</label>
              <input type="month" value={mesReferencia} onChange={(e) => setMesReferencia(e.target.value)}
                className="w-full p-3 border rounded-lg" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Upload PDF do Extrato</label>
            <p className="text-xs text-slate-500 mb-2">
              Suporta extratos de Nubank, Itaú, Santander, Bradesco, Inter e outros bancos brasileiros.
            </p>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
              className="w-full p-2 border rounded-lg"
            />
            {pdfFile && (
              <p className="mt-2 text-green-600 text-sm">✓ PDF selecionado: {pdfFile.name}</p>
            )}
          </div>

          <button
            onClick={handleProcessar}
            disabled={loading || !banco || !mesReferencia || !pdfFile}
            className="px-6 py-3 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 font-medium"
          >
            {loading ? 'Processando PDF com IA...' : 'Processar e Categorizar →'}
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border p-4 flex justify-between items-center">
            <div>
              <p className="text-sm text-slate-500">{movimentacoes.length} movimentações</p>
              <p className="font-bold">
                <span className="text-emerald-600">Entradas: R$ {totalEntradas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                {' | '}
                <span className="text-red-600">Saídas: R$ {totalSaidas.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
              </p>
            </div>
            <button onClick={() => setStep(1)} className="text-amber-600 hover:underline">← Voltar</button>
          </div>

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
                  <tr key={m.id} className={`border-t ${m.tipo === 'entrada' ? 'bg-emerald-50' : ''}`}>
                    <td className="p-3 font-mono text-xs">{m.data ? new Date(m.data + 'T12:00:00').toLocaleDateString('pt-BR') : '-'}</td>
                    <td className="p-3 max-w-xs truncate" title={m.descricao}>{m.descricao}</td>
                    <td className="p-3">
                      <select value={m.categoria} onChange={(e) => updateMovimentacao(m.id, 'categoria', e.target.value)}
                        className={`px-2 py-1 rounded text-xs font-medium ${CATEGORIA_EXTRATO_COLORS[m.categoria] || 'bg-gray-100'}`}>
                        {CATEGORIAS_EXTRATO.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                    <td className="p-3 text-center">
                      <select value={m.tipo} onChange={(e) => updateMovimentacao(m.id, 'tipo', e.target.value)}
                        className={`px-2 py-1 rounded text-xs font-medium ${m.tipo === 'entrada' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                        <option value="entrada">Entrada</option>
                        <option value="saida">Saída</option>
                      </select>
                    </td>
                    <td className="p-3 text-right font-mono font-medium">R$ {m.valor.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button onClick={handleSalvar} disabled={saving}
            className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium">
            {saving ? 'Salvando...' : '💾 Salvar Extrato'}
          </button>
        </div>
      )}
    </div>
  )
}
