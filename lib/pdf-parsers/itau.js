/**
 * Parser de Fatura Itaú — v2 (Híbrido com reconciliação)
 *
 * Problema central: faturas Itaú usam layout de duas colunas no PDF.
 * Quando pdf-parse extrai o texto, as colunas se intercalam, gerando
 * linhas "data descrição valor data descrição valor" que os regexes
 * não capturam corretamente. Resultado: ~40% das transações são perdidas.
 *
 * Estratégia híbrida:
 *   1. Extrai metadados confiáveis do texto (total da fatura, subtotais, IOF)
 *   2. Tenta capturar transações com múltiplos padrões
 *   3. Detecta se o texto está intercalado (duas colunas)
 *   4. Se poucas transações foram capturadas E texto intercalado detectado,
 *      sinaliza `confianca_texto: 'baixa'` para que o pipeline use IA visual
 *   5. Retorna resumo_fatura com reconciliação (mesmo modelo do C6 Bank)
 *
 * Características do Itaú:
 * - Layout 2 colunas (cartão titular à esquerda, adicional à direita)
 * - Seções: "compras e saques", "transações internacionais", "outros lançamentos"
 * - Múltiplos cartões: final XXXX para cada titular
 * - IOF aparece como linha separada ou dentro de "outros lançamentos"
 * - Subtotais por seção: "subtotal R$ X.XXX,XX"
 * - Total da fatura: "total da fatura R$ XX.XXX,XX" ou "total a pagar"
 * - Datas no formato DD/MM (sem ano)
 * - Valores no formato brasileiro: 1.234,56
 */

import { parseValorBR, parseDataBR, extrairParcela } from './index.js';

// Keywords para classificação de tipo_lancamento
const keywordsPagamentoAntecipado = [
  'PAGAMENTO ANTECIPADO',
  'PGTO ANTECIPADO',
  'PAG ANTECIPADO',
  'PAGAMENTO PARCIAL'
];

const keywordsEstorno = [
  'ESTORNO',
  'CREDITO NA FATURA',
  'CREDITO FATURA',
  'DEVOLUCAO',
  'REEMBOLSO',
  'CASHBACK',
  'BONIFICACAO',
  'CREDITO PROMOCIONAL'
];

const keywordsTarifaCartao = [
  'ANUIDADE',
  'TARIFA CARTAO',
  'TARIFA DO CARTAO',
  'TARIFA MENSAL',
  'SEGURO FATURA',
  'FATURA SEGURA',
  'AVAL EMERG',
  'AVALIACAO EMERG'
];

// Termos a ignorar completamente (não geram transação)
const ignorar = [
  'PAGAMENTO FATURA',
  'PAGAMENTO RECEBIDO',
  'PAGAMENTO EFETUADO',
  'DEBITO AUTOMATICO',
  'SALDO ANTERIOR',
  'LIMITE DISPONIVEL',
  'LIMITE TOTAL',
  'TOTAL DA FATURA',
  'TOTAL A PAGAR',
  'SUBTOTAL',
  'VALOR TOTAL'
];

/**
 * Classifica uma descrição de transação em tipo_lancamento.
 * Mesma lógica do C6 Bank.
 */
function classificarTipoLancamento(descUpper) {
  if (keywordsPagamentoAntecipado.some(kw => descUpper.includes(kw))) {
    return 'pagamento_antecipado';
  }
  if (keywordsEstorno.some(kw => descUpper.includes(kw))) {
    return 'estorno';
  }
  if (descUpper.includes('IOF') || descUpper.includes('IMPOSTO OPERACOES FINANCEIRAS')) {
    return 'iof';
  }
  if (keywordsTarifaCartao.some(kw => descUpper.includes(kw))) {
    return 'tarifa_cartao';
  }
  if (ignorar.some(termo => descUpper.includes(termo))) {
    return null; // ignorar
  }
  return 'compra';
}

/**
 * Detecta se o texto extraído pelo pdf-parse está intercalado
 * (layout de duas colunas misturado).
 *
 * Heurística: conta linhas que contêm 2+ padrões de data DD/MM
 * separados por texto/espaço. Se muitas linhas têm isso, o texto
 * está intercalado.
 */
