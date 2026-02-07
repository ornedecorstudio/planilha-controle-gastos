/**
 * Parser de Fatura Mercado Pago — v2 (Metadados + IA Visual)
 *
 * Problema central: faturas Mercado Pago frequentemente têm texto corrompido
 * quando extraído pelo pdf-parse. Os caracteres ficam garbled (ex: "zPBE$FíGZESE$$óõ$4"
 * em vez de "MP*ERICKESERRAD"), tornando qualquer regex inútil.
 *
 * Estratégia v2 (metadata-only + IA visual):
 *   1. Extrai metadados confiáveis do texto (total da fatura, vencimento, cartões)
 *   2. NÃO tenta capturar transações (texto pode estar corrompido)
 *   3. SEMPRE retorna confianca_texto: 'baixa' para forçar IA visual
 *   4. IA visual recebe metadados para verificação cruzada
 *   5. IA visual lê o PDF renderizado e extrai transações corretamente
 *
 * Características Mercado Pago:
 * - Layout multi-página (5-10+ páginas)
 * - Seções por cartão: "Cartão Visa [************XXXX]"
 * - Tabela: Data | Movimentações | [Parcela X de Y] | Valor em R$
 * - Linha "Total" ao final de cada seção de cartão
 * - "Movimentações na fatura" = pagamentos da fatura anterior (IGNORAR)
 * - "Tarifa de uso do crédito emergencial" = tarifa do cartão
 * - Mesmo cartão pode aparecer em múltiplas seções/páginas
 */

import { parseValorBR } from './index.js';

/**
 * Detecta se o texto extraído está corrompido/garbled.
 * Heurística: conta caracteres especiais não esperados vs alfanuméricos.
 */
function detectarTextoCorreompido(texto) {
  if (!texto || texto.length < 50) return { corrompido: true, motivo: 'texto muito curto' };

  // Conta caracteres "normais" (letras, números, espaços, pontuação comum)
  const normais = texto.match(/[a-zA-ZÀ-ÿ0-9\s.,;:\/\-()R$%*+@]/g) || [];
  const total = texto.length;
  const percentualNormal = (normais.length / total) * 100;

  // Se menos de 70% do texto é "normal", provavelmente está corrompido
  if (percentualNormal < 70) {
    return {
      corrompido: true,
      percentualNormal: Math.round(percentualNormal),
      motivo: `apenas ${Math.round(percentualNormal)}% caracteres normais`
    };
  }

  return {
    corrompido: false,
    percentualNormal: Math.round(percentualNormal)
  };
}

/**
 * Extrai o total da fatura do texto do PDF MercadoPago.
 * Busca padrões como "Total R$ 12.979,63" no final das seções.
 */
function extrairTotalFaturaPDF(texto) {
  // Padrão 1: "Total" seguido de valor (última ocorrência = total geral)
  const regexTotal = /\bTotal\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  let match;
  let ultimoTotal = null;
  const totais = [];

  while ((match = regexTotal.exec(texto)) !== null) {
    const valor = parseValorBR(match[1]);
    if (valor > 0) {
      totais.push(valor);
      ultimoTotal = valor;
    }
  }

  // Retorna o maior total encontrado (que é o total da fatura)
  if (totais.length > 0) {
    const maiorTotal = Math.max(...totais);
    console.log(`[MercadoPago Parser] Totais encontrados: ${JSON.stringify(totais)}, usando maior: ${maiorTotal}`);
    return maiorTotal;
  }

  return null;
}

/**
 * Extrai a data de vencimento da fatura.
 * Ex: "Vencimento: 20/01/2026"
 */
function extrairVencimento(texto) {
  const regex = /[Vv]encimento[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/;
  const match = regex.exec(texto);
  if (match) return match[1];
  return null;
}

/**
 * Extrai números de cartão (finais) mencionados no PDF.
 * Ex: "Cartão Visa [************5415]"
 */
function extrairCartoes(texto) {
  const cartoes = new Set();

  // Padrão "Cartão Visa [****XXXX]"
  const regexCartao = /Cart[ãa]o\s+\w+\s*\[\*+(\d{4})\]/gi;
  let match;
  while ((match = regexCartao.exec(texto)) !== null) {
    cartoes.add(match[1]);
  }

  // Padrão "final XXXX"
  const regexFinal = /final\s+(\d{4})/gi;
  while ((match = regexFinal.exec(texto)) !== null) {
    cartoes.add(match[1]);
  }

  return [...cartoes];
}

/**
 * Conta quantas seções de cartão existem no PDF.
 */
function contarSecoes(texto) {
  const regexSecao = /Cart[ãa]o\s+\w+\s*\[\*+\d{4}\]/gi;
  const matches = texto.match(regexSecao) || [];
  return matches.length;
}

/**
 * Parser principal MercadoPago — extrai apenas metadados e força IA visual.
 *
 * MercadoPago frequentemente tem texto corrompido pelo pdf-parse,
 * então o parser determinístico NUNCA consegue extrair transações.
 * Esta versão retorna ZERO transações + confianca_texto='baixa' para
 * SEMPRE forçar IA visual, junto com metadados para o prompt da IA.
 */
export function parseMercadoPago(texto) {
  // Detectar corrupção do texto
  const deteccaoCorrupcao = detectarTextoCorreompido(texto);
  console.log(`[MercadoPago Parser] Detecção de corrupção: ${JSON.stringify(deteccaoCorrupcao)}`);

  // Extrair metadados (podem funcionar mesmo com texto parcialmente corrompido)
  const totalFaturaPDF = extrairTotalFaturaPDF(texto);
  const vencimento = extrairVencimento(texto);
  const cartoesDetectados = extrairCartoes(texto);
  const numSecoes = contarSecoes(texto);

  console.log(`[MercadoPago Parser] Total fatura PDF: ${totalFaturaPDF}`);
  console.log(`[MercadoPago Parser] Vencimento: ${vencimento}`);
  console.log(`[MercadoPago Parser] Cartões: ${JSON.stringify(cartoesDetectados)}`);
  console.log(`[MercadoPago Parser] Seções de cartão: ${numSecoes}`);

  // MercadoPago SEMPRE força IA visual (texto frequentemente corrompido)
  console.log('[MercadoPago Parser] Confiança SEMPRE BAIXA: texto pdf-parse não confiável — forçando IA visual');

  return {
    transacoes: [],
    total_encontrado: 0,
    valor_total: 0,
    banco_detectado: 'Mercado Pago',
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
      equacao: 'Parser MercadoPago v2: metadados-only, transações via IA visual',
    },
    metadados_verificacao: {
      total_fatura_pdf: totalFaturaPDF,
      vencimento,
      cartoes: cartoesDetectados,
      num_secoes: numSecoes,
      corrupcao: deteccaoCorrupcao
    }
  };
}
