/**
 * Parser de Fatura PicPay — v2 (Híbrido com reconciliação)
 *
 * Problema central: faturas PicPay usam layout de duas colunas no PDF.
 * Quando pdf-parse extrai o texto, as colunas se intercalam, gerando
 * linhas "data descrição valor data descrição valor" que os regexes
 * não capturam corretamente. Resultado: valores concatenados (ex: 31.336,78
 * em vez de 1.336,78) e transações fantasma.
 *
 * Estratégia híbrida (mesma do Itaú):
 *   1. Extrai metadados confiáveis do texto (total da fatura, subtotais, cartões)
 *   2. Tenta capturar transações com múltiplos padrões
 *   3. Detecta se o texto está intercalado (duas colunas)
 *   4. Se poucas transações ou texto intercalado,
 *      sinaliza `confianca_texto: 'baixa'` para forçar IA visual
 *   5. Retorna resumo_fatura com reconciliação (mesmo modelo do Itaú/C6 Bank)
 *
 * Características PicPay:
 * - Layout 2 colunas (um cartão à esquerda, outro à direita)
 * - Até 7+ cartões separados (Picpay Card, final 8036, 8051, 0025, 0033, 0041, 0058)
 * - Transações internacionais com conversão USD→BRL
 * - Mastercard BLACK
 * - Valores negativos = estornos/créditos/pagamentos
 * - "PAGAMENTO DE FATURA PELO PICPA" = pagamento da fatura anterior (ignorar)
 * - "IOF COMPRA INTERNACIONAL" = IOF (não é compra de câmbio)
 * - Páginas 9-10: informações financeiras (parcelamento/juros) — NÃO são transações
 * - "Subtotal dos lançamentos" por cartão
 * - "Total geral dos lançamentos" no final
 * - Programa Smiles (ignorar informações de milhas)
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
  'ESTORNO DE ANUIDADE',
  'ESTORNO DE ANUIDADE DIF',
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
  'AJ A DEB TARIFA'
];

// Termos a ignorar completamente (não geram transação)
const ignorar = [
  'PAGAMENTO FATURA',
  'PAGAMENTO RECEBIDO',
  'PAGAMENTO EFETUADO',
  'PAGAMENTO DE FATURA',
  'DEBITO AUTOMATICO',
  'SALDO ANTERIOR',
  'LIMITE DISPONIVEL',
  'LIMITE TOTAL',
  'TOTAL DA FATURA',
  'TOTAL A PAGAR',
  'SUBTOTAL',
  'VALOR TOTAL',
  'TOTAL GERAL',
  'DESPESAS DO MES',
  'CREDITOS E ESTORNOS',
  'SUBTOTAL DOS LANCAMENTOS',
  'FATURA ANTERIOR',
  'PAGAMENTO MINIMO'
];

/**
 * Classifica uma descrição de transação em tipo_lancamento.
 * Mesma lógica do Itaú/C6 Bank.
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
    return null; // ignorar — não gera transação
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
    const datas = linha.match(/\d{1,2}\/\d{1,2}/g);
    if (datas && datas.length >= 2) {
      linhasComDuasDatas++;
    } else if (datas && datas.length === 1) {
      linhasComUmaData++;
    }
  }

  const totalLinhasComData = linhasComDuasDatas + linhasComUmaData;

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
 * Extrai o "Total da fatura" do texto do PDF PicPay.
 *
 * CUIDADO: Faturas PicPay incluem seção de parcelamento/financiamento (págs 9-10)
 * com "Valor total a pagar R$ 124.526,55" que INCLUI juros e IOF de financiamento.
 * O total real é "Total da fatura 109.864,59" na pág. 1.
 *
 * Estratégia:
 *   1. Buscar "Total da fatura" FORA de contexto de parcelamento/financiamento
 *   2. Buscar "Total geral dos lançamentos" (valor bruto de despesas)
 *   3. Retornar o PRIMEIRO match válido fora de contexto financeiro
 */
