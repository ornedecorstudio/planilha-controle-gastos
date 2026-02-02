'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

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

export default function UploadPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [cartoes, setCartoes] = useState([])
  const [categorias, setCategorias] = useState([])
  const [selectedCartao, setSelectedCartao] = useState('')
  const [mesReferencia, setMesReferencia] = useState('')
  const [dataVencimento, setDataVencimento] = useState('')
  const [rawData, setRawData] = useState('')
  const [pdfFile, setPdfFile] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    const carregarDados = async () => {
      try {
        const [cartoesRes, categoriasRes] = await Promise.all([
          fetch('/api/cartoes'),
          fetch('/api/categorias')
        ])
        const cartoesData = await cartoesRes.json()
        const categoriasData = await categoriasRes.json()
        setCartoes(cartoesData.cartoes || [])
        setCategorias(categoriasData.categorias || [])
      } catch (err) {
        console.error('Erro ao carregar dados:', err)
      }
    }
    carregarDados()
  }, [])

  const parseData = (text, mesAno = null) => {
    const lines = text.trim().split('\n').filter(line => line.trim())
    const parsed = []
    let mesVencimento = null
    let anoVencimento = null
    
    if (mesAno && mesAno.includes('-')) {
      const [ano, mes] = mesAno.split('-')
      mesVencimento = parseInt(mes)
      anoVencimento = parseInt(ano)
    }
    
    const calcularAnoTransacao = (mesTransacao) => {
      if (!mesVencimento || !anoVencimento) return anoVencimento || new Date().getFullYear()
      if (mesTransacao > mesVencimento) return anoVencimento - 1
      return anoVencimento
    }
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.toLowerCase().includes('date,title,amount')) continue
      if (line.toLowerCase().includes('data de compra')) continue
      
      let data = null, descricao = null, valor = null
      
      if (line.match(/^\d{4}-\d{2}-\d{2},/)) {
        const parts = line.split(',')
        if (parts.length >= 3) {
          data = parts[0]
          descricao = parts[1]?.trim()
          valor = parseFloat(parts[2])
        }
      } else if (line.includes('\t')) {
        const parts = line.split('\t')
        if (parts.length >= 3) {
          const dataMatch = parts[0].match(/(\d{2})\/(\d{2})(?:\/(\d{2,4}))?/)
          if (dataMatch) {
            let [, dia, mes, ano] = dataMatch
            if (!ano) ano = calcularAnoTransacao(parseInt(mes))
            else if (ano.length === 2) ano = parseInt(ano) > 50 ? `19${ano}` : `20${ano}`
            data = `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`
          }
          descricao = parts[1]?.trim()
          for (let j = 2; j < parts.length; j++) {
            const valorMatch = parts[j].match(/R?\$?\s*([-]?[\d.,]+)/)
            if (valorMatch) {
              valor = parseFloat(valorMatch[1].replace(/\./g, '').replace(',', '.'))
              if (!isNaN(valor) && Math.abs(valor) > 0.01) break
            }
          }
        }
      } else if (line.match(/^\d{2}\/\d{2}/)) {
        const match = line.match(/(\d{2})\/(\d{2})(?:\/(\d{2,4}))?\s+(.+?)\s+(?:R\$\s*)?([\d.,]+)\s*$/i)
        if (match) {
          let [, dia, mes, ano, desc, val] = match
          if (!ano) ano = calcularAnoTransacao(parseInt(mes))
          else if (ano.length === 2) ano = parseInt(ano) > 50 ? `19${ano}` : `20${ano}`
          data = `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`
          descricao = desc.trim()
          valor = parseFloat(val.replace(/\./g, '').replace(',', '.'))
        }
      }

      if (data && descricao && valor !== null && !isNaN(valor) && valor > 0.01) {
        parsed.push({
          id: Math.random().toString(36).substr(2, 9),
          data, descricao: descricao.trim(), valor: Math.abs(valor),
          categoria: 'Outros PJ', tipo: 'PJ'
        })
      }
    }
    return parsed
  }

  // Funcao auxiliar para obter nome do cartao selecionado
  const getCartaoNome = () => {
    const cartao = cartoes.find(c => c.id === selectedCartao)
    return cartao ? cartao.nome : ''
  }

  const handleProcessar = async () => {
    if (!rawData.trim() && !pdfFile) { setError('Cole os dados ou faca upload de PDF'); return }
    if (!selectedCartao) { setError('Selecione o cartao'); return }
    if (!mesReferencia) { setError('Informe o mes de referencia'); return }

    setError('')
    setLoading(true)
    let parsed = []

    // Se for PDF, usar a API de parse com IA
    if (pdfFile) {
      try {
        const formData = new FormData()
        formData.append('pdf', pdfFile) // Nome correto: 'pdf'
        formData.append('cartao_nome', getCartaoNome()) // Enviar nome do cartao para contexto
        
        const pdfResponse = await fetch('/api/parse-pdf', { 
          method: 'POST', 
          body: formData 
        })
        const pdfResult = await pdfResponse.json()
        
        if (pdfResult.error) {
          throw new Error(pdfResult.error)
        }
        
        // Se a IA retornou transacoes, usar diretamente
        if (pdfResult.transacoes && pdfResult.transacoes.length > 0) {
          parsed = pdfResult.transacoes.map(t => ({
            id: Math.random().toString(36).substr(2, 9),
            data: t.data ? formatarData(t.data) : null,
            descricao: t.descricao,
            valor: parseFloat(t.valor) || 0,
            parcela: t.parcela || null,
            categoria: 'Outros PJ',
            tipo: 'PJ'
          })).filter(t => t.data && t.valor > 0)
        }
        
        if (parsed.length === 0) {
          throw new Error('Nenhuma transacao encontrada no PDF')
        }
        
      } catch (pdfError) {
        setError(`Erro PDF: ${pdfError.message}`)
        setLoading(false)
        return
      }
    } else {
      // Se for texto colado, usar parser local
      parsed = parseData(rawData, mesReferencia)
    }

    if (parsed.length === 0) { 
      setError('Nenhuma transacao encontrada'); 
      setLoading(false); 
      return 
    }

    // Categorizar as transacoes
    try {
      const response = await fetch('/api/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transacoes: parsed })
      })
      const result = await response.json()
      
      if (result.resultados?.length > 0) {
        setTransactions(parsed.map((t, i) => ({
          ...t,
          categoria: result.resultados[i]?.categoria || 'Outros PJ',
          tipo: result.resultados[i]?.incluir === false ? 'PF' : 'PJ'
        })))
      } else {
        setTransactions(parsed)
      }
      setStep(2)
    } catch (err) {
      // Se categorizacao falhar, usar transacoes sem categoria
      setTransactions(parsed)
      setStep(2)
    } finally {
      setLoading(false)
    }
  }

  // Funcao para formatar data de DD/MM/YYYY para YYYY-MM-DD
  const formatarData = (dataStr) => {
    if (!dataStr) return null
    
    // Se ja esta no formato YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dataStr)) {
      return dataStr
    }
    
    // Formato DD/MM/YYYY
    const match = dataStr.match(/(\d{2})\/(\d{2})\/(\d{4})/)
    if (match) {
      const [, dia, mes, ano] = match
      return `${ano}-${mes}-${dia}`
    }
    
    // Formato DD/MM (sem ano)
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
      const faturaRes = await fetch('/api/faturas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cartao_id: selectedCartao,
          mes_referencia: `${mesReferencia}-01`,
          data_vencimento: dataVencimento || null,
          status: 'pendente'
        })
      })
      const faturaResult = await faturaRes.json()
      if (faturaResult.error) throw new Error(faturaResult.error)
      
      const transacoesRes = await fetch('/api/transacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fatura_id: faturaResult.fatura.id,
          transacoes: transactions.map(t => ({
            data: t.data, descricao: t.descricao, valor: t.valor,
            categoria: t.categoria, tipo: t.tipo, metodo: 'automatico'
          }))
        })
      })
      const transacoesResult = await transacoesRes.json()
      if (transacoesResult.error) throw new Error(transacoesResult.error)
      
      setSuccess(`Fatura salva com ${transacoesResult.quantidade} transacoes!`)
      setTimeout(() => router.push('/faturas'), 2000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const updateTransaction = (id, field, value) => {
    setTransactions(prev => prev.map(t => {
      if (t.id === id) {
        const updated = { ...t, [field]: value }
        if (field === 'categoria' && ['Pessoal', 'Tarifas Cartao', 'Entretenimento', 'Transporte Pessoal', 'Compras Pessoais'].includes(value)) {
          updated.tipo = 'PF'
        }
        return updated
      }
      return t
    }))
  }

  const totalPJ = transactions.filter(t => t.tipo === 'PJ').reduce((a, t) => a + t.valor, 0)
  const totalPF = transactions.filter(t => t.tipo === 'PF').reduce((a, t) => a + t.valor, 0)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Importar Fatura - Passo {step}/2</h1>

      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>}
      {success && <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">{success}</div>}

      {step === 1 && (
        <div className="bg-white rounded-xl border p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Cartao *</label>
              <select value={selectedCartao} onChange={(e) => setSelectedCartao(e.target.value)}
                className="w-full p-3 border rounded-lg">
                <option value="">Selecione...</option>
                {cartoes.map(c => <option key={c.id} value={c.id}>{c.nome} ({c.tipo})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Mes Referencia *</label>
              <input type="month" value={mesReferencia} onChange={(e) => setMesReferencia(e.target.value)}
                className="w-full p-3 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Vencimento</label>
              <input type="date" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)}
                className="w-full p-3 border rounded-lg" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Upload PDF (processado com IA)</label>
            <input type="file" accept=".pdf" onChange={(e) => { setPdfFile(e.target.files?.[0] || null); setRawData('') }}
              className="w-full p-2 border rounded-lg" />
            {pdfFile && <p className="mt-2 text-green-600 text-sm">PDF selecionado: {pdfFile.name}</p>}
          </div>

          {!pdfFile && (
            <div>
              <label className="block text-sm font-medium mb-2">Ou cole os dados CSV/texto</label>
              <textarea value={rawData} onChange={(e) => setRawData(e.target.value)}
                placeholder="Cole aqui os dados da fatura (CSV, texto tabulado, etc)..." 
                className="w-full h-48 p-4 border rounded-lg font-mono text-sm" />
            </div>
          )}

          <button onClick={handleProcessar} disabled={loading || !selectedCartao || !mesReferencia || (!rawData.trim() && !pdfFile)}
            className="px-6 py-3 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 font-medium">
            {loading ? 'Processando...' : 'Processar e Categorizar →'}
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border p-4 flex justify-between items-center">
            <div>
              <p className="text-sm text-slate-500">{transactions.length} transacoes</p>
              <p className="font-bold">
                <span className="text-green-600">PJ: R$ {totalPJ.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                {' | '}
                <span className="text-red-600">PF: R$ {totalPF.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
              </p>
            </div>
            <button onClick={() => setStep(1)} className="text-amber-600 hover:underline">← Voltar</button>
          </div>

          <div className="bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-3 text-left">Data</th>
                  <th className="p-3 text-left">Descricao</th>
                  <th className="p-3 text-left">Categoria</th>
                  <th className="p-3 text-center">Tipo</th>
                  <th className="p-3 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(t => (
                  <tr key={t.id} className={`border-t ${t.tipo === 'PF' ? 'bg-red-50' : ''}`}>
                    <td className="p-3 font-mono text-xs">{t.data ? new Date(t.data + 'T12:00:00').toLocaleDateString('pt-BR') : '-'}</td>
                    <td className="p-3 max-w-xs truncate" title={t.descricao}>{t.descricao}</td>
                    <td className="p-3">
                      <select value={t.categoria} onChange={(e) => updateTransaction(t.id, 'categoria', e.target.value)}
                        className={`px-2 py-1 rounded text-xs font-medium ${CATEGORY_COLORS[t.categoria] || 'bg-gray-100'}`}>
                        {categorias.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                      </select>
                    </td>
                    <td className="p-3 text-center">
                      <select value={t.tipo} onChange={(e) => updateTransaction(t.id, 'tipo', e.target.value)}
                        className={`px-2 py-1 rounded text-xs font-medium ${t.tipo === 'PJ' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        <option value="PJ">PJ</option>
                        <option value="PF">PF</option>
                      </select>
                    </td>
                    <td className="p-3 text-right font-mono font-medium">R$ {t.valor.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button onClick={handleSalvar} disabled={saving}
            className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium">
            {saving ? 'Salvando...' : '💾 Salvar no Supabase'}
          </button>
        </div>
      )}
    </div>
  )
}
