'use client';

import { useState } from 'react';

const CATEGORIAS = [
  'Marketing Digital',
  'Pagamento Fornecedores', 
  'Taxas Checkout',
  'Compra de Câmbio',
  'IA e Automação',
  'Design/Ferramentas',
  'Telefonia',
  'ERP',
  'Gestão',
  'Viagem Trabalho',
  'Pessoal',
  'Outros'
];

const ORIGENS = [
  'Amex 2483', 'XP 9560', 'XP Investimentos', 'Unique MC 4724', 'Unique Visa 6910',
  'Gol Smiles 8172', 'Elite 7197', 'Nubank 1056', 'Latam 1643',
  'C6 5839', 'C6 8231', 'C6 8384 ORNE', 'C6 8194 ORNE', 'Azul Itaú 4626', 'MP 5415',
  'Transferência PJ', 'PIX PJ', 'Boleto PJ'
];

const CATEGORY_COLORS = {
  'Marketing Digital': 'bg-blue-100 text-blue-800 border-blue-300',
  'Pagamento Fornecedores': 'bg-purple-100 text-purple-800 border-purple-300',
  'Taxas Checkout': 'bg-yellow-100 text-yellow-800 border-yellow-300',
  'Compra de Câmbio': 'bg-green-100 text-green-800 border-green-300',
  'IA e Automação': 'bg-indigo-100 text-indigo-800 border-indigo-300',
  'Design/Ferramentas': 'bg-violet-100 text-violet-800 border-violet-300',
  'Telefonia': 'bg-pink-100 text-pink-800 border-pink-300',
  'ERP': 'bg-orange-100 text-orange-800 border-orange-300',
  'Gestão': 'bg-teal-100 text-teal-800 border-teal-300',
  'Viagem Trabalho': 'bg-cyan-100 text-cyan-800 border-cyan-300',
  'Pessoal': 'bg-red-100 text-red-800 border-red-300',
  'Outros': 'bg-gray-100 text-gray-800 border-gray-300'
};