function extrairTotalFaturaPDF(texto) {
  const textoUpper = texto.toUpperCase();

  const contextosParcelamento = [
    'PARCELA', 'JUROS', 'FINANC', 'CET ', 'A.M.', 'FIXAS',
    'PARCELAMENTO', 'IOF FINANC', 'TAXA DE JUROS',
    'ENCARGOS', 'EM AT', 'VALOR MINIMO', 'SALDO FINANCIADO',
    'CREDITO ROTATIVO'
  ];

  function emContextoParcelamento(posicao) {
    const vizinhanca = textoUpper.substring(
      Math.max(0, posicao - 300),
      Math.min(textoUpper.length, posicao + 100)
    );
    return contextosParcelamento.some(ctx => vizinhanca.includes(ctx));
  }

  // 1. Padrão prioritário: "Total da fatura" (resumo na pág. 1)
  const regexTotal = /TOTAL\s+DA\s+FATURA\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  let match;
  while ((match = regexTotal.exec(texto)) !== null) {
    if (!emContextoParcelamento(match.index)) {
      const valor = parseValorBR(match[1]);
      if (valor > 0) {
        console.log(`[PicPay Parser] Total extraído via "total da fatura": ${valor}`);
        return valor;
      }
    }
  }

  // 2. "Total geral dos lançamentos" (soma bruta das despesas)
  const regexTotalGeral = /TOTAL\s+GERAL\s+DOS\s+LANCAMENTOS\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  match = regexTotalGeral.exec(texto);
  if (match) {
    const valor = parseValorBR(match[1]);
    if (valor > 0) {
      console.log(`[PicPay Parser] Total extraído via "total geral dos lançamentos": ${valor}`);
      return valor;
    }
  }

  // 3. "Pagamento total" fora de contexto de parcelamento
  const regexPagTotal = /PAGAMENTO\s+TOTAL\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  while ((match = regexPagTotal.exec(texto)) !== null) {
    if (!emContextoParcelamento(match.index)) {
      const valor = parseValorBR(match[1]);
      if (valor > 0) {
        console.log(`[PicPay Parser] Total extraído via "pagamento total": ${valor}`);
        return valor;
      }
    }
  }

  // 4. Genérico: "Total a pagar" fora de contexto
  const regexTotalPagar = /TOTAL\s+(?:A\s+)?PAGAR\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  while ((match = regexTotalPagar.exec(texto)) !== null) {
    if (!emContextoParcelamento(match.index)) {
      const valor = parseValorBR(match[1]);
      if (valor > 0) {
        console.log(`[PicPay Parser] Total extraído via "total a pagar": ${valor}`);
        return valor;
      }
    }
  }

  console.log('[PicPay Parser] Nenhum total da fatura encontrado fora de contexto de parcelamento');
  return null;
}

/**
 * Extrai subtotais por seção/cartão do texto PicPay.
 * Útil como metadado de verificação para a IA.
 *
 * Padrões:
 *   "Subtotal dos lançamentos 36.076,65"
 *   "Total geral dos lançamentos 118.485,09"
 */
function extrairSubtotais(texto) {
  const subtotais = [];
  const textoUpper = texto.toUpperCase();

  const contextosParcelamento = [
    'PARCELA', 'JUROS', 'FINANC', 'CET ', 'A.M.', 'FIXAS',
    'PARCELAMENTO', 'IOF FINANC', 'TAXA DE JUROS',
    'ENCARGOS', 'EM AT', 'CREDITO ROTATIVO'
  ];

  function emContextoParcelamento(posicao) {
    const vizinhanca = textoUpper.substring(
      Math.max(0, posicao - 300),
      Math.min(textoUpper.length, posicao + 100)
    );
    return contextosParcelamento.some(ctx => vizinhanca.includes(ctx));
  }

  // Subtotais por cartão
  const regexSubtotal = /SUBTOTAL\s+DOS\s+LANCAMENTOS\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  let match;
  while ((match = regexSubtotal.exec(texto)) !== null) {
    if (emContextoParcelamento(match.index)) {
      console.log(`[PicPay Parser] Subtotal ignorado (contexto parcelamento): ${match[0].trim()}`);
      continue;
    }
    const valor = parseValorBR(match[1]);
    if (valor > 0) {
      subtotais.push({ descricao: 'Subtotal cartão', valor });
    }
  }

  // Total geral
  const regexTotalGeral = /TOTAL\s+GERAL\s+DOS\s+LANCAMENTOS\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  match = regexTotalGeral.exec(texto);
  if (match) {
    const valor = parseValorBR(match[1]);
    if (valor > 0) {
      subtotais.push({ descricao: 'Total geral lançamentos', valor });
    }
  }

  return subtotais;
}

