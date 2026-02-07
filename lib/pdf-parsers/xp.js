/**
 * Parser de Fatura XP Investimentos
 *
 * Características:
 * - Cartão premium (Visa Infinite)
 * - MÚLTIPLAS moedas: EUR, USD, BRL
 * - Muitas páginas com transações detalhadas
 * - Transações internacionais com conversão - usar SEMPRE o valor em BRL
 * - Pode ter múltiplos cartões (titular + adicionais)
 * - IOF aparece em linha separada (incluído como gasto)
 * - Valores negativos = estornos/reembolsos (ex: "SHOTGUN* MAMBA NEGRA -110,95")
 * - "Pagamento de fatura" NÃO é transação (é pagamento do cliente)
 */

import { parseValorBR, parseDataBR, extrairParcela } from './index.js';

/**
 * Extrai o "Total da fatura" do texto do PDF XP.
 *
 * Padrões XP:
 *   "Total da fatura R$ 53.207,40"
 *   "Total a pagar R$ 53.207,40"
 *   "Valor total R$ 53.207,40"
 */
function extrairTotalFaturaPDF(texto) {
  // Padrão 1: "Total da fatura"
  const regexTotal = /TOTAL\s+DA\s+FATURA\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  let match = regexTotal.exec(texto);
  if (match) {
    const valor = parseValorBR(match[1]);
    if (valor >= 100) {
      console.log(`[XP Parser] Total extraído via "Total da fatura": ${valor}`);
      return valor;
    }
  }

  // Padrão 2: "Total a pagar"
  const regexTotalPagar = /TOTAL\s+A\s+PAGAR\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  match = regexTotalPagar.exec(texto);
  if (match) {
    const valor = parseValorBR(match[1]);
    if (valor >= 100) {
      console.log(`[XP Parser] Total extraído via "Total a pagar": ${valor}`);
      return valor;
    }
  }

  // Padrão 3: "Valor total da fatura"
  const regexValorTotal = /VALOR\s+TOTAL\s+(?:DA\s+)?FATURA\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  match = regexValorTotal.exec(texto);
  if (match) {
    const valor = parseValorBR(match[1]);
    if (valor >= 100) {
      console.log(`[XP Parser] Total extraído via "Valor total da fatura": ${valor}`);
      return valor;
    }
  }

  // Padrão 4: "Pagamento total" (fora de contexto de parcelamento)
  const regexPagTotal = /PAGAMENTO\s+TOTAL\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  match = regexPagTotal.exec(texto);
  if (match) {
    const valor = parseValorBR(match[1]);
    if (valor >= 100) {
      console.log(`[XP Parser] Total extraído via "Pagamento total": ${valor}`);
      return valor;
    }
  }

  console.log('[XP Parser] Nenhum total da fatura encontrado');
  return null;
}

/**
 * Extrai números de cartão (últimos 4 dígitos) mencionados no PDF.
 * Padrões XP: "CARTÃO FINAL 9032", "Cartão adicional final 9560"
 */
function extrairCartoes(texto) {
  const cartoes = new Set();

  // Padrão "CARTÃO (ADICIONAL)? (FINAL)? NNNN"
  const regexCartao = /CART[ÃA]O\s+(?:ADICIONAL\s+)?(?:FINAL\s+)?(\d{4})/gi;
  let match;
  while ((match = regexCartao.exec(texto)) !== null) {
    cartoes.add(match[1]);
  }

  // Fallback: "final NNNN"
  const regexFinal = /FINAL\s+(\d{4})/gi;
  while ((match = regexFinal.exec(texto)) !== null) {
    cartoes.add(match[1]);
  }

  return [...cartoes];
}

/**
 * Extrai subtotais por cartão do texto XP.
 * Padrão: "Subtotal cartão final XXXX R$ YYY,YY"
 */
function extrairSubtotais(texto) {
  const subtotais = [];

  const regexSubtotal = /SUBTOTAL[^R\n]*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  let match;
  while ((match = regexSubtotal.exec(texto)) !== null) {
    const valor = parseValorBR(match[1]);
    if (valor > 0) {
      subtotais.push({ descricao: 'Subtotal cartão', valor });
    }
  }

  return subtotais;
}

