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
  'Outros': 'bg-gray-100 text-gray-800',
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
  const [pdfFile, setPdfFile] = useState(null)
  const [tipoArquivo, setTipoArquivo] = useState('')
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [duplicateWarning, setDuplicateWarning] = useState(null)
  const [metodoProcessamento, setMetodoProcessamento] = useState('')

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

  const getCartaoNome = () => {
    const cartao = cartoes.find(c => c.id === selectedCartao)
    return cartao ? cartao.nome : ''
  }

  const getCartaoTipo = () => {
    const cartao = cartoes.find(c => c.id === selectedCartao)
    return cartao ? cartao.tipo : ''
  }

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      setPdfFile(file)
      const ext = file.name.split('.').pop()?.toLowerCase()
      setTipoArquivo(ext)
    }
  }

  const handleProcessar = async () => {
    if (!pdfFile) { setError('Selecione um arquivo'); return }
    if (!selectedCartao) { setError('Selecione o cartao'); return }
    if (!mesReferencia) { setError('Informe o mes de referencia'); return }

    setError('')
    setDuplicateWarning(null)
    setLoading(true)

    try {
      let parsed = []
      let metodo = ''

      // Detectar tipo de arquivo e usar rota adequada
      const isOFX = tipoArquivo === 'ofx' || tipoArquivo === 'qfx'

      if (isOFX) {
        // Parser deterministico para OFX
        const formData = new FormData()
        formData.append('file', pdfFile)

        const ofxResponse = await fetch('/api/parse-fatura-ofx', {
          method: 'POST',
          body: formData
        })
        const ofxResult = await ofxResponse.json()

        if (ofxResult.error) {
          throw new Error(ofxResult.error)
        }

        if (!ofxResult.transacoes || ofxResult.transacoes.length === 0) {
          throw new Error('Nenhuma transacao encontrada no arquivo OFX')
        }

        parsed = ofxResult.transacoes.map(t => ({
          id: Math.random().toString(36).substr(2, 9),
          data: t.data ? formatarData(t.data) : null,
          descricao: t.descricao,
          valor: parseFloat(t.valor) || 0,
          parcela: t.parcela || null,
          categoria: 'Outros PJ',
          tipo: 'PJ'
        })).filter(t => t.data && t.valor > 0)

        metodo = 'OFX_PARSER'
      } else {
        // IA para PDF
        const formData = new FormData()
        formData.append('pdf', pdfFile)
        formData.append('cartao_nome', getCartaoNome())
        formData.append('tipo_cartao', getCartaoTipo())

        const pdfResponse = await fetch('/api/parse-pdf', {
          method: 'POST',
          body: formData
        })
        const pdfResult = await pdfResponse.json()

        if (pdfResult.error) {
          throw new Error(pdfResult.error)
        }

        if (!pdfResult.transacoes || pdfResult.transacoes.length === 0) {
          throw new Error('Nenhuma transacao encontrada no PDF')
        }

        parsed = pdfResult.transacoes.map(t => ({
          id: Math.random().toString(36).substr(2, 9),
          data: t.data ? formatarData(t.data) : null,
          descricao: t.descricao,
          valor: parseFloat(t.valor) || 0,
          parcela: t.parcela || null,
          categoria: 'Outros PJ',
          tipo: 'PJ'
        })).filter(t => t.data && t.valor > 0)

        metodo = pdfResult.metodo || 'IA_PDF'
      }

      if (parsed.length === 0) {
        throw new Error('Nenhuma transacao valida encontrada')
      }

      // Verifica se a fatura ja existe
      const checkFormData = new FormData()
      checkFormData.append('cartao_id', selectedCartao)
      checkFormData.append('mes_referencia', mesReferencia)
      checkFormData.append('transacoes_preview', JSON.stringify(parsed))

      const checkResponse = await fetch('/api/faturas/check-duplicate', {
        method: 'POST',
        body: checkFormData
      })
      const checkResult = await checkResponse.json()

      if (checkResult.duplicada) {
        setDuplicateWarning({
          message: checkResult.message,
          fatura_id: checkResult.fatura_existente_id,
          similaridade: checkResult.similaridade,
          valor_existente: checkResult.valor_existente
        })
        // Guardar parsed para uso posterior
        setTransactions(parsed)
        setMetodoProcessamento(metodo)
        setLoading(false)
        return // Para aqui e mostra o aviso
      }

      // Continua com a categorizacao
      await categorizarEAvancar(parsed, metodo)
    } catch (err) {
      setError(`Erro: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const categorizarEAvancar = async (parsed, metodo) => {
    const response = await fetch('/api/categorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transacoes: parsed,
        tipo_cartao: getCartaoTipo()
      })
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
    setMetodoProcessamento(metodo)
    setStep(2)
  }

  const handleContinuarMesmoAssim = async () => {
    // Usuario decidiu continuar mesmo com fatura duplicada
    setDuplicateWarning(null)
    setLoading(true)

    try {
      // Se ja temos parsed do primeiro processamento, categorizar direto
      if (transactions.length > 0) {
        await categorizarEAvancar(transactions, metodoProcessamento)
      } else {
        // Reprocessar
        await handleProcessar()
      }
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

      // Salva o arquivo original no storage (apenas PDF)
      if (pdfFile && tipoArquivo === 'pdf') {
        const pdfFormData = new FormData()
        pdfFormData.append('fatura_id', faturaResult.fatura.id)
        pdfFormData.append('pdf', pdfFile)

        const uploadRes = await fetch('/api/faturas/upload-pdf', {
          method: 'POST',
          body: pdfFormData
        })
        const uploadResult = await uploadRes.json()
        if (uploadResult.error) {
          console.warn('Aviso: PDF nao foi salvo -', uploadResult.error)
        }
      }

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
      <h1 className="text-2xl font-bold text-slate-800">Importar fatura - Passo {step}/2</h1>

      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>}
      {success && <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">{success}</div>}

      {duplicateWarning && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg">
          <h3 className="font-bold text-amber-800 mb-2">Fatura possivelmente duplicada</h3>
          <p className="text-amber-700 mb-3">{duplicateWarning.message}</p>
          {duplicateWarning.valor_existente && (
            <p className="text-sm text-amber-600 mb-3">
              Valor da fatura existente: R$ {parseFloat(duplicateWarning.valor_existente).toLocaleString('pt-BR', {minimumFractionDigits: 2})}
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => setDuplicateWarning(null)}
              className="px-4 py-2 bg-white border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-100"
            >
              Cancelar
            </button>
            <button
              onClick={handleContinuarMesmoAssim}
              className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600"
            >
              Continuar mesmo assim
            </button>
            <a
              href={`/faturas/${duplicateWarning.fatura_id}`}
              className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
            >
              Ver fatura existente
            </a>
          </div>
        </div>
      )}

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
              <label className="block text-sm font-medium mb-2">Mes referencia *</label>
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
            <label className="block text-sm font-medium mb-2">Upload da fatura</label>
            <div className="flex gap-2 mb-2">
              <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded font-medium">
                .OFX (Recomendado - sem IA)
              </span>
              <span className="px-2 py-1 bg-amber-100 text-amber-800 text-xs rounded font-medium">
                .PDF (usa IA)
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-2">
              Suporta faturas de Nubank, Itau, Santander, C6 Bank, Mercado Pago, PicPay, Renner, XP e outros bancos brasileiros.
            </p>
            <input
              type="file"
              accept=".pdf,.ofx,.qfx"
              onChange={handleFileChange}
              className="w-full p-2 border rounded-lg"
            />
            {pdfFile && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-green-600 text-sm">Arquivo selecionado: {pdfFile.name}</span>
                {tipoArquivo === 'ofx' || tipoArquivo === 'qfx' ? (
                  <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded font-medium">
                    Parser deterministico (sem IA)
                  </span>
                ) : (
                  <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-xs rounded font-medium">
                    Processamento com IA
                  </span>
                )}
              </div>
            )}
          </div>

          <button
            onClick={handleProcessar}
            disabled={loading || !selectedCartao || !mesReferencia || !pdfFile}
            className="px-6 py-3 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 font-medium"
          >
            {loading ? (
              tipoArquivo === 'ofx' || tipoArquivo === 'qfx'
                ? 'Processando OFX...'
                : 'Processando PDF com IA...'
            ) : (
              'Processar e categorizar'
            )}
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border p-4 flex justify-between items-center">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm text-slate-500">{transactions.length} transacoes</p>
                {metodoProcessamento === 'OFX_PARSER' && (
                  <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded font-medium">
                    OFX preciso
                  </span>
                )}
                {metodoProcessamento === 'IA_PDF' && (
                  <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-xs rounded font-medium">
                    Extraido com IA
                  </span>
                )}
              </div>
              <p className="font-bold">
                <span className="text-green-600">PJ: R$ {totalPJ.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                {' | '}
                <span className="text-red-600">PF: R$ {totalPF.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
              </p>
            </div>
            <button onClick={() => setStep(1)} className="text-amber-600 hover:underline">Voltar</button>
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
            {saving ? 'Salvando...' : 'Salvar fatura'}
          </button>
        </div>
      )}
    </div>
  )
}
