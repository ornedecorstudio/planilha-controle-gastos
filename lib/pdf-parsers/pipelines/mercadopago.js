/**
 * Pipeline: Mercado Pago
 *
 * Parser deterministico para faturas de cartao de credito Mercado Pago.
 *
 * Caracteristicas:
 * - Layout mobile/minimalista
 * - Data, descricao e valor podem estar em linhas separadas
 * - Parcelamentos: "Parcela X de Y"
 * - Pode ter multiplos cartoes (fisico, virtual)
 *
 * Interface padrao de pipeline:
 *   extractPipeline(texto, options)  - funcao principal
 *   buildAIPrompt(...)               - retorna null (nao usa IA)
 *   postAICorrections(...)           - passthrough
 */

import { parseValorBR, parseDataBR, extrairParcela, calcularAuditoria } from '../utils.js';

// ===== CONSTANTES =====

export const BANK_ID = 'mercadopago';

/**
 * Descricoes que devem ser completamente ignoradas (nao geram transacao).
 */
const DESCRICOES_IGNORAR = [
  'PAGAMENTO FATURA',
  'PAGAMENTO RECEBIDO',
  'PAGAMENTO EFETUADO',
];

/**
 * Palavras-chave para classificacao de tipo_lancamento.
 */
const KEYWORDS_ESTORNO = [
  'ESTORNO', 'CREDITO NA FATURA', 'CRÉDITO NA FATURA',
  'DEVOLUCAO', 'DEVOLUÇÃO', 'REEMBOLSO', 'CASHBACK', 'BONIFICACAO', 'BONIFICAÇÃO',
];

const KEYWORDS_TARIFA = [
  'ANUIDADE', 'TARIFA', 'SEGURO FATURA',
];

// ===== HELPERS INTERNOS =====

/**
 * Verifica se uma descricao deve ser completamente ignorada.
 */
function deveIgnorar(descricao) {
  const upper = descricao.toUpperCase();
  return DESCRICOES_IGNORAR.some(termo => upper.includes(termo));
}

/**
 * Classifica o tipo_lancamento de uma transacao pela descricao.
 *
 * Ordem de prioridade:
 *   1. IOF
 *   2. Estorno/credito/devolucao
 *   3. Tarifa/anuidade/seguro
 *   4. Pagamento antecipado
 *   5. Compra (default)
 */
function classificarTipo(descricao) {
  const upper = descricao.toUpperCase();

  // IOF
  if (upper.includes('IOF')) {
    return 'iof';
  }

  // Estorno / credito / devolucao / cashback
  if (KEYWORDS_ESTORNO.some(kw => upper.includes(kw))) {
    return 'estorno';
  }

  // Tarifa / anuidade / seguro fatura
  if (KEYWORDS_TARIFA.some(kw => upper.includes(kw))) {
    return 'tarifa_cartao';
  }

  // Pagamento antecipado
  if (upper.includes('PAGAMENTO ANTECIPADO')) {
    return 'pagamento_antecipado';
  }

  return 'compra';
}

/**
 * Extrai o total da fatura do PDF.
 *
 * Padroes reconhecidos:
 *   - "TOTAL DA FATURA R$ X.XXX,XX"
 *   - "Total a pagar R$ X.XXX,XX"
 *   - "Valor total R$ X.XXX,XX"
 */
function extrairTotalFaturaPDF(texto) {
  const padroes = [
    /TOTAL\s+DA\s+FATURA\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i,
    /TOTAL\s+A\s+PAGAR\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i,
    /VALOR\s+TOTAL\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i,
  ];

  for (const regex of padroes) {
    const match = texto.match(regex);
    if (match) {
      const valor = parseValorBR(match[1]);
      if (valor > 0) return valor;
    }
  }

  return null;
}

/**
 * Verifica se uma transacao ja existe no array (deduplicacao).
 */
function jaExiste(transacoes, data, descricao, valor) {
  return transacoes.some(t =>
    t.data === data &&
    t.descricao === descricao &&
    Math.abs(t.valor - valor) < 0.01
  );
}

/**
 * Tenta adicionar uma transacao ao array, aplicando filtros e deduplicacao.
 * Retorna true se adicionou, false se ignorou/duplicada.
 */
