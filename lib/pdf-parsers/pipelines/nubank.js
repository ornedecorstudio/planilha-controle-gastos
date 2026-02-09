/**
 * Pipeline Nubank - Parser deterministico completo
 *
 * Formato tipico da fatura Nubank:
 * - Data: DD MMM (ex: "15 DEZ")
 * - Descricao em uma linha
 * - Valor: R$ X.XXX,XX ou apenas X.XXX,XX
 * - Parcelamentos: "PARCELA 2/10" ou similar
 * - Formato tabular alternativo: DD/MM ... R$ valor
 *
 * Classificacao tipo_lancamento:
 *   iof           -> IOF
 *   estorno       -> ESTORNO, CREDITO NA FATURA, DEVOLUCAO, REEMBOLSO, CASHBACK
 *   tarifa_cartao -> ANUIDADE, TARIFA, SEGURO FATURA, FATURA SEGURA
 *   pagamento_antecipado -> PAGAMENTO ANTECIPADO, PGTO ANTECIPADO
 *   compra        -> tudo o resto
 *
 * Ignora completamente (pagamentos do cliente):
 *   PAGAMENTO RECEBIDO, PAGAMENTO FATURA, PAGAMENTO EFETUADO
 */

import { parseValorBR, parseDataBR, extrairParcela, calcularAuditoria } from '../utils.js';

// ===== CONSTANTES DE CLASSIFICACAO =====

const KEYWORDS_PAGAMENTO_ANTECIPADO = [
  'PAGAMENTO ANTECIPADO',
  'PGTO ANTECIPADO'
];

const KEYWORDS_ESTORNO = [
  'ESTORNO',
  'CREDITO NA FATURA',
  'CREDITO FATURA',
  'DEVOLUCAO',
  'DEVOLUÇÃO',
  'REEMBOLSO',
  'CASHBACK'
];

const KEYWORDS_TARIFA_CARTAO = [
  'ANUIDADE',
  'TARIFA',
  'SEGURO FATURA',
  'FATURA SEGURA'
];

/** Transacoes que devem ser completamente ignoradas (pagamentos do cliente) */
const KEYWORDS_IGNORAR = [
  'PAGAMENTO RECEBIDO',
  'PAGAMENTO FATURA',
  'PAGAMENTO EFETUADO'
];

// ===== CLASSIFICACAO =====

/**
 * Classifica uma descricao de transacao em tipo_lancamento.
 *
 * Ordem de prioridade:
 *   1. pagamento_antecipado
 *   2. estorno
 *   3. iof
 *   4. tarifa_cartao
 *   5. ignorar (retorna null)
 *   6. compra (default)
 *
 * @param {string} descUpper - Descricao em maiusculas
 * @returns {string|null} tipo_lancamento ou null se deve ser ignorado
 */
function classificarTipoLancamento(descUpper) {
  // 1. Pagamento antecipado (verificar ANTES da lista ignorar)
  if (KEYWORDS_PAGAMENTO_ANTECIPADO.some(kw => descUpper.includes(kw))) {
    return 'pagamento_antecipado';
  }

  // 2. Estorno / credito
  if (KEYWORDS_ESTORNO.some(kw => descUpper.includes(kw))) {
    return 'estorno';
  }

  // 3. IOF
  if (descUpper.includes('IOF')) {
    return 'iof';
  }

  // 4. Tarifa / anuidade / seguro (capturar, nao ignorar)
  if (KEYWORDS_TARIFA_CARTAO.some(kw => descUpper.includes(kw))) {
    return 'tarifa_cartao';
  }

  // 5. Ignorar completamente (pagamentos do cliente)
  if (KEYWORDS_IGNORAR.some(termo => descUpper.includes(termo))) {
    return null;
  }

  // 6. Compra normal
  return 'compra';
}

// ===== EXTRACAO DO TOTAL DA FATURA =====

/**
 * Extrai o total da fatura do texto do PDF Nubank.
 *
 * Padroes buscados:
 *   "TOTAL DA SUA FATURA R$ X.XXX,XX"
 *   "Total da fatura R$ X.XXX,XX"
 *   "TOTAL R$ X.XXX,XX" (fora de contexto de parcela)
 *
 * @param {string} texto - Texto completo do PDF
 * @returns {number|null} Valor do total ou null se nao encontrado
 */
function extrairTotalFaturaPDF(texto) {
  // Padrao 1: "TOTAL DA SUA FATURA"
  const regexTotalSua = /TOTAL\s+DA\s+SUA\s+FATURA\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  let match = regexTotalSua.exec(texto);
  if (match) {
    const valor = parseValorBR(match[1]);
    if (valor > 0) {
      console.log(`[Nubank Pipeline] Total extraido via "Total da sua fatura": ${valor}`);
      return valor;
    }
  }

  // Padrao 2: "TOTAL DA FATURA"
  const regexTotalDa = /TOTAL\s+DA\s+FATURA\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  match = regexTotalDa.exec(texto);
  if (match) {
    const valor = parseValorBR(match[1]);
    if (valor > 0) {
      console.log(`[Nubank Pipeline] Total extraido via "Total da fatura": ${valor}`);
      return valor;
    }
  }

  // Padrao 3: "TOTAL R$ X.XXX,XX" — mais generico, evitar match em contexto de parcela
  // Busca "TOTAL" seguido de valor, mas NAO precedido por "PARCELA" ou "SUBTOTAL"
  const regexTotalGenerico = /(?<!PARCELA\s)(?<!SUB)TOTAL\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  match = regexTotalGenerico.exec(texto);
  if (match) {
    const valor = parseValorBR(match[1]);
    if (valor > 0) {
      console.log(`[Nubank Pipeline] Total extraido via "TOTAL" generico: ${valor}`);
      return valor;
    }
  }

  console.log('[Nubank Pipeline] Nenhum total da fatura encontrado');
  return null;
}

