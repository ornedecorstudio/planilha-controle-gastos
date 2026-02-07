/**
 * Parser de Fatura PicPay — v3 (Metadados + IA Visual)
 *
 * Problema central: faturas PicPay SEMPRE usam layout de duas colunas no PDF.
 * Quando pdf-parse extrai o texto, as colunas se intercalam, gerando
 * linhas "data descrição valor data descrição valor" que os regexes
 * não capturam corretamente. Resultado: valores concatenados (ex: 31.336,78
 * em vez de 1.336,78) e transações fantasma.
 *
 * Na v2 tentamos 4 padrões de regex que capturaram apenas 4 transações
 * internacionais com valores em USD ao invés de BRL. Conclusão: regex
 * determinístico não funciona para PicPay com layout 2 colunas.
 *
 * Estratégia v3 (metadata-only + IA visual):
 *   1. Extrai metadados confiáveis do texto (total da fatura, subtotais, cartões)
 *   2. NÃO tenta capturar transações (impossível com texto intercalado)
 *   3. SEMPRE retorna confianca_texto: 'baixa' para forçar IA visual
 *   4. IA visual recebe metadados para verificação cruzada
 *   5. IA visual lê o PDF renderizado e extrai transações corretamente
 *
 * Características PicPay:
 * - Layout 2 colunas (um cartão à esquerda, outro à direita) — SEMPRE
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

import { parseValorBR } from './index.js';

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
 * Extrai o valor de "Créditos e estornos" do resumo PicPay.
 */
function extrairCreditosEstornos(texto) {
  const regex = /CR[EÉ]DITOS\s+E\s+ESTORNOS\s*:?\s*-?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  const match = regex.exec(texto);
  if (match) {
    return parseValorBR(match[1]);
  }
  return null;
}

/**
 * Parser principal PicPay — extrai apenas metadados e força IA visual.
 *
 * PicPay SEMPRE usa layout 2 colunas, então o parser determinístico
 * NUNCA conseguirá extrair transações corretamente via regex.
 * Em vez de retornar transações incorretas (v2 retornava 4 com valores USD),
 * esta versão retorna ZERO transações + confianca_texto='baixa' para
 * SEMPRE forçar IA visual, junto com metadados ricos para o prompt da IA.
 */
export function parsePicPay(texto) {
  // Detectar texto intercalado (duas colunas) — para logging
  const deteccaoIntercalado = detectarTextoIntercalado(texto);
  console.log(`[PicPay Parser] Detecção de intercalação: ${JSON.stringify(deteccaoIntercalado)}`);

  // Extrair metadados confiáveis (funcionam mesmo com texto intercalado)
  const totalFaturaPDF = extrairTotalFaturaPDF(texto);
  const subtotais = extrairSubtotais(texto);
  const cartoesDetectados = extrairCartoes(texto);
  const despesasDoMes = extrairDespesasDoMes(texto);
  const creditosEstornos = extrairCreditosEstornos(texto);

  console.log(`[PicPay Parser] Total fatura PDF: ${totalFaturaPDF}`);
  console.log(`[PicPay Parser] Despesas do mês: ${despesasDoMes}`);
  console.log(`[PicPay Parser] Créditos e estornos: ${creditosEstornos}`);
  console.log(`[PicPay Parser] Subtotais: ${JSON.stringify(subtotais)}`);
  console.log(`[PicPay Parser] Cartões: ${JSON.stringify(cartoesDetectados)}`);

  // PicPay SEMPRE tem layout 2 colunas — forçar IA visual
  console.log('[PicPay Parser] Confiança SEMPRE BAIXA: PicPay usa layout 2 colunas — forçando IA visual');

  return {
    transacoes: [],
    total_encontrado: 0,
    valor_total: 0,
    banco_detectado: 'PicPay',
    confianca_texto: 'baixa',
    cartoes_detectados: cartoesDetectados,
    resumo_fatura: {
      total_compras: 0,
      iof: 0,
      estornos: 0,
      pagamento_antecipado: 0,
      tarifa_cartao: 0,
      total_fatura_pdf: totalFaturaPDF,
      total_fatura_calculado: 0,
      despesas_do_mes_pdf: despesasDoMes,
      creditos_estornos_pdf: creditosEstornos,
      reconciliado: false,
      diferenca_centavos: null,
      equacao: 'Parser PicPay v3: metadados-only, transações via IA visual',
      subtotais_pdf: subtotais
    },
    metadados_verificacao: {
      total_fatura_pdf: totalFaturaPDF,
      despesas_do_mes_pdf: despesasDoMes,
      creditos_estornos_pdf: creditosEstornos,
      subtotais,
      cartoes: cartoesDetectados,
      intercalacao: deteccaoIntercalado
    }
  };
}
