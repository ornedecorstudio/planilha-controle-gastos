/**
 * Pipeline C6 Bank - Parser deterministico de fatura de cartao de credito
 *
 * Caracteristicas:
 * - Multiplos cartoes (virtual, fisico, adicionais)
 * - Cada cartao tem sua propria secao de transacoes
 * - Transacoes internacionais com valor em USD + valor convertido em BRL + IOF separado
 * - Parcelamentos aparecem como "Parcela X/Y"
 * - Classifica cada transacao com tipo_lancamento:
 *   compra, iof, estorno, pagamento_antecipado, tarifa_cartao
 * - Extrai "Total a pagar" do resumo e constroi objeto de reconciliacao
 * - Deduplicacao via Set
 *
 * Padroes de extracao (4):
 *   1. regexNacional: transacoes nacionais DD/MM descricao R$ valor
 *   2. regexInternacional: internacional USD XX.XX BRL YYY,YY
 *   3. Secoes de cartao (virtual, fisico, adicional)
 *   4. Formato lista simples (linha a linha)
 *
 * Interface pipeline:
 *   - extractPipeline(texto, options)
 *   - buildAIPrompt() -> null (parser deterministico puro)
 *   - postAICorrections(transacoes) -> passthrough
 */

import { parseValorBR, parseDataBR, extrairParcela, calcularAuditoria } from '../utils.js';

// ===== CONSTANTES DE CLASSIFICACAO =====

const BANK_ID = 'c6bank';

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
  'BONIFICACAO'
];

const keywordsTarifaCartao = [
  'ANUIDADE',
  'TARIFA CARTAO',
  'TARIFA DO CARTAO',
  'SEGURO FATURA',
  'FATURA SEGURA'
];

// Termos a ignorar completamente (nao geram transacao)
// NOTA: 'ANUIDADE' e 'TARIFA' foram REMOVIDOS daqui para que
// tarifa_cartao seja detectada corretamente (keywordsTarifaCartao roda antes)
const ignorar = [
  'PAGAMENTO FATURA',
  'PAGAMENTO RECEBIDO',
  'ENCARGO',
  'JUROS',
  'MULTA'
];

// ===== CLASSIFICACAO DE TIPO_LANCAMENTO =====

/**
 * Classifica uma descricao de transacao em tipo_lancamento.
 * Ordem de prioridade:
 *   1. pagamento_antecipado
 *   2. estorno
 *   3. iof
 *   4. tarifa_cartao (ANTES de ignorar, como Itau)
 *   5. ignorar (retorna null)
 *   6. compra (default)
 */
function classificarTipoLancamento(descUpper) {
  // 1. Pagamento antecipado (verificar ANTES da lista ignorar)
  if (keywordsPagamentoAntecipado.some(kw => descUpper.includes(kw))) {
    return 'pagamento_antecipado';
  }

  // 2. Estorno / credito
  if (keywordsEstorno.some(kw => descUpper.includes(kw))) {
    return 'estorno';
  }

  // 3. IOF
  if (descUpper.includes('IOF') || descUpper.includes('IMPOSTO OPERACOES FINANCEIRAS')) {
    return 'iof';
  }

  // 4. Tarifa do cartao (anuidade, seguro, etc.) — ANTES de ignorar
  if (keywordsTarifaCartao.some(kw => descUpper.includes(kw))) {
    return 'tarifa_cartao';
  }

  // 5. Ignorar (pagamento de fatura, encargo, juros, multa)
  if (ignorar.some(termo => descUpper.includes(termo))) {
    return null; // sinaliza que deve ser pulado
  }

  // 6. Compra normal
  return 'compra';
}

// ===== EXTRACAO DE TOTAL DA FATURA =====

/**
 * Extrai o "Total a pagar" do texto do PDF.
 * Busca padroes como "Total a pagar R$ 13.651,74"
 */
function extrairTotalFaturaPDF(texto) {
  const regexTotalFatura = /(?:TOTAL\s+(?:A\s+)?PAGAR|VALOR\s+TOTAL\s+(?:DESTA\s+)?FATURA|TOTAL\s+DA\s+FATURA)\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;

  let match;
  let ultimoValor = null;

  // Pega o ultimo match (geralmente o total consolidado)
  while ((match = regexTotalFatura.exec(texto)) !== null) {
    ultimoValor = parseValorBR(match[1]);
  }

  return ultimoValor;
}

// ===== PARSER PRINCIPAL =====

/**
 * Parser deterministico de faturas C6 Bank.
 *
 * Extrai transacoes usando 4 padroes de regex, deduplica via Set,
 * classifica tipo_lancamento e extrai total da fatura do PDF.
 *
 * @param {string} texto - Texto extraido do PDF
 * @returns {Object} Resultado com transacoes, totais e metadados
 */
