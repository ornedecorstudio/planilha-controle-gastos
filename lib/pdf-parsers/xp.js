/**
 * Parser de Fatura XP Investimentos — v2 metadata-only
 *
 * Características do PDF XP:
 * - Cartão premium (Visa Infinite)
 * - MÚLTIPLAS moedas: EUR, USD, BRL
 * - Muitas páginas com transações detalhadas
 * - Transações internacionais com conversão EUR/USD→BRL
 * - Pode ter múltiplos cartões (titular + adicionais)
 * - IOF aparece em linha separada
 * - Valores negativos = estornos/reembolsos (ex: "SHOTGUN* MAMBA NEGRA -110,95")
 *
 * NOTA: O texto extraído por pdf-parse é inconsistente para faturas XP
 * (datas inválidas, valores duplicados, layout misto não-parseável).
 * Por isso, este parser extrai apenas metadados (total, cartões, subtotais)
 * e sinaliza confianca_texto='baixa' para que a IA visual processe
 * as transações a partir das imagens do PDF.
 */

import { parseValorBR } from './index.js';

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
  // v2: metadata-only — transações serão extraídas pela IA visual
  const totalFaturaPDF = extrairTotalFaturaPDF(texto);
  const cartoesDetectados = extrairCartoes(texto);
  const subtotais = extrairSubtotais(texto);

  console.log(`[XP Parser] Modo metadata-only (IA visual obrigatória)`);
  console.log(`[XP Parser] Total fatura PDF: ${totalFaturaPDF}`);
  console.log(`[XP Parser] Cartões: ${JSON.stringify(cartoesDetectados)}`);
  console.log(`[XP Parser] Subtotais: ${JSON.stringify(subtotais)}`);

  return {
    transacoes: [],
    total_encontrado: 0,
    valor_total: 0,
    banco_detectado: 'XP Investimentos',
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
      reconciliado: false,
      diferenca_centavos: null,
      equacao: 'Parser XP v2: metadados-only, transações via IA visual',
      subtotais_pdf: subtotais
    },
    metadados_verificacao: {
      total_fatura_pdf: totalFaturaPDF,
      subtotais,
      cartoes: cartoesDetectados
    }
  };
}
