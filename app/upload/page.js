'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import MonthPicker from '@/components/MonthPicker'

const CATEGORY_COLORS = {
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
  'Pessoal': 'bg-rose-50 text-rose-600 border border-rose-200',
  'Tarifas Cartão': 'bg-rose-50 text-rose-600 border border-rose-200',
  'Entretenimento': 'bg-rose-50 text-rose-600 border border-rose-200',
  'Transporte Pessoal': 'bg-rose-50 text-rose-600 border border-rose-200',
  'Compras Pessoais': 'bg-rose-50 text-rose-600 border border-rose-200',
}

export default function UploadPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [cartoes, setCartoes] = useState([])
  const [categorias, setCategorias] = useState([])
  const [selectedCartao, setSelectedCartao] = useState('')
  const [mesReferencia, setMesReferencia] = useState('')
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
    if (!selectedCartao) { setError('Selecione o cartão'); return }
    if (!mesReferencia) { setError('Informe o mês de referência'); return }

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

      // Salva o arquivo original no storage (PDF, OFX, QFX)
      if (pdfFile) {
        const arquivoFormData = new FormData()
        arquivoFormData.append('fatura_id', faturaResult.fatura.id)
        arquivoFormData.append('arquivo', pdfFile)

        const uploadRes = await fetch('/api/faturas/upload-pdf', {
          method: 'POST',
          body: arquivoFormData
        })
        const uploadResult = await uploadRes.json()
        if (uploadResult.error) {
          console.warn('Aviso: Arquivo nao foi salvo -', uploadResult.error)
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
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900">Importar fatura</h1>
        <p className="text-neutral-500 mt-1">Passo {step} de 2</p>
      </div>

      {error && <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-700">{error}</div>}
      {success && <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700">{success}</div>}

      {duplicateWarning && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <h3 className="font-semibold text-amber-800 mb-2">Fatura possivelmente duplicada</h3>
          <p className="text-amber-700 mb-3">{duplicateWarning.message}</p>
          {duplicateWarning.valor_existente && (
            <p className="text-sm text-amber-600 mb-3">
              Valor da fatura existente: R$ {parseFloat(duplicateWarning.valor_existente).toLocaleString('pt-BR', {minimumFractionDigits: 2})}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setDuplicateWarning(null)}
              className="px-4 py-2 bg-white border border-neutral-200 text-neutral-700 rounded-lg hover:bg-neutral-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleContinuarMesmoAssim}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
            >
              Continuar mesmo assim
            </button>
            <a
              href={`/faturas/${duplicateWarning.fatura_id}`}
              className="px-4 py-2 bg-neutral-900 text-white rounded-lg hover:bg-neutral-800"
            >
              Ver fatura existente
            </a>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="bg-white rounded-xl border p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-neutral-700">Cartão *</label>
              <select value={selectedCartao} onChange={(e) => setSelectedCartao(e.target.value)}
                className="w-full p-3 border border-neutral-300 rounded-lg bg-white text-neutral-900 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200">
                <option value="">Selecione o cartão...</option>
                {cartoes.map(c => <option key={c.id} value={c.id}>{c.nome} ({c.tipo})</option>)}
              </select>
            </div>
            <MonthPicker 
              value={mesReferencia} 
              onChange={setMesReferencia}
              label="Mês de referência"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-neutral-700">Upload da fatura</label>
            <div className="flex gap-2 mb-2">
              <span className="px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs rounded font-medium">
                .OFX (Recomendado - sem IA)
              </span>
              <span className="px-2 py-1 bg-amber-50 text-amber-700 border border-amber-200 text-xs rounded font-medium">
                .PDF (usa IA se necessário)
              </span>
            </div>
            <p className="text-xs text-neutral-500 mb-2">
              Suporta faturas de Nubank, Itau, Santander, C6 Bank, Mercado Pago, PicPay, Renner, XP e outros bancos brasileiros.
            </p>
            <input
              type="file"
              accept=".pdf,.ofx,.qfx"
              onChange={handleFileChange}
              className="w-full p-2 border border-neutral-300 rounded-lg bg-white text-neutral-700 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-neutral-100 file:text-neutral-700 hover:file:bg-neutral-200"
            />
            {pdfFile && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="text-emerald-600 text-sm">Arquivo selecionado: {pdfFile.name}</span>
                {tipoArquivo === 'ofx' || tipoArquivo === 'qfx' ? (
                  <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs rounded font-medium">
                    Parser determinístico
                  </span>
                ) : (
                  <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 text-xs rounded font-medium">
                    Parser + IA fallback
                  </span>
                )}
              </div>
            )}
          </div>

          <button
            onClick={handleProcessar}
            disabled={loading || !selectedCartao || !mesReferencia || !pdfFile}
            className="px-6 py-3 bg-neutral-900 text-white rounded-lg hover:bg-neutral-800 disabled:opacity-50 font-medium transition-colors"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></span>
                {tipoArquivo === 'ofx' || tipoArquivo === 'qfx' ? 'Processando OFX...' : 'Processando PDF...'}
              </span>
            ) : (
              'Processar e categorizar'
            )}
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-neutral-200 p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm text-neutral-500">{transactions.length} transacoes encontradas</p>
                {metodoProcessamento === 'OFX_PARSER' && (
                  <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs rounded font-medium">
                    OFX
                  </span>
                )}
                {metodoProcessamento === 'PARSER_DETERMINISTICO' && (
                  <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs rounded font-medium">
                    Parser
                  </span>
                )}
                {metodoProcessamento === 'IA_PDF' && (
                  <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 text-xs rounded font-medium">
                    IA
                  </span>
                )}
              </div>
              <p className="font-semibold text-neutral-900">
                <span className="text-emerald-600">PJ: R$ {totalPJ.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                <span className="text-neutral-300 mx-2">|</span>
                <span className="text-rose-600">PF: R$ {totalPF.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
              </p>
            </div>
            <button onClick={() => setStep(1)} className="text-neutral-500 hover:text-neutral-900 text-sm">← Voltar</button>
          </div>

          <div className="bg-white rounded-lg border border-neutral-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-200">
                <tr>
                  <th className="p-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Data</th>
                  <th className="p-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Descricao</th>
                  <th className="p-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Categoria</th>
                  <th className="p-3 text-center text-xs font-medium text-neutral-500 uppercase tracking-wider">Tipo</th>
                  <th className="p-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {transactions.map(t => (
                  <tr key={t.id} className={`hover:bg-neutral-50 ${t.tipo === 'PF' ? 'bg-rose-50/30' : ''}`}>
                    <td className="p-3 font-mono text-xs text-neutral-600">{t.data ? new Date(t.data + 'T12:00:00').toLocaleDateString('pt-BR') : '-'}</td>
                    <td className="p-3 max-w-xs truncate text-neutral-900" title={t.descricao}>{t.descricao}</td>
                    <td className="p-3">
                      <select value={t.categoria} onChange={(e) => updateTransaction(t.id, 'categoria', e.target.value)}
                        className={`px-2 py-1 rounded text-xs font-medium ${CATEGORY_COLORS[t.categoria] || 'bg-neutral-100 text-neutral-600'}`}>
                        {categorias.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                      </select>
                    </td>
                    <td className="p-3 text-center">
                      <select value={t.tipo} onChange={(e) => updateTransaction(t.id, 'tipo', e.target.value)}
                        className={`px-2 py-0.5 rounded text-xs font-medium ${t.tipo === 'PJ' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-600 border border-rose-200'}`}>
                        <option value="PJ">PJ</option>
                        <option value="PF">PF</option>
                      </select>
                    </td>
                    <td className="p-3 text-right font-mono font-medium text-neutral-900">R$ {t.valor.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button onClick={handleSalvar} disabled={saving}
            className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 font-medium transition-colors">
            {saving ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></span>
                Salvando...
              </span>
            ) : 'Salvar fatura'}
          </button>
        </div>
      )}
    </div>
  )
}