function tentarAdicionar(transacoes, data, descricao, valor, anoReferencia) {
  if (!data || !descricao || valor <= 0) return false;

  // Descricoes completamente ignoradas
  if (deveIgnorar(descricao)) return false;

  // Deduplicacao
  if (jaExiste(transacoes, data, descricao, valor)) return false;

  const parcela = extrairParcela(descricao);
  const tipo_lancamento = classificarTipo(descricao);

  transacoes.push({
    data,
    descricao,
    valor,
    parcela,
    tipo_lancamento,
  });

  return true;
}

// ===== PIPELINE PRINCIPAL =====

/**
 * Extrai transacoes de uma fatura Mercado Pago.
 *
 * @param {string} texto - Texto completo extraido do PDF
 * @param {object} [options={}] - Opcoes (nao usadas atualmente)
 * @returns {object} PipelineResult padrao
 */
export function extractPipeline(texto, options = {}) {
  const transacoes = [];
  const linhas = texto.split('\n').map(l => l.trim()).filter(l => l);

  // Detectar ano da fatura
  let anoReferencia = new Date().getFullYear();
  const matchAno = texto.match(/(?:FATURA|VENCIMENTO).*?(\d{4})/i);
  if (matchAno) {
    anoReferencia = parseInt(matchAno[1]);
  }

  // ----- Padrao 1: DATA | DESCRICAO | VALOR em uma linha -----
  const regexCompleto = /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+?)\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  let match;

  while ((match = regexCompleto.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valor = parseValorBR(match[3]);

    tentarAdicionar(transacoes, data, descricao, valor, anoReferencia);
  }

  // ----- Padrao 2: Formato separado por linhas (comum em mobile) -----
  // Linha 1: Data
  // Linha 2: Descricao
  // Linha 3: Valor
  for (let i = 0; i < linhas.length - 2; i++) {
    const linha1 = linhas[i];
    const linha2 = linhas[i + 1];
    const linha3 = linhas[i + 2];

    // linha1 deve ser uma data isolada
    if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(linha1)) {
      // linha3 deve ser um valor monetario isolado
      if (/^R?\$?\s*\d{1,3}(?:\.\d{3})*,\d{2}$/.test(linha3)) {
        const data = parseDataBR(linha1, anoReferencia);
        const descricao = linha2;
        const valor = parseValorBR(linha3);

        if (tentarAdicionar(transacoes, data, descricao, valor, anoReferencia)) {
          i += 2; // Pula linhas ja processadas
        }
      }
    }
  }

  // ----- Padrao 3: Formato com tracos (DD/MM - descricao - R$ valor) -----
  const regexMP = /(\d{1,2}\/\d{1,2})\s*[-\u2013]\s*(.+?)\s*[-\u2013]?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  while ((match = regexMP.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valor = parseValorBR(match[3]);

    tentarAdicionar(transacoes, data, descricao, valor, anoReferencia);
  }

  // ----- Calculos finais -----
  const totalFaturaPDF = extrairTotalFaturaPDF(texto);

  const valorTotalCompras = transacoes
    .filter(t => t.tipo_lancamento === 'compra')
    .reduce((sum, t) => sum + t.valor, 0);

  const auditoria = calcularAuditoria(transacoes, totalFaturaPDF);

  return {
    success: true,
    transacoes,
    total_encontrado: transacoes.length,
    valor_total: parseFloat(valorTotalCompras.toFixed(2)),
    banco_detectado: 'Mercado Pago',
    metodo: 'PARSER_DETERMINISTICO',
    auditoria,
    needsAI: false,
    metadados_verificacao: {
      total_fatura_pdf: totalFaturaPDF,
      ano_referencia: anoReferencia,
      padroes_encontrados: {
        padrao1_inline: transacoes.length, // approximate, overlaps possible
      },
    },
  };
}

// ===== INTERFACE IA (nao utilizada) =====

/**
 * Mercado Pago nao precisa de IA - retorna null.
 */
export function buildAIPrompt(_cartaoNome, _tipoCartao, _metadados) {
  return null;
}

/**
 * Passthrough - nenhuma correcao pos-IA necessaria.
 */
export function postAICorrections(transacoes, _metadados) {
  return transacoes;
}

// ===== BACKWARD COMPAT =====

/**
 * Funcao legada para compatibilidade com codigo existente.
 * Delega para extractPipeline e retorna no formato antigo.
 */
export function parseMercadoPago(texto) {
  const resultado = extractPipeline(texto);
  return {
    transacoes: resultado.transacoes,
    total_encontrado: resultado.total_encontrado,
    valor_total: resultado.valor_total,
    banco_detectado: resultado.banco_detectado,
  };
}