export function parseC6Bank(texto) {
  const transacoes = [];

  // Detectar ano da fatura
  let anoReferencia = new Date().getFullYear();
  const matchAno = texto.match(/(?:FATURA|VENCIMENTO|FECHAMENTO).*?(\d{4})/i);
  if (matchAno) {
    anoReferencia = parseInt(matchAno[1]);
  }

  // Set para evitar duplicatas
  const transacoesUnicas = new Set();

  /**
   * Tenta adicionar uma transacao a lista.
   * Retorna true se adicionada, false se duplicata/ignorada.
   */
  function adicionarTransacao(data, descricao, valor, parcela) {
    const descUpper = descricao.toUpperCase();
    const tipoLancamento = classificarTipoLancamento(descUpper);

    // null = deve ser ignorado
    if (tipoLancamento === null) return false;

    if (data && descricao && valor > 0) {
      const chave = `${data}|${descricao}|${valor.toFixed(2)}`;

      if (!transacoesUnicas.has(chave)) {
        transacoesUnicas.add(chave);
        transacoes.push({ data, descricao, valor, parcela, tipo_lancamento: tipoLancamento });
        return true;
      }
    }
    return false;
  }

  // ===== PADRAO 1: Transacoes nacionais =====
  // DATA | DESCRICAO | VALOR
  const regexNacional = /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+?)\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/gm;
  let match;

  while ((match = regexNacional.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valor = parseValorBR(match[3]);
    const parcela = extrairParcela(descricao);
    adicionarTransacao(data, descricao, valor, parcela);
  }

  // ===== PADRAO 2: Transacoes internacionais C6 =====
  // Formato tipico: DATA | DESCRICAO | USD XX.XX | BRL YYY,YY
  const regexInternacional = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+(?:USD|US\$)\s*[\d.,]+\s+(?:BRL|R\$)\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;

  while ((match = regexInternacional.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valorBRL = parseValorBR(match[3]);
    adicionarTransacao(data, descricao, valorBRL, null);
  }

  // ===== PADRAO 3: Secoes de cartao =====
  // C6 separa por "Cartao virtual", "Cartao fisico", etc.
  const regexSecaoCartao = /(CART[ÃA]O\s+(?:VIRTUAL|F[ÍI]SICO|ADICIONAL|FINAL\s+\d{4}))/gi;
  let secoesCartao = [];

  while ((match = regexSecaoCartao.exec(texto)) !== null) {
    secoesCartao.push({
      tipo: match[1],
      inicio: match.index
    });
  }

  // Processa cada secao
  for (let i = 0; i < secoesCartao.length; i++) {
    const inicio = secoesCartao[i].inicio;
    const fim = secoesCartao[i + 1]?.inicio || texto.length;
    const secao = texto.substring(inicio, fim);

    // Extrai transacoes da secao
    const regexSecao = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g;

    while ((match = regexSecao.exec(secao)) !== null) {
      const data = parseDataBR(match[1], anoReferencia);
      const descricao = match[2].trim();
      const valor = parseValorBR(match[3]);
      adicionarTransacao(data, descricao, valor, extrairParcela(descricao));
    }
  }

  // ===== PADRAO 4: Formato lista simples C6 =====
  // Algumas faturas C6 vem em formato mais simples
  const linhas = texto.split('\n').map(l => l.trim()).filter(l => l);

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];

    // Procura linha que comeca com data
    const matchData = linha.match(/^(\d{1,2}\/\d{1,2})/);
    if (matchData) {
      const data = parseDataBR(matchData[1], anoReferencia);
      let resto = linha.substring(matchData[0].length).trim();

      // Procura valor no final
      const matchValor = resto.match(/R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/);
      if (matchValor) {
        const valor = parseValorBR(matchValor[1]);
        const descricao = resto.replace(matchValor[0], '').trim();
        adicionarTransacao(data, descricao, valor, extrairParcela(descricao));
      }
    }
  }

  // Extrair total da fatura do PDF
  const totalFaturaPDF = extrairTotalFaturaPDF(texto);

  // valor_total = total_compras para compatibilidade (sem IOF, estornos, pgto antecipado, tarifa)
  const totalCompras = transacoes
    .filter(t => t.tipo_lancamento === 'compra')
    .reduce((sum, t) => sum + t.valor, 0);

  const valorTotal = parseFloat(totalCompras.toFixed(2));

  return {
    transacoes,
    total_encontrado: transacoes.length,
    valor_total: valorTotal,
    banco_detectado: 'C6 Bank',
    total_fatura_pdf: totalFaturaPDF
  };
}

// ===== PIPELINE INTERFACE =====

/**
 * extractPipeline - Ponto de entrada do pipeline.
 *
 * Executa o parser deterministico parseC6Bank e calcula auditoria
 * usando a funcao compartilhada calcularAuditoria() de utils.js
 * (que inclui tarifa_cartao na formula).
 *
 * @param {string} texto - Texto extraido do PDF
 * @param {Object} options - Opcoes do pipeline (nao usadas neste parser)
 * @returns {Object} PipelineResult padrao
 */
export function extractPipeline(texto, options = {}) {
  const resultado = parseC6Bank(texto);

  // Calcular auditoria usando funcao compartilhada (inclui tarifa_cartao)
  const auditoria = calcularAuditoria(resultado.transacoes, resultado.total_fatura_pdf);

  return {
    success: true,
    transacoes: resultado.transacoes,
    total_encontrado: resultado.total_encontrado,
    valor_total: resultado.valor_total,
    banco_detectado: 'C6 Bank',
    metodo: 'PARSER_DETERMINISTICO',
    auditoria,
    needsAI: false,
    metadados_verificacao: {
      total_fatura_pdf: resultado.total_fatura_pdf
    }
  };
}

/**
 * buildAIPrompt - Retorna null pois este parser e deterministico puro.
 * Nao necessita de IA para complementar a extracao.
 */
export function buildAIPrompt() {
  return null;
}

/**
 * postAICorrections - Passthrough, nao aplica correcoes.
 * Este parser nao usa IA, entao as transacoes passam direto.
 *
 * @param {Array} transacoes - Transacoes (nao modificadas)
 * @returns {Array} Mesmas transacoes sem alteracao
 */
export function postAICorrections(transacoes) {
  return transacoes;
}

// ===== EXPORTS =====

export { BANK_ID };