function detectarTextoIntercalado(texto) {
  const linhas = texto.split('\n');
  let linhasComDuasDatas = 0;
  let linhasComUmaData = 0;

  for (const linha of linhas) {
    // Conta quantos padrões DD/MM aparecem na mesma linha
    const datas = linha.match(/\d{1,2}\/\d{1,2}/g);
    if (datas && datas.length >= 2) {
      linhasComDuasDatas++;
    } else if (datas && datas.length === 1) {
      linhasComUmaData++;
    }
  }

  const totalLinhasComData = linhasComDuasDatas + linhasComUmaData;

  // Se mais de 30% das linhas com data têm duas datas, o texto está intercalado
  if (totalLinhasComData > 5 && linhasComDuasDatas / totalLinhasComData > 0.25) {
    return {
      intercalado: true,
      linhasComDuasDatas,
      linhasComUmaData,
      percentual: Math.round((linhasComDuasDatas / totalLinhasComData) * 100)
    };
  }

  return {
    intercalado: false,
    linhasComDuasDatas,
    linhasComUmaData,
    percentual: totalLinhasComData > 0
      ? Math.round((linhasComDuasDatas / totalLinhasComData) * 100)
      : 0
  };
}

/**
 * Extrai o "Total da fatura" do texto do PDF Itaú.
 * Padrões comuns:
 *   "total da fatura R$ 26.395,08"
 *   "TOTAL DA FATURA   R$ 26.395,08"
 *   "Total a pagar  R$ 26.395,08"
 *   "valor total desta fatura: R$ 26.395,08"
 */
function extrairTotalFaturaPDF(texto) {
  const padroes = [
    /TOTAL\s+DA\s+FATURA\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi,
    /TOTAL\s+(?:A\s+)?PAGAR\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi,
    /VALOR\s+TOTAL\s+(?:DESTA\s+)?FATURA\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi,
    /TOTAL\s+GERAL\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi,
  ];

  let maiorValor = null;

  for (const regex of padroes) {
    let match;
    while ((match = regex.exec(texto)) !== null) {
      const valor = parseValorBR(match[1]);
      if (valor > 0 && (maiorValor === null || valor > maiorValor)) {
        maiorValor = valor;
      }
    }
  }

  return maiorValor;
}

/**
 * Extrai subtotais por seção do texto Itaú.
 * Útil como metadado de verificação para a IA.
 *
 * Padrões:
 *   "subtotal R$ 21.120,19"
 *   "subtotal compras e saques R$ 21.120,19"
 *   "Total compras nacionais R$ 21.120,19"
 */
function extrairSubtotais(texto) {
  const subtotais = [];
  const regex = /(?:subtotal|total)\s+(?:de\s+)?(.{0,40}?)\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;

  let match;
  while ((match = regex.exec(texto)) !== null) {
    const descricao = match[1].trim();
    const valor = parseValorBR(match[2]);
    if (valor > 0) {
      subtotais.push({ descricao, valor });
    }
  }

  return subtotais;
}

/**
 * Extrai números de cartão (finais) mencionados no PDF
 * Ex: "cartão final 1643", "FINAL 7770"
 */
function extrairCartoes(texto) {
  const cartoes = new Set();
  const regex = /(?:CART[ÃA]O\s+)?FINAL\s+(\d{4})/gi;
  let match;
  while ((match = regex.exec(texto)) !== null) {
    cartoes.add(match[1]);
  }
  return [...cartoes];
}