export function parseXP(texto) {
  const transacoes = [];

  // Detectar ano da fatura
  let anoReferencia = new Date().getFullYear();
  const matchAno = texto.match(/(?:FATURA|VENCIMENTO|FECHAMENTO).*?(\d{4})/i);
  if (matchAno) {
    anoReferencia = parseInt(matchAno[1]);
  }

  // Set para evitar duplicatas
  const transacoesUnicas = new Set();

  // Lista de termos a ignorar
  const ignorar = [
    'PAGAMENTO FATURA',
    'PAGAMENTO RECEBIDO',
    'PAGAMENTO EFETUADO',
    'ANUIDADE',
    'TARIFA',
    'ENCARGO',
    'JUROS MORA',
    'MULTA'
  ];

  // Padrão 1: Transações nacionais - DATA | DESCRIÇÃO | VALOR BRL
  const regexNacional = /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+?)\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/gm;
  let match;

  while ((match = regexNacional.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valor = parseValorBR(match[3]);
    const parcela = extrairParcela(descricao);

    const descUpper = descricao.toUpperCase();

    // Ignora outros termos (IOF é incluído como gasto)
    const deveIgnorar = ignorar.some(termo => descUpper.includes(termo));
    if (deveIgnorar) continue;

    if (data && descricao && valor > 0) {
      const chave = `${data}|${descricao}|${valor.toFixed(2)}`;

      if (!transacoesUnicas.has(chave)) {
        transacoesUnicas.add(chave);
        transacoes.push({ data, descricao, valor, parcela });
      }
    }
  }

  // Padrão 2: Transações internacionais com conversão
  // Formato: DATA | DESCRIÇÃO | USD XX.XX | TAXA | BRL YYY,YY
  // Usar SEMPRE o valor em BRL (último valor)
  const regexInternacional = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+(?:USD|US\$|EUR|€)\s*[\d.,]+\s+[\d.,]+\s+(?:BRL|R\$)\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;

  while ((match = regexInternacional.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    let descricao = match[2].trim();
    const valorBRL = parseValorBR(match[3]);

    const descUpper = descricao.toUpperCase();

    if (data && descricao && valorBRL > 0) {
      const chave = `${data}|${descricao}|${valorBRL.toFixed(2)}`;

      if (!transacoesUnicas.has(chave)) {
        transacoesUnicas.add(chave);
        transacoes.push({
          data,
          descricao,
          valor: valorBRL,
          parcela: null
        });
      }
    }
  }

  // Padrão 3: Formato alternativo XP
  // DATA DESCRIÇÃO VALOR(sem espaço antes do R$)
  const regexAlt = /(\d{1,2}\/\d{1,2})([A-Z][A-Za-z\s\*\-\.]+?)(\d{1,3}(?:\.\d{3})*,\d{2})/g;

  while ((match = regexAlt.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valor = parseValorBR(match[3]);

    const descUpper = descricao.toUpperCase();
    const deveIgnorar = ignorar.some(termo => descUpper.includes(termo));
    if (deveIgnorar) continue;

    // Ignora se descrição for muito curta (provavelmente ruído)
    if (descricao.length < 3) continue;

    if (data && descricao && valor > 0) {
      const chave = `${data}|${descricao}|${valor.toFixed(2)}`;

      if (!transacoesUnicas.has(chave)) {
        transacoesUnicas.add(chave);
        transacoes.push({
          data,
          descricao,
          valor,
          parcela: extrairParcela(descricao)
        });
      }
    }
  }

  // Padrão 4: Seções de cartões adicionais
  const regexCartao = /CART[ÃA]O\s+(?:ADICIONAL\s+)?(?:FINAL\s+)?(\d{4})/gi;
  let posicaoCartao = [];

  while ((match = regexCartao.exec(texto)) !== null) {
    posicaoCartao.push({ index: match.index, final: match[1] });
  }

  // Processa cada seção de cartão
  for (let i = 0; i < posicaoCartao.length; i++) {
    const inicio = posicaoCartao[i].index;
    const fim = posicaoCartao[i + 1]?.index || texto.length;
    const secao = texto.substring(inicio, fim);

    const regexSecao = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g;

    while ((match = regexSecao.exec(secao)) !== null) {
      const data = parseDataBR(match[1], anoReferencia);
      const descricao = match[2].trim();
      const valor = parseValorBR(match[3]);

      const descUpper = descricao.toUpperCase();
      const deveIgnorar = ignorar.some(termo => descUpper.includes(termo));
      if (deveIgnorar) continue;

      if (data && descricao && valor > 0) {
        const chave = `${data}|${descricao}|${valor.toFixed(2)}`;

        if (!transacoesUnicas.has(chave)) {
          transacoesUnicas.add(chave);
          transacoes.push({
            data,
            descricao,
            valor,
            parcela: extrairParcela(descricao)
          });
        }
      }
    }
  }

  const valorTotal = transacoes.reduce((sum, t) => sum + t.valor, 0);

  // Extrair metadados para verificação cruzada (útil quando IA é usada como fallback)
  const totalFaturaPDF = extrairTotalFaturaPDF(texto);
  const cartoesDetectados = extrairCartoes(texto);
  const subtotais = extrairSubtotais(texto);

  console.log(`[XP Parser] Total fatura PDF: ${totalFaturaPDF}`);
  console.log(`[XP Parser] Cartões: ${JSON.stringify(cartoesDetectados)}`);
  console.log(`[XP Parser] Subtotais: ${JSON.stringify(subtotais)}`);
  console.log(`[XP Parser] Transações extraídas: ${transacoes.length}`);

  return {
    transacoes,
    total_encontrado: transacoes.length,
    valor_total: valorTotal,
    banco_detectado: 'XP Investimentos',
    cartoes_detectados: cartoesDetectados,
    resumo_fatura: {
      total_compras: valorTotal,
      iof: 0,
      estornos: 0,
      pagamento_antecipado: 0,
      tarifa_cartao: 0,
      total_fatura_pdf: totalFaturaPDF,
      total_fatura_calculado: valorTotal,
      reconciliado: totalFaturaPDF ? Math.abs(Math.round((totalFaturaPDF - valorTotal) * 100)) <= 1 : null,
      diferenca_centavos: totalFaturaPDF ? Math.round((totalFaturaPDF - valorTotal) * 100) : null,
      equacao: `Parser XP: ${transacoes.length} transações, total ${valorTotal.toFixed(2)}`,
      subtotais_pdf: subtotais
    },
    metadados_verificacao: {
      total_fatura_pdf: totalFaturaPDF,
      subtotais,
      cartoes: cartoesDetectados
    }
  };
}