export default function Home() {
  const [step, setStep] = useState(1);
  const [rawData, setRawData] = useState('');
  const [transactions, setTransactions] = useState([]);
  const [aggregatedData, setAggregatedData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedOrigem, setSelectedOrigem] = useState('');
  const [pdfFile, setPdfFile] = useState(null);
  const [mesAnoVencimento, setMesAnoVencimento] = useState(''); // Formato: MM/YYYY (ex: 01/2026)

  // Parser melhorado para diferentes formatos de fatura
  // mesAnoVenc é o mês/ano de vencimento da fatura (ex: "01/2026")
  // Usado para calcular o ano correto de cada transação
  const parseData = (text, mesAnoVenc = null) => {
    const lines = text.trim().split('\n').filter(line => line.trim());
    const parsed = [];
    
    // Extrair mês e ano de vencimento para cálculo inteligente
    let mesVencimento = null;
    let anoVencimento = null;
    
    if (mesAnoVenc && mesAnoVenc.includes('/')) {
      const [mes, ano] = mesAnoVenc.split('/');
      mesVencimento = parseInt(mes);
      anoVencimento = parseInt(ano);
    }
    
    // Função para calcular o ano correto da transação
    const calcularAnoTransacao = (mesTransacao) => {
      if (!mesVencimento || !anoVencimento) return null;
      
      // Se o mês da transação é maior que o mês de vencimento,
      // a transação é do ano anterior
      // Ex: Fatura vence em 01/2026, transação de 12 → 12/2025
      // Ex: Fatura vence em 01/2026, transação de 01 → 01/2026
      if (mesTransacao > mesVencimento) {
        return anoVencimento - 1;
      }
      return anoVencimento;
    };
    
    // Detectar se é formato Nubank (primeira linha é cabeçalho "date,title,amount")
    const isNubank = lines[0]?.toLowerCase().includes('date,title,amount') || 
                     lines[0]?.toLowerCase() === 'date,title,amount';
    
    // Detectar se é formato C6 Bank (cabeçalho com "Data de Compra" e "Valor (em R$)")
    const isC6 = lines[0]?.toLowerCase().includes('data de compra') && 
                 lines[0]?.toLowerCase().includes('valor (em r$)');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Ignorar cabeçalhos conhecidos
      if (line.toLowerCase().includes('date,title,amount')) continue;
      if (line.toLowerCase().includes('data de compra') && line.toLowerCase().includes('valor')) continue;
      if (line.toLowerCase().includes('data') && line.toLowerCase().includes('estabelecimento')) continue;
      if (line.toLowerCase().includes('data') && line.toLowerCase().includes('valor')) continue;
      
      let data = null;
      let descricao = null;
      let valor = null;
      
      // FORMATO C6 BANK: TABs com estrutura específica
      // "29/03/2025	ORNE D S LTDA	8384	TV por assinatura	ALIEXPRESS	Única	0	0	161.19"
      // Colunas: Data | Nome | Final | Categoria | Descrição | Parcela | US$ | Cotação | R$
      if (isC6 && line.includes('\t')) {
        const parts = line.split('\t');
        if (parts.length >= 9) {
          // Data na coluna 0 (DD/MM/YYYY)
          const dataMatch = parts[0].match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (dataMatch) {
            data = parts[0]; // Já está no formato DD/MM/YYYY
          }
          
          // Descrição na coluna 4
          descricao = parts[4]?.trim();
          
          // Valor em R$ na coluna 8 (última)
          const valorStr = parts[8]?.replace(',', '.').replace(/[^\d.-]/g, '');
          valor = parseFloat(valorStr);
        }
      }
      // FORMATO NUBANK: CSV com vírgula - "2025-12-14,Facebk *F3bzg8rbd2,153.27"
      // Data em formato ISO (YYYY-MM-DD), valor com ponto decimal
      else if (isNubank || line.match(/^\d{4}-\d{2}-\d{2},/)) {
        const parts = line.split(',');
        if (parts.length >= 3) {
          // Extrair data ISO e converter para DD/MM/YYYY (preservando o ano!)
          const dataMatch = parts[0].match(/(\d{4})-(\d{2})-(\d{2})/);
          if (dataMatch) {
            const [, ano, mes, dia] = dataMatch;
            data = `${dia}/${mes}/${ano}`; // Converte YYYY-MM-DD para DD/MM/YYYY
          }
          
          descricao = parts[1]?.trim();
          
          // Valor já vem com ponto decimal no Nubank
          valor = parseFloat(parts[2]);
        }
      }
      // FORMATO XP: CSV com TABs - "01/11/2025	FACEBK *9NR764ZBD2	ERICK B SOUZA	R$ 156,20	-"
      else if (line.includes('\t')) {
        const parts = line.split('\t');
        if (parts.length >= 4) {
          // Extrair data (DD/MM/YYYY ou DD/MM/YY ou DD/MM)
          const dataMatch = parts[0].match(/(\d{2}\/\d{2}(?:\/\d{2,4})?)/);
          if (dataMatch) {
            data = dataMatch[1];
            // Converter ano de 2 dígitos para 4 dígitos (25 -> 2025)
            if (data.length === 8) { // DD/MM/YY
              const partes = data.split('/');
              const anoCompleto = parseInt(partes[2]) > 50 ? `19${partes[2]}` : `20${partes[2]}`;
              data = `${partes[0]}/${partes[1]}/${anoCompleto}`;
            }
            // Se tiver ano completo (DD/MM/YYYY), mantém como está
            // Se não tiver ano (DD/MM), mantém como está para usar o ano manual depois
          }
          
          descricao = parts[1]?.trim();
          
          // Extrair valor - pode estar em várias posições
          for (let j = 2; j < parts.length; j++) {
            const valorStr = parts[j];
            // Procurar padrão de valor: R$ xxx,xx ou só xxx,xx
            const valorMatch = valorStr.match(/R?\$?\s*([-]?[\d.,]+)/);
            if (valorMatch) {
              let v = valorMatch[1].replace(/\./g, '').replace(',', '.');
              valor = parseFloat(v);
              if (!isNaN(valor) && Math.abs(valor) > 0.01) break;
            }
          }
        }
      }
      // FORMATO TEXTO/MERCADO PAGO PDF: "17/12 PAYPAL *FACEBOOKSER R$ 2.537,17"
      // ou "06/01/2025 FACEBK *MQ5BKB9CD2SAO P 171,14 serviços"
      else if (line.match(/^\d{2}\/\d{2}/)) {
        // Tentar extrair: Data + Descrição + Valor (R$ no final)
        // Formato Mercado Pago: "17/12 PAYPAL *FACEBOOKSER R$ 2.537,17"
        const matchMP = line.match(/^(\d{2}\/\d{2}(?:\/\d{2,4})?)\s+(.+?)\s+(?:R\$|\$4)\s*([\d.,]+)$/i);
        if (matchMP) {
          data = matchMP[1];
          descricao = matchMP[2].trim();
          // Limpar valor: remover pontos de milhar, trocar vírgula por ponto
          let valorStr = matchMP[3].replace(/\./g, '').replace(',', '.').replace('J', '.');
          valor = parseFloat(valorStr);
        } else {
          // Tentar formato genérico: "06/01 FACEBK 171,14 serviços"
          const match = line.match(/(\d{2}\/\d{2}(?:\/\d{2,4})?)\s+(.+?)\s+([\d.,]+)\s*(?:serviços|viagem|compras|outros|pagamento)?/i);
          if (match) {
            data = match[1];
            descricao = match[2].trim();
            valor = parseFloat(match[3].replace(/\./g, '').replace(',', '.'));
          }
        }
        
        // Processar ano na data
        if (data) {
          if (data.length === 8) { // DD/MM/YY
            const partes = data.split('/');
            const anoCompleto = parseInt(partes[2]) > 50 ? `19${partes[2]}` : `20${partes[2]}`;
            data = `${partes[0]}/${partes[1]}/${anoCompleto}`;
          } else if (data.length === 5 && mesVencimento && anoVencimento) { // DD/MM sem ano
            // Calcular ano inteligentemente baseado no mês de vencimento
            const mesTransacao = parseInt(data.substring(3, 5));
            const anoCalculado = calcularAnoTransacao(mesTransacao);
            data = `${data}/${anoCalculado}`;
          }
        }
      }
      // FORMATO CSV com ; - "01/11;FACEBK *XXX;156,20"
      else if (line.includes(';')) {
        const parts = line.split(';');
        if (parts.length >= 3) {
          const dataMatch = parts[0].match(/(\d{2}\/\d{2})/);
          if (dataMatch) {
            data = dataMatch[1];
            // Adicionar ano calculado inteligentemente
            if (data.length === 5 && mesVencimento && anoVencimento) {
              const mesTransacao = parseInt(data.substring(3, 5));
              const anoCalculado = calcularAnoTransacao(mesTransacao);
              data = `${data}/${anoCalculado}`;
            }
            descricao = parts[1]?.trim();
            valor = parseFloat(parts[2].replace(/[^\d,.-]/g, '').replace(',', '.'));
          }
        }
      }

      // Validar e adicionar
      if (data && descricao && valor !== null && !isNaN(valor)) {
        // Ignorar valores negativos (são estornos/pagamentos)
        if (valor < 0) continue;
        // Ignorar valores muito pequenos
        if (valor < 0.01) continue;
        
        parsed.push({
          id: Math.random().toString(36).substr(2, 9),
          data: data,
          descricao: descricao.trim(),
          valor: Math.abs(valor),
          categoria: '',
          incluir: true
        });
      }
    }
    return parsed;
  };

  const handleProcessar = async () => {
    // Verificar se tem dados (texto ou PDF)
    if (!rawData.trim() && !pdfFile) {
      setError('Cole os dados da fatura ou faça upload de um PDF');
      return;
    }
    if (!selectedOrigem) {
      setError('Selecione o cartão de origem');
      return;
    }

    setError('');
    setLoading(true);

    let textToProcess = rawData;

    // Se tiver PDF, extrair texto primeiro
    if (pdfFile) {
      try {
        const formData = new FormData();
        formData.append('pdf', pdfFile);
        
        const pdfResponse = await fetch('/api/parse-pdf', {
          method: 'POST',
          body: formData
        });
        
        if (!pdfResponse.ok) {
          throw new Error('Erro ao processar PDF');
        }
        
        const pdfResult = await pdfResponse.json();
        
        if (pdfResult.error) {
          throw new Error(pdfResult.error);
        }
        
        textToProcess = pdfResult.text || '';
        console.log('Texto extraído do PDF:', textToProcess.substring(0, 500));
      } catch (pdfError) {
        setError(`Erro ao processar PDF: ${pdfError.message}`);
        setLoading(false);
        return;
      }
    }

    // Validar mês/ano de vencimento para PDFs
    if (pdfFile && !mesAnoVencimento) {
      setError('Para PDFs, informe o mês/ano de vencimento (ex: 01/2026)');
      setLoading(false);
      return;
    }
    
    // Validar formato MM/YYYY
    if (pdfFile && mesAnoVencimento && !/^\d{2}\/\d{4}$/.test(mesAnoVencimento)) {
      setError('Formato inválido. Use MM/YYYY (ex: 01/2026)');
      setLoading(false);
      return;
    }

    const parsed = parseData(textToProcess, mesAnoVencimento || null);
    
    if (parsed.length === 0) {
      setError('Não foi possível extrair transações. Verifique o formato dos dados.');
      setLoading(false);
      return;
    }

    try {
      // Chamar API de categorização
      const response = await fetch('/api/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transacoes: parsed })
      });

      const result = await response.json();
      
      // Mostrar estatísticas se disponíveis
      if (result.stats) {
        console.log(`Categorização: ${result.stats.automaticos} automáticas, ${result.stats.analisadosIA} pela IA`);
      }
      
      if (result.resultados && result.resultados.length > 0) {
        const categorizados = parsed.map((t, i) => ({
          ...t,
          categoria: result.resultados[i]?.categoria || 'Outros',
          incluir: result.resultados[i]?.incluir !== false
        }));
        setTransactions(categorizados);
      } else {
        // Fallback: manter sem categoria
        setTransactions(parsed.map(t => ({ ...t, categoria: 'Outros', incluir: false })));
      }
      
      setStep(2);
    } catch (err) {
      console.error('Erro:', err);
      // Em caso de erro, continua com categorização básica
      setTransactions(parsed.map(t => ({ ...t, categoria: 'Outros', incluir: false })));
      setStep(2);
    } finally {
      setLoading(false);
    }
  };

  const handleAgregar = () => {
    const grupos = {};
    
    // Verificar se há transações sem ano completo
    const transacoesSemAno = transactions.filter(t => t.incluir && t.data.length === 5);
    if (transacoesSemAno.length > 0) {
      setError(`${transacoesSemAno.length} transação(ões) sem ano completo. Verifique o formato do CSV.`);
      return;
    }
    
    transactions
      .filter(t => t.incluir)
      .forEach(t => {
        // Normalizar data para agrupamento (apenas DD/MM)
        const dataParaGrupo = t.data.substring(0, 5);
        const key = `${dataParaGrupo}_${t.categoria}`;
        if (!grupos[key]) {
          grupos[key] = {
            data: t.data, // Preserva a data original completa com ano
            categoria: t.categoria,
            valor: 0,
            qtd: 0,
            descricoes: []
          };
        }
        grupos[key].valor += t.valor;
        grupos[key].qtd += 1;
        grupos[key].descricoes.push(t.descricao);
      });

    const agregados = Object.values(grupos)
      .map(g => ({
        id: Math.random().toString(36).substr(2, 9),
        data: g.data, // Usa a data completa do CSV (DD/MM/YYYY)
        categoria: g.categoria,
        detalhe: g.qtd > 1 ? `${g.categoria} (${g.qtd} transações)` : g.descricoes[0].substring(0, 50),
        origem: selectedOrigem,
        valor: g.valor,
        obs: g.qtd > 1 ? `Agregado: ${g.qtd} lançamentos` : ''
      }))
      .sort((a, b) => {
        // Ordenar por data corretamente (converter DD/MM/YYYY para comparação)
        const [diaA, mesA, anoA] = a.data.split('/');
        const [diaB, mesB, anoB] = b.data.split('/');
        const dateA = new Date(anoA, mesA - 1, diaA);
        const dateB = new Date(anoB, mesB - 1, diaB);
        return dateA - dateB;
      });

    setAggregatedData(agregados);
    setStep(3);
  };

  const handleEnviarParaPlanilha = async () => {
    setSending(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dados: aggregatedData,
          sheetName: 'Movimentação'
        })
      });

      const result = await response.json();

      if (result.success) {
        setSuccess(`✅ ${result.message}`);
        // Limpar após sucesso
        setTimeout(() => {
          setStep(1);
          setRawData('');
          setTransactions([]);
          setAggregatedData([]);
          setSuccess('');
        }, 3000);
      } else {
        // Mostrar erro detalhado
        const errorMsg = result.details 
          ? `${result.error}: ${result.details}`
          : result.error || 'Erro desconhecido';
        setError(errorMsg);
      }
    } catch (err) {
      setError(`Erro de conexão: ${err.message}. Tente novamente.`);
    } finally {
      setSending(false);
    }
  };

  const handleExportCSV = () => {
    const header = 'DATA,CATEGORIA,DETALHE,ORIGEM,VALOR,OBS';
    const rows = aggregatedData.map(r => 
      `${r.data},"${r.categoria}","${r.detalhe}","${r.origem}",${r.valor.toFixed(2)},"${r.obs}"`
    );
    const csv = [header, ...rows].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `movimentacao_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const toggleIncluir = (id) => {
    setTransactions(prev => prev.map(t => 
      t.id === id ? { ...t, incluir: !t.incluir } : t
    ));
  };

  const updateCategoria = (id, categoria) => {
    setTransactions(prev => prev.map(t =>
      t.id === id ? { ...t, categoria } : t
    ));
  };

  const updateAggregated = (id, field, value) => {
    setAggregatedData(prev => prev.map(r =>
      r.id === id ? { ...r, [field]: field === 'valor' ? parseFloat(value) || 0 : value } : r
    ));
  };

  const totalSelecionado = transactions.filter(t => t.incluir).reduce((acc, t) => acc + t.valor, 0);
  const totalAgregado = aggregatedData.reduce((acc, r) => acc + r.valor, 0);

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white p-6 rounded-t-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-500 rounded-lg flex items-center justify-center font-bold text-xl">O</div>
            <div>
              <h1 className="text-2xl font-bold">ORNE - Categorizador de Faturas</h1>
              <p className="text-slate-300 text-sm">Categorização automática com IA + Integração Google Sheets</p>
            </div>
          </div>
        </div>

        {/* Progress */}
        <div className="bg-white border-b px-6 py-4 flex items-center gap-4">
          {[
            { num: 1, label: 'Upload', icon: '1' },
            { num: 2, label: 'Revisar', icon: '2' },
            { num: 3, label: 'Enviar', icon: '3' }
          ].map((s, i) => (
            <div key={s.num} className="flex items-center gap-2 flex-1">
              <div className={`flex items-center gap-2 ${step >= s.num ? 'text-slate-800' : 'text-gray-400'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all
                  ${step > s.num ? 'bg-green-500 text-white' : step === s.num ? 'bg-amber-500 text-white' : 'bg-gray-200'}`}>
                  {step > s.num ? 'OK' : s.icon}
                </div>
                <span className="font-medium hidden sm:inline">{s.label}</span>
              </div>
              {i < 2 && <div className={`flex-1 h-1 rounded mx-2 ${step > s.num ? 'bg-green-500' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="bg-white p-6 rounded-b-xl shadow-lg">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
              <span>ERRO:</span> {error}
            </div>
          )}
          
          {success && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700">
              {success}
            </div>
          )}

          {/* Step 1: Upload */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Cartão de Origem *
                  </label>
                  <select 
                    value={selectedOrigem}
                    onChange={(e) => setSelectedOrigem(e.target.value)}
                    className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  >
                    <option value="">Selecione o cartão...</option>
                    {ORIGENS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Vencimento da Fatura (para PDFs)
                  </label>
                  <input
                    type="text"
                    value={mesAnoVencimento}
                    onChange={(e) => setMesAnoVencimento(e.target.value)}
                    placeholder="Ex: 01/2026"
                    className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-amber-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">Formato: MM/YYYY (mês de vencimento)</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Upload PDF (Mercado Pago)
                  </label>
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setPdfFile(file);
                        setRawData(''); // Limpar texto se upload PDF
                      }
                    }}
                    className="w-full p-2 border rounded-lg text-sm file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-amber-100 file:text-amber-700 hover:file:bg-amber-200"
                  />
                  {pdfFile && (
                    <div className="flex items-center gap-2 mt-2 text-sm text-green-600">
                      <span>📄</span>
                      <span>{pdfFile.name}</span>
                      <button 
                        onClick={() => setPdfFile(null)} 
                        className="text-red-500 hover:text-red-700"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {!pdfFile && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Cole os dados da fatura (copiados do extrato ou CSV)
                  </label>
                  <textarea
                    value={rawData}
                    onChange={(e) => setRawData(e.target.value)}
                    placeholder={`Cole aqui os dados da fatura. Formatos aceitos:

📱 NUBANK (CSV):
date,title,amount
2025-12-14,Facebk *F3bzg8rbd2,153.27

💳 C6 BANK (CSV com TABs):
Data de Compra	Nome no Cartão	Final	Categoria	Descrição	Parcela	US$	Cotação	R$
05/01/2026	ORNE D S LTDA	8384	Departamento	ALIEXPRESS	Única	28.17	5.72	161.19

💳 XP/OUTROS:
06/01/2025	FACEBK *MQ5BKB9CD2	ERICK	R$ 171,14	-

📄 MERCADO PAGO: Faça upload do PDF da fatura`}
                    className="w-full h-64 p-4 border rounded-lg font-mono text-sm focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              )}

              {pdfFile && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h4 className="font-medium text-blue-800 mb-2">📄 PDF Selecionado: {pdfFile.name}</h4>
                  <p className="text-sm text-blue-600">
                    O PDF será processado automaticamente para extrair as transações.
                    Certifique-se de informar o mês/ano de vencimento acima.
                  </p>
                </div>
              )}

              <button
                onClick={handleProcessar}
                disabled={loading || !selectedOrigem || (!rawData.trim() && !pdfFile) || (pdfFile && !mesAnoVencimento)}
                className="flex items-center justify-center gap-2 w-full md:w-auto px-6 py-3 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
              >
                {loading ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    {pdfFile ? 'Extraindo PDF e Categorizando...' : 'Processando com IA...'}
                  </>
                ) : (
                  <>
                    <span>🤖</span>
                    Processar e Categorizar
                  </>
                )}
              </button>
            </div>
          )}

          {/* Step 2: Review */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-lg">Revise as Categorias</h3>
                  <p className="text-sm text-gray-500">
                    <span className="text-green-600 font-medium">{transactions.filter(t => t.incluir).length} empresariais</span>
                    {' | '}
                    <span className="text-red-500">{transactions.filter(t => !t.incluir).length} pessoais/excluídos</span>
                    {' | '}
                    Total empresarial: <span className="font-bold text-green-600">R$ {totalSelecionado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                  </p>
                </div>
                <button onClick={() => setStep(1)} className="text-sm text-amber-600 hover:underline">
                  ← Voltar
                </button>
              </div>

              {/* Legenda */}
              <div className="flex gap-4 text-xs">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 bg-green-100 border border-green-300 rounded"></div>
                  <span>Empresarial (incluir)</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 bg-red-100 border border-red-300 rounded"></div>
                  <span>Pessoal (excluir)</span>
                </div>
              </div>

              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-3 text-left w-12">✓</th>
                      <th className="p-3 text-left">Data</th>
                      <th className="p-3 text-left">Descrição</th>
                      <th className="p-3 text-left">Categoria</th>
                      <th className="p-3 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map(t => (
                      <tr key={t.id} className={`border-t hover:bg-gray-50 transition-all
                        ${!t.incluir ? 'opacity-50 bg-red-50' : ''}
                        ${t.categoria === 'Pessoal' ? 'bg-red-50' : ''}`}>
                        <td className="p-3">
                          <input
                            type="checkbox"
                            checked={t.incluir}
                            onChange={() => toggleIncluir(t.id)}
                            className="w-4 h-4 rounded accent-amber-500"
                          />
                        </td>
                        <td className="p-3 font-mono text-xs">{t.data}</td>
                        <td className={`p-3 max-w-xs truncate text-xs ${!t.incluir ? 'line-through' : ''}`} title={t.descricao}>
                          {t.descricao}
                          {!t.incluir && <span className="ml-2 text-red-500 text-xs">(excluído)</span>}
                        </td>
                        <td className="p-3">
                          <select
                            value={t.categoria}
                            onChange={(e) => updateCategoria(t.id, e.target.value)}
                            className={`px-2 py-1 rounded text-xs font-medium border ${CATEGORY_COLORS[t.categoria] || 'bg-gray-100'}`}
                          >
                            {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td className={`p-3 text-right font-mono font-medium ${!t.incluir ? 'line-through text-gray-400' : ''}`}>
                          R$ {t.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                onClick={handleAgregar}
                className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
              >
                <span>✅</span>
                Agregar por Dia/Categoria e Continuar
              </button>
            </div>
          )}

          {/* Step 3: Export */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-lg">Dados Agregados - Prontos para Enviar</h3>
                  <p className="text-sm text-gray-500">
                    {aggregatedData.length} lançamentos | 
                    Total: <span className="font-bold text-green-600">R$ {totalAgregado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                  </p>
                </div>
                <button onClick={() => setStep(2)} className="text-sm text-amber-600 hover:underline">
                  ← Voltar
                </button>
              </div>

              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-3 text-left">Data</th>
                      <th className="p-3 text-left">Categoria</th>
                      <th className="p-3 text-left">Detalhe</th>
                      <th className="p-3 text-left">Origem</th>
                      <th className="p-3 text-right">Valor</th>
                      <th className="p-3 text-left">Obs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aggregatedData.map(r => (
                      <tr key={r.id} className="border-t hover:bg-gray-50">
                        <td className="p-3 font-mono text-xs">{r.data}</td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${CATEGORY_COLORS[r.categoria]}`}>
                            {r.categoria}
                          </span>
                        </td>
                        <td className="p-3">
                          <input
                            type="text"
                            value={r.detalhe}
                            onChange={(e) => updateAggregated(r.id, 'detalhe', e.target.value)}
                            className="w-full p-1 border rounded text-xs"
                          />
                        </td>
                        <td className="p-3">
                          <select
                            value={r.origem}
                            onChange={(e) => updateAggregated(r.id, 'origem', e.target.value)}
                            className="p-1 border rounded text-xs"
                          >
                            {ORIGENS.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-green-600">
                          R$ {r.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 text-xs text-gray-500">{r.obs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleEnviarParaPlanilha}
                  disabled={sending}
                  className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
                >
                  {sending ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Enviando...
                    </>
                  ) : (
                    <>
                      <span>📤</span>
                      Enviar para Google Sheets
                    </>
                  )}
                </button>
                
                <button
                  onClick={handleExportCSV}
                  className="flex items-center gap-2 px-6 py-3 bg-slate-600 text-white rounded-lg hover:bg-slate-700 font-medium"
                >
                  <span>💾</span>
                  Baixar CSV
                </button>
                
                <button
                  onClick={() => {
                    setStep(1);
                    setRawData('');
                    setTransactions([]);
                    setAggregatedData([]);
                    setPdfFile(null);
                    setAnoFatura('');
                  }}
                  className="flex items-center gap-2 px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
                >
                  <span>➕</span>
                  Nova Fatura
                </button>
              </div>

              <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <h4 className="font-medium text-amber-900 mb-1">💡 Dica</h4>
                <p className="text-sm text-amber-800">
                  Os dados serão adicionados na aba "Movimentação" da planilha. Você pode editar qualquer campo antes de enviar.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-4 text-sm text-gray-500">
          ORNE Decor Studio Â© {new Date().getFullYear()} | Ferramenta interna
        </div>
      </div>
    </div>
  );
}