export function parseItau(texto) {
  const transacoes = [];

  // Detectar ano da fatura
  let anoReferencia = new Date().getFullYear();
  const matchAno = texto.match(/(?:FATURA|VENCIMENTO|FECHAMENTO).*?(\d{4})/i);
  if (matchAno) {
    anoReferencia = parseInt(matchAno[1]);
  }

  // Set para evitar duplicatas
  const transacoesUnicas = new Set();

  // Detectar texto intercalado
  const deteccaoIntercalado = detectarTextoIntercalado(texto);
  console.log(`[Itaú Parser] Detecção de intercalação: ${JSON.stringify(deteccaoIntercalado)}`);

  // Extrair metadados confiáveis (funcionam mesmo com texto intercalado)
  const totalFaturaPDF = extrairTotalFaturaPDF(texto);
  const subtotais = extrairSubtotais(texto);
  const cartoesDetectados = extrairCartoes(texto);

  console.log(`[Itaú Parser] Total fatura PDF: ${totalFaturaPDF}`);
  console.log(`[Itaú Parser] Subtotais: ${JSON.stringify(subtotais)}`);
  console.log(`[Itaú Parser] Cartões: ${JSON.stringify(cartoesDetectados)}`);

  /**
   * Tenta adicionar uma transação à lista.
   */
  function adicionarTransacao(data, descricao, valor, parcela) {
    if (!data || !descricao || valor <= 0) return false;

    const descUpper = descricao.toUpperCase();
    const tipoLancamento = classificarTipoLancamento(descUpper);

    if (tipoLancamento === null) return false;

    const chave = `${data}|${descricao}|${valor.toFixed(2)}`;

    if (!transacoesUnicas.has(chave)) {
      transacoesUnicas.add(chave);
      transacoes.push({ data, descricao, valor, parcela, tipo_lancamento: tipoLancamento });
      return true;
    }
    return false;
  }

  // ===== PADRÃO 1: Transações nacionais padrão =====
  // DATA | DESCRIÇÃO | VALOR (fim de linha)
  const regexNacional = /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/gm;
  let match;

  while ((match = regexNacional.exec(texto)) !== null) {
    let valorStr = match[3];
    // Ignora valores negativos (pagamentos, créditos tratados separadamente)
    if (valorStr.startsWith('-')) {
      // Verifica se é estorno — captura como estorno
      const descUpper = match[2].trim().toUpperCase();
      if (keywordsEstorno.some(kw => descUpper.includes(kw))) {
        const data = parseDataBR(match[1], anoReferencia);
        const valor = parseValorBR(valorStr); // Math.abs via parseValorBR
        adicionarTransacao(data, match[2].trim(), valor, null);
      }
      continue;
    }

    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valor = parseValorBR(valorStr);
    const parcela = extrairParcela(descricao);
    adicionarTransacao(data, descricao, valor, parcela);
  }

  // ===== PADRÃO 2: Transações internacionais =====
  // DATA | DESCRIÇÃO | USD XX.XX | BRL YYY,YY  (ou variantes com DÓLAR/Cotação)
  const regexInternacional = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+(?:USD|US\$|DOLAR)\s*[\d.,]+\s+(?:BRL|R\$)\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;

  while ((match = regexInternacional.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valorBRL = parseValorBR(match[3]);
    adicionarTransacao(data, descricao, valorBRL, null);
  }

  // ===== PADRÃO 3: Transações internacionais formato alternativo Itaú =====
  // "DD/MM DESCRIÇÃO                    VALOR_ESTRANGEIRO  VALOR_BRL"
  // onde valor BRL é o último número da linha
  const regexIntAlt = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+(?:[\d.,]+)\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/gm;

  while ((match = regexIntAlt.exec(texto)) !== null) {
    const descricao = match[2].trim();
    // Verifica se parece transação internacional (contém indicadores)
    const descUpper = descricao.toUpperCase();
    if (descUpper.includes('*') || descUpper.includes('COTACAO') ||
        descUpper.includes('DOLAR') || /[A-Z]{2}\s*\*/.test(descricao)) {
      const data = parseDataBR(match[1], anoReferencia);
      const valorBRL = parseValorBR(match[3]);
      adicionarTransacao(data, descricao, valorBRL, extrairParcela(descricao));
    }
  }

  // ===== PADRÃO 4: Seções específicas do Itaú =====
  // "compras e saques", "transações internacionais", "outros lançamentos"
  const secoes = [
    { regex: /(?:compras?\s+e\s+saques?|compras?\s+nacion(?:al|ais))([\s\S]*?)(?=(?:transa[çc][õo]es?\s+internacion|outros\s+lan[çc]amentos|produtos?\s+e\s+servi[çc]os|total\s+da\s+fatura|$))/gi, nome: 'compras_e_saques' },
    { regex: /transa[çc][õo]es?\s+internacion(?:al|ais)([\s\S]*?)(?=(?:outros\s+lan[çc]amentos|produtos?\s+e\s+servi[çc]os|total\s+da\s+fatura|compras?\s+e\s+saques?|$))/gi, nome: 'internacionais' },
    { regex: /outros\s+lan[çc]amentos([\s\S]*?)(?=(?:produtos?\s+e\s+servi[çc]os|total\s+da\s+fatura|compras?\s+e\s+saques?|transa[çc][õo]es?\s+internacion|$))/gi, nome: 'outros_lancamentos' },
  ];

  for (const secao of secoes) {
    let secaoMatch;
    while ((secaoMatch = secao.regex.exec(texto)) !== null) {
      const conteudo = secaoMatch[1];

      // Extrai transações da seção
      const regexItem = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+R?\$?\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/g;

      let itemMatch;
      while ((itemMatch = regexItem.exec(conteudo)) !== null) {
        let valorStr = itemMatch[3];
        // Valores negativos = estornos
        if (valorStr.startsWith('-')) {
          const descUpper = itemMatch[2].trim().toUpperCase();
          if (keywordsEstorno.some(kw => descUpper.includes(kw))) {
            const data = parseDataBR(itemMatch[1], anoReferencia);
            const valor = parseValorBR(valorStr);
            adicionarTransacao(data, itemMatch[2].trim(), valor, null);
          }
          continue;
        }

        const data = parseDataBR(itemMatch[1], anoReferencia);
        const descricao = itemMatch[2].trim();
        const valor = parseValorBR(valorStr);
        adicionarTransacao(data, descricao, valor, extrairParcela(descricao));
      }
    }
  }

  // ===== PADRÃO 5: Linha a linha genérico =====
  // Fallback para capturar transações que os padrões acima podem ter perdido
  const linhas = texto.split('\n').map(l => l.trim()).filter(l => l);

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];

    const matchData = linha.match(/^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+)/);
    if (matchData) {
      const data = parseDataBR(matchData[1], anoReferencia);
      let resto = matchData[2].trim();

      const matchValor = resto.match(/(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/);
      if (matchValor) {
        let valorStr = matchValor[1];
        if (valorStr.startsWith('-')) {
          const descricao = resto.replace(matchValor[0], '').trim();
          const descUpper = descricao.toUpperCase();
          if (keywordsEstorno.some(kw => descUpper.includes(kw))) {
            const valor = parseValorBR(valorStr);
            adicionarTransacao(data, descricao, valor, null);
          }
          continue;
        }

        const valor = parseValorBR(valorStr);
        const descricao = resto.replace(matchValor[0], '').trim();
        adicionarTransacao(data, descricao, valor, extrairParcela(descricao));
      }
    }
  }

  // ===== CALCULAR RESUMO_FATURA COM RECONCILIAÇÃO =====
  const totalCompras = transacoes
    .filter(t => t.tipo_lancamento === 'compra')
    .reduce((sum, t) => sum + t.valor, 0);

  const iof = transacoes
    .filter(t => t.tipo_lancamento === 'iof')
    .reduce((sum, t) => sum + t.valor, 0);

  const estornos = transacoes
    .filter(t => t.tipo_lancamento === 'estorno')
    .reduce((sum, t) => sum + t.valor, 0);

  const pagamentoAntecipado = transacoes
    .filter(t => t.tipo_lancamento === 'pagamento_antecipado')
    .reduce((sum, t) => sum + t.valor, 0);

  const tarifaCartao = transacoes
    .filter(t => t.tipo_lancamento === 'tarifa_cartao')
    .reduce((sum, t) => sum + t.valor, 0);

  const totalFaturaCalculado = parseFloat(
    (totalCompras + iof + tarifaCartao - estornos - pagamentoAntecipado).toFixed(2)
  );

  let reconciliado = null;
  let diferencaCentavos = null;

  if (totalFaturaPDF !== null) {
    diferencaCentavos = Math.round((totalFaturaPDF - totalFaturaCalculado) * 100);
    reconciliado = Math.abs(diferencaCentavos) <= 1; // tolerância 1 centavo
  }

  // Determinar confiança do resultado
  // Se o texto está intercalado e capturamos muito menos do que o total, confiança baixa
  let confiancaTexto = 'alta';
  if (deteccaoIntercalado.intercalado) {
    confiancaTexto = 'baixa';
  } else if (totalFaturaPDF && totalFaturaCalculado < totalFaturaPDF * 0.85) {
    // Capturou menos de 85% do total — algo está faltando
    confiancaTexto = 'baixa';
  }

  const valorTotal = parseFloat(totalCompras.toFixed(2));

  console.log(`[Itaú Parser] Transações capturadas: ${transacoes.length}`);
  console.log(`[Itaú Parser] Total compras: ${totalCompras.toFixed(2)}`);
  console.log(`[Itaú Parser] Total fatura calculado: ${totalFaturaCalculado.toFixed(2)}`);
  console.log(`[Itaú Parser] Total fatura PDF: ${totalFaturaPDF}`);
  console.log(`[Itaú Parser] Reconciliado: ${reconciliado}`);
  console.log(`[Itaú Parser] Confiança: ${confiancaTexto}`);

  return {
    transacoes,
    total_encontrado: transacoes.length,
    valor_total: valorTotal,
    banco_detectado: 'Itaú',
    confianca_texto: confiancaTexto,
    cartoes_detectados: cartoesDetectados,
    resumo_fatura: {
      total_compras: parseFloat(totalCompras.toFixed(2)),
      iof: parseFloat(iof.toFixed(2)),
      estornos: parseFloat(estornos.toFixed(2)),
      pagamento_antecipado: parseFloat(pagamentoAntecipado.toFixed(2)),
      tarifa_cartao: parseFloat(tarifaCartao.toFixed(2)),
      total_fatura_pdf: totalFaturaPDF,
      total_fatura_calculado: totalFaturaCalculado,
      reconciliado,
      diferenca_centavos: diferencaCentavos,
      equacao: `${totalCompras.toFixed(2)} + ${iof.toFixed(2)} + ${tarifaCartao.toFixed(2)} - ${estornos.toFixed(2)} - ${pagamentoAntecipado.toFixed(2)} = ${totalFaturaCalculado.toFixed(2)}`,
      subtotais_pdf: subtotais
    },
    metadados_verificacao: {
      total_fatura_pdf: totalFaturaPDF,
      subtotais,
      cartoes: cartoesDetectados,
      intercalacao: deteccaoIntercalado
    }
  };
}