// ===== PARSER PRINCIPAL =====

/**
 * Funcao raw de parsing Nubank, exportada para backward compat.
 *
 * @param {string} texto - Texto extraido do PDF
 * @returns {Object} Resultado do parsing com transacoes e metadados
 */
export function parseNubank(texto) {
  const transacoes = [];
  const linhas = texto.split('\n').map(l => l.trim()).filter(l => l);

  // Detectar ano da fatura
  let anoReferencia = new Date().getFullYear();
  const matchAno = texto.match(/(?:FATURA|VENCIMENTO).*?(\d{4})/i);
  if (matchAno) {
    anoReferencia = parseInt(matchAno[1]);
  }

  // Set para deduplicacao
  const transacoesUnicas = new Set();

  /**
   * Tenta adicionar uma transacao a lista.
   * Classifica tipo_lancamento e deduplica.
   *
   * @returns {boolean} true se adicionada, false se duplicata/ignorada
   */
  function adicionarTransacao(data, descricao, valor, parcela) {
    const descUpper = descricao.toUpperCase();
    const tipoLancamento = classificarTipoLancamento(descUpper);

    // null = deve ser ignorado (pagamento do cliente)
    if (tipoLancamento === null) return false;

    if (data && descricao && valor > 0) {
      const chave = `${data}|${descricao}|${valor.toFixed(2)}`;
      if (!transacoesUnicas.has(chave)) {
        transacoesUnicas.add(chave);
        transacoes.push({
          data,
          descricao: descricao.trim(),
          valor,
          parcela,
          tipo_lancamento: tipoLancamento
        });
        return true;
      }
    }
    return false;
  }

  // --- Padrao 1: "DD MMM" no inicio da linha ---
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];

    const matchData = linha.toUpperCase().match(
      /^(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)/
    );

    if (matchData) {
      const dataStr = `${matchData[1]} ${matchData[2]}`;
      const data = parseDataBR(dataStr, anoReferencia);

      // Resto da linha apos a data e a descricao
      let descricao = linha.substring(matchData[0].length).trim();
      let valor = 0;
      let parcela = null;

      // Procura valor na mesma linha
      let valorMatch = descricao.match(/R?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*$/);
      if (valorMatch) {
        valor = parseValorBR(valorMatch[1]);
        descricao = descricao.replace(valorMatch[0], '').trim();
      } else if (i + 1 < linhas.length) {
        // Valor pode estar na proxima linha
        const proximaLinha = linhas[i + 1];
        valorMatch = proximaLinha.match(/^R?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*$/);
        if (valorMatch) {
          valor = parseValorBR(valorMatch[1]);
          i++; // Pula a linha do valor
        }
      }

      // Extrai parcela da descricao
      parcela = extrairParcela(descricao);

      adicionarTransacao(data, descricao, valor, parcela);
    }
  }

  // --- Padrao 2: Tabular DD/MM ... R$ valor ---
  const regexTabular = /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+?)\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  let matchTab;
  while ((matchTab = regexTabular.exec(texto)) !== null) {
    const data = parseDataBR(matchTab[1], anoReferencia);
    const descricao = matchTab[2].trim();
    const valor = parseValorBR(matchTab[3]);
    const parcela = extrairParcela(descricao);

    adicionarTransacao(data, descricao, valor, parcela);
  }

  // === Extrair total da fatura e calcular auditoria ===
  const totalFaturaPDF = extrairTotalFaturaPDF(texto);
  const auditoria = calcularAuditoria(transacoes, totalFaturaPDF);

  // valor_total = total_compras para compatibilidade
  const valorTotal = auditoria.total_compras;

  return {
    transacoes,
    total_encontrado: transacoes.length,
    valor_total: valorTotal,
    banco_detectado: 'Nubank',
    auditoria,
    metadados_verificacao: {
      total_fatura_pdf: totalFaturaPDF
    }
  };
}

// ===== PIPELINE INTERFACE =====

export const BANK_ID = 'nubank';

/**
 * Pipeline principal de extracao. Nubank usa parser deterministico
 * completo, sem necessidade de IA.
 *
 * @param {string} texto - Texto extraido do PDF
 * @param {Object} options - Opcoes do pipeline (nao usadas)
 * @returns {Object} PipelineResult padrao
 */
export function extractPipeline(texto, options = {}) {
  const resultado = parseNubank(texto);

  return {
    success: resultado.transacoes.length > 0,
    transacoes: resultado.transacoes,
    total_encontrado: resultado.total_encontrado,
    valor_total: resultado.valor_total,
    banco_detectado: 'Nubank',
    metodo: 'PARSER_DETERMINISTICO',
    auditoria: resultado.auditoria,
    needsAI: false,
    metadados_verificacao: resultado.metadados_verificacao
  };
}

/**
 * Nubank nao precisa de IA — retorna null.
 *
 * @param {string} cartaoNome - Nome do cartao
 * @param {string} tipoCartao - Tipo do cartao
 * @param {Object} metadados - Metadados extraidos
 * @returns {null}
 */
export function buildAIPrompt(cartaoNome, tipoCartao, metadados) {
  return null;
}

/**
 * Nubank nao precisa de correcoes pos-IA — passthrough.
 *
 * @param {Array} transacoes - Transacoes retornadas pela IA
 * @param {Object} metadados - Metadados para verificacao
 * @returns {Array} Mesmas transacoes sem alteracao
 */
export function postAICorrections(transacoes, metadados) {
  return transacoes;
}