/**
 * Extrai números de cartão (finais) mencionados no PDF.
 * Ex: "Picpay Card final 8036", "final 0025"
 */
function extrairCartoes(texto) {
  const cartoes = new Set();

  // Padrão "final XXXX"
  const regexFinal = /(?:CART[ÃA]O\s+)?FINAL\s+(\d{4})/gi;
  let match;
  while ((match = regexFinal.exec(texto)) !== null) {
    cartoes.add(match[1]);
  }

  // Detectar "Picpay Card" (cartão principal, sem final)
  if (/PICPAY\s+CARD(?!\s+FINAL)/i.test(texto)) {
    cartoes.add('PRINCIPAL');
  }

  return [...cartoes];
}

/**
 * Extrai o valor de "Despesas do mês" do resumo PicPay.
 * Útil para verificação cruzada: despesas_do_mes deve ser ~= total_compras + iof + tarifa
 */
function extrairDespesasDoMes(texto) {
  const regex = /DESPESAS\s+DO\s+MES\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  const match = regex.exec(texto);
  if (match) {
    return parseValorBR(match[1]);
  }
  return null;
}

/**
 * Parser principal PicPay — abordagem híbrida com reconciliação
 */
export function parsePicPay(texto) {
  const transacoes = [];

  // Detectar ano da fatura
  let anoReferencia = new Date().getFullYear();
  const matchAno = texto.match(/(?:FATURA|VENCIMENTO|FECHAMENTO).*?(\d{4})/i);
  if (matchAno) {
    anoReferencia = parseInt(matchAno[1]);
  }

  // Set para evitar duplicatas
  const transacoesUnicas = new Set();

  // Detectar texto intercalado (duas colunas)
  const deteccaoIntercalado = detectarTextoIntercalado(texto);
  console.log(`[PicPay Parser] Detecção de intercalação: ${JSON.stringify(deteccaoIntercalado)}`);

  // Extrair metadados confiáveis (funcionam mesmo com texto intercalado)
  const totalFaturaPDF = extrairTotalFaturaPDF(texto);
  const subtotais = extrairSubtotais(texto);
  const cartoesDetectados = extrairCartoes(texto);
  const despesasDoMes = extrairDespesasDoMes(texto);

  console.log(`[PicPay Parser] Total fatura PDF: ${totalFaturaPDF}`);
  console.log(`[PicPay Parser] Despesas do mês: ${despesasDoMes}`);
  console.log(`[PicPay Parser] Subtotais: ${JSON.stringify(subtotais)}`);
  console.log(`[PicPay Parser] Cartões: ${JSON.stringify(cartoesDetectados)}`);

  /**
   * Tenta adicionar uma transação à lista.
   * @param {boolean} isNegativo - se o valor era negativo no PDF original
   */
  function adicionarTransacao(data, descricao, valor, parcela, isNegativo = false) {
    if (!data || !descricao || valor <= 0) return false;

    const descUpper = descricao.toUpperCase();

    // Filtro PicPay: PAGAMENTO DE FATURA PELO PICPA (e variações)
    if (descUpper.includes('PAGAMENTO') && (descUpper.includes('FATURA') || descUpper.includes('PICPA'))) {
      return false;
    }
    // Qualquer valor negativo com PAGAMENTO é pagamento (não transação)
    if (isNegativo && descUpper.includes('PAGAMENTO')) return false;

    // Filtro Smiles/milhas/bônus
    if (descUpper.includes('SMILES') && descUpper.includes('MILHA')) return false;
    if (descUpper.includes('BONUS') || descUpper.includes('BÔNUS')) return false;

    let tipoLancamento = classificarTipoLancamento(descUpper);

    // Se o valor era negativo no PDF e não foi classificado como estorno, forçar estorno
    if (isNegativo && tipoLancamento === 'compra') {
      tipoLancamento = 'estorno';
    }

    if (tipoLancamento === null) return false;

    // Remove informações de milhas da descrição
    descricao = descricao.replace(/\s*-?\s*\d+\s*MILHAS?/gi, '').trim();

    const chave = `${data}|${descricao}|${valor.toFixed(2)}`;

    if (!transacoesUnicas.has(chave)) {
      transacoesUnicas.add(chave);
      transacoes.push({ data, descricao, valor, parcela, tipo_lancamento: tipoLancamento });
      return true;
    }
    return false;
  }

  // ===== PADRÃO 1: Transações nacionais (fim de linha) =====
  // DATA | DESCRIÇÃO | VALOR (com sinal negativo opcional)
  const regexNacional = /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/gm;
  let match;

  while ((match = regexNacional.exec(texto)) !== null) {
    const valorStr = match[3];
    const isNegativo = valorStr.startsWith('-');

    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valor = parseValorBR(valorStr); // parseValorBR retorna Math.abs
    const parcela = extrairParcela(descricao);

    adicionarTransacao(data, descricao, valor, parcela, isNegativo);
  }

  // ===== PADRÃO 2: Transações internacionais (USD convertido para BRL) =====
  // Formato: "DATA DESCRIÇÃO USD XX.XX BRL YYY,YY"
  const regexInternacional = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+(?:USD|US\$)\s*[\d.,]+\s+(?:BRL|R\$)\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/gi;

  while ((match = regexInternacional.exec(texto)) !== null) {
    const valorStr = match[3];
    const isNegativo = valorStr.startsWith('-');

    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valorBRL = parseValorBR(valorStr);

    adicionarTransacao(data, descricao, valorBRL, null, isNegativo);
  }

  // ===== PADRÃO 3: Por seção de cartão =====
  // Procura por "Picpay Card" / "Card final XXXX" e processa transações abaixo
  const regexCartao = /(?:PICPAY\s+)?CARD\s+(?:FINAL\s+)?(\d{4})?/gi;
  const posicaoCartao = [];

  while ((match = regexCartao.exec(texto)) !== null) {
    posicaoCartao.push(match.index);
  }

  for (let i = 0; i < posicaoCartao.length; i++) {
    const inicio = posicaoCartao[i];
    const fim = posicaoCartao[i + 1] || texto.length;
    const secao = texto.substring(inicio, fim);

    const regexSecao = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/gm;

    while ((match = regexSecao.exec(secao)) !== null) {
      const valorStr = match[3];
      const isNegativo = valorStr.startsWith('-');

      const data = parseDataBR(match[1], anoReferencia);
      const descricao = match[2].trim();
      const valor = parseValorBR(valorStr);

      adicionarTransacao(data, descricao, valor, extrairParcela(descricao), isNegativo);
    }
  }

  // ===== PADRÃO 4: Formato PicPay internacional multi-linha =====
  // Algumas transações internacionais no PicPay vêm em formato multi-linha:
  // DATA\nDESCRIÇÃO\nDólar: XX.XX\nCâmbio do dia: R$ X,XXXX\nVALOR_USD VALOR_BRL
  const regexIntMulti = /(\d{1,2}\/\d{1,2})\s*\n\s*(.+?)\s*\n\s*D[oó]lar:\s*-?[\d.,]+\s*\n\s*C[aâ]mbio\s+do\s+dia:\s*R\$\s*[\d.,]+\s*\n?\s*-?[\d.,]+\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})/gi;

  while ((match = regexIntMulti.exec(texto)) !== null) {
    const valorStr = match[3];
    const isNegativo = valorStr.startsWith('-');

    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valorBRL = parseValorBR(valorStr);

    adicionarTransacao(data, descricao, valorBRL, null, isNegativo);
  }

  // ===== Calcular resumo_fatura =====
  let totalCompras = 0;
  let iof = 0;
  let estornos = 0;
  let pagamentoAntecipado = 0;
  let tarifaCartao = 0;

  for (const t of transacoes) {
    switch (t.tipo_lancamento) {
      case 'compra':
        totalCompras += t.valor;
        break;
      case 'iof':
        iof += t.valor;
        break;
      case 'estorno':
        estornos += t.valor;
        break;
      case 'pagamento_antecipado':
        pagamentoAntecipado += t.valor;
        break;
      case 'tarifa_cartao':
        tarifaCartao += t.valor;
        break;
    }
  }

  // Arredondar para evitar floating point
  totalCompras = parseFloat(totalCompras.toFixed(2));
  iof = parseFloat(iof.toFixed(2));
  estornos = parseFloat(estornos.toFixed(2));
  pagamentoAntecipado = parseFloat(pagamentoAntecipado.toFixed(2));
  tarifaCartao = parseFloat(tarifaCartao.toFixed(2));

  const totalFaturaCalculado = parseFloat(
    (totalCompras + iof + tarifaCartao - estornos - pagamentoAntecipado).toFixed(2)
  );

  // Reconciliação
  let reconciliado = false;
  let diferencaCentavos = null;

  if (totalFaturaPDF) {
    diferencaCentavos = Math.round(Math.abs(totalFaturaCalculado - totalFaturaPDF) * 100);
    reconciliado = diferencaCentavos <= 100; // tolerância de R$ 1,00
  }

  const equacao = `${totalCompras} + ${iof} + ${tarifaCartao} - ${estornos} - ${pagamentoAntecipado} = ${totalFaturaCalculado}`;

  console.log(`[PicPay Parser] Reconciliação: ${equacao}`);
  console.log(`[PicPay Parser] Total PDF: ${totalFaturaPDF}, Calculado: ${totalFaturaCalculado}, Diferença: ${diferencaCentavos} centavos`);

  // ===== Determinar confiança do texto =====
  let confiancaTexto = 'alta';

  if (deteccaoIntercalado.intercalado) {
    confiancaTexto = 'baixa';
    console.log('[PicPay Parser] Confiança BAIXA: texto intercalado detectado');
  } else if (totalFaturaPDF && totalFaturaCalculado < totalFaturaPDF * 0.85) {
    confiancaTexto = 'baixa';
    console.log(`[PicPay Parser] Confiança BAIXA: capturado apenas ${Math.round(totalFaturaCalculado / totalFaturaPDF * 100)}% do total`);
  }

  const valorTotal = parseFloat(totalCompras.toFixed(2));

  return {
    transacoes,
    total_encontrado: transacoes.length,
    valor_total: valorTotal,
    banco_detectado: 'PicPay',
    confianca_texto: confiancaTexto,
    cartoes_detectados: cartoesDetectados,
    resumo_fatura: {
      total_compras: totalCompras,
      iof,
      estornos,
      pagamento_antecipado: pagamentoAntecipado,
      tarifa_cartao: tarifaCartao,
      total_fatura_pdf: totalFaturaPDF,
      total_fatura_calculado: totalFaturaCalculado,
      despesas_do_mes_pdf: despesasDoMes,
      reconciliado,
      diferenca_centavos: diferencaCentavos,
      equacao,
      subtotais_pdf: subtotais
    },
    metadados_verificacao: {
      total_fatura_pdf: totalFaturaPDF,
      despesas_do_mes_pdf: despesasDoMes,
      subtotais,
      cartoes: cartoesDetectados,
      intercalacao: deteccaoIntercalado
    }
  };
}
