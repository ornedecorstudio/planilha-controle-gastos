/**
 * Pipeline XP Investimentos - Parser metadata-only (IA visual obrigatoria)
 *
 * Caracteristicas do PDF XP:
 * - Cartao premium (Visa Infinite)
 * - Multiplas moedas: EUR, USD, BRL
 * - Muitas paginas com transacoes detalhadas
 * - Transacoes internacionais com conversao EUR/USD -> BRL
 * - Pode ter multiplos cartoes (titular + adicionais)
 * - IOF aparece em linha separada
 * - Valores negativos = estornos/reembolsos (ex: "-110,95")
 *
 * NOTA: O texto extraido por pdf-parse e inconsistente para faturas XP
 * (datas invalidas, valores duplicados, layout misto nao-parseavel).
 * Por isso, este parser extrai apenas metadados (total, cartoes, subtotais)
 * e sinaliza needsAI=true / confianca_texto='baixa' para que a IA visual
 * processe as transacoes a partir das imagens do PDF.
 *
 * Interface padrao de pipeline:
 *   extractPipeline(texto, options)  - extrai metadados, retorna 0 transacoes
 *   buildAIPrompt(...)               - prompt especializado XP
 *   postAICorrections(...)           - filtro + correcao estornos
 */

import { parseValorBR, calcularAuditoria, filtrarTransacoesIA, corrigirEstornosIA } from '../utils.js';

// ===== CONSTANTES =====

export const BANK_ID = 'xp';

// ===== EXTRACAO DE METADADOS =====

/**
 * Extrai o "Total da fatura" do texto do PDF XP.
 *
 * Padroes buscados (em ordem de prioridade):
 *   1. "TOTAL DA FATURA R$ X.XXX,XX" (valor >= 100)
 *   2. "TOTAL A PAGAR R$ X.XXX,XX" (valor >= 100)
 *   3. "VALOR TOTAL DA FATURA R$ X.XXX,XX" (valor >= 100)
 *   4. "PAGAMENTO TOTAL R$ X.XXX,XX" (valor >= 100)
 *
 * @param {string} texto - Texto completo do PDF
 * @returns {number|null} Valor do total ou null se nao encontrado
 */
function extrairTotalFaturaPDF(texto) {
  // Padrao 1: "Total da fatura"
  const regexTotal = /TOTAL\s+DA\s+FATURA\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  let match = regexTotal.exec(texto);
  if (match) {
    const valor = parseValorBR(match[1]);
    if (valor >= 100) {
      console.log(`[XP Pipeline] Total extraido via "Total da fatura": ${valor}`);
      return valor;
    }
  }

  // Padrao 2: "Total a pagar"
  const regexTotalPagar = /TOTAL\s+A\s+PAGAR\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  match = regexTotalPagar.exec(texto);
  if (match) {
    const valor = parseValorBR(match[1]);
    if (valor >= 100) {
      console.log(`[XP Pipeline] Total extraido via "Total a pagar": ${valor}`);
      return valor;
    }
  }

  // Padrao 3: "Valor total da fatura"
  const regexValorTotal = /VALOR\s+TOTAL\s+(?:DA\s+)?FATURA\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  match = regexValorTotal.exec(texto);
  if (match) {
    const valor = parseValorBR(match[1]);
    if (valor >= 100) {
      console.log(`[XP Pipeline] Total extraido via "Valor total da fatura": ${valor}`);
      return valor;
    }
  }

  // Padrao 4: "Pagamento total"
  const regexPagTotal = /PAGAMENTO\s+TOTAL\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  match = regexPagTotal.exec(texto);
  if (match) {
    const valor = parseValorBR(match[1]);
    if (valor >= 100) {
      console.log(`[XP Pipeline] Total extraido via "Pagamento total": ${valor}`);
      return valor;
    }
  }

  console.log('[XP Pipeline] Nenhum total da fatura encontrado');
  return null;
}

/**
 * Extrai numeros de cartao (ultimos 4 digitos) mencionados no PDF.
 *
 * Padroes:
 *   - "CARTAO (ADICIONAL)? (FINAL)? NNNN"
 *   - Fallback: "FINAL NNNN"
 *
 * @param {string} texto - Texto completo do PDF
 * @returns {string[]} Array de ultimos 4 digitos unicos
 */
function extrairCartoes(texto) {
  const cartoes = new Set();

  // Padrao "CARTAO (ADICIONAL)? (FINAL)? NNNN"
  const regexCartao = /CART[ÃA]O\s+(?:ADICIONAL\s+)?(?:FINAL\s+)?(\d{4})/gi;
  let match;
  while ((match = regexCartao.exec(texto)) !== null) {
    cartoes.add(match[1]);
  }

  // Fallback: "FINAL NNNN"
  const regexFinal = /FINAL\s+(\d{4})/gi;
  while ((match = regexFinal.exec(texto)) !== null) {
    cartoes.add(match[1]);
  }

  return [...cartoes];
}

/**
 * Extrai subtotais por cartao do texto XP.
 *
 * Padrao: "SUBTOTAL...R$ X.XXX,XX"
 *
 * @param {string} texto - Texto completo do PDF
 * @returns {Array<{descricao: string, valor: number}>} Subtotais encontrados
 */
function extrairSubtotais(texto) {
  const subtotais = [];

  const regexSubtotal = /SUBTOTAL[^R\n]*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  let match;
  while ((match = regexSubtotal.exec(texto)) !== null) {
    const valor = parseValorBR(match[1]);
    if (valor > 0) {
      subtotais.push({ descricao: 'Subtotal cartao', valor });
    }
  }

  return subtotais;
}

// ===== PARSER (METADATA-ONLY) =====

/**
 * Parser XP metadata-only.
 *
 * Retorna ZERO transacoes. Extrai apenas metadados (total, cartoes, subtotais)
 * para verificacao cruzada pela IA visual. Sempre sinaliza confianca_texto='baixa'
 * e needsAI=true.
 *
 * @param {string} texto - Texto extraido do PDF
 * @returns {Object} Resultado com metadados e 0 transacoes
 */
export function parseXP(texto) {
  const totalFaturaPDF = extrairTotalFaturaPDF(texto);
  const cartoesDetectados = extrairCartoes(texto);
  const subtotais = extrairSubtotais(texto);

  console.log(`[XP Pipeline] Modo metadata-only (IA visual obrigatoria)`);
  console.log(`[XP Pipeline] Total fatura PDF: ${totalFaturaPDF}`);
  console.log(`[XP Pipeline] Cartoes: ${JSON.stringify(cartoesDetectados)}`);
  console.log(`[XP Pipeline] Subtotais: ${JSON.stringify(subtotais)}`);

  return {
    transacoes: [],
    total_encontrado: 0,
    valor_total: 0,
    banco_detectado: 'XP Investimentos',
    confianca_texto: 'baixa',
    cartoes_detectados: cartoesDetectados,
    metadados_verificacao: {
      total_fatura_pdf: totalFaturaPDF,
      subtotais,
      cartoes: cartoesDetectados
    }
  };
}

// ===== PIPELINE INTERFACE =====

/**
 * extractPipeline - Ponto de entrada do pipeline.
 *
 * XP usa parser metadata-only: extrai apenas metadados do texto,
 * retorna 0 transacoes e sinaliza needsAI=true para que a IA visual
 * processe as imagens do PDF.
 *
 * @param {string} texto - Texto extraido do PDF
 * @param {Object} options - Opcoes do pipeline (nao usadas)
 * @returns {Object} PipelineResult padrao com needsAI=true
 */
export function extractPipeline(texto, options = {}) {
  const resultado = parseXP(texto);

  // Auditoria com zeros (nenhuma transacao extraida deterministicamente)
  const auditoria = calcularAuditoria([], resultado.metadados_verificacao.total_fatura_pdf);

  return {
    success: true,
    transacoes: [],
    total_encontrado: 0,
    valor_total: 0,
    banco_detectado: 'XP Investimentos',
    metodo: 'PARSER_DETERMINISTICO',
    auditoria,
    needsAI: true,
    metadados_verificacao: resultado.metadados_verificacao
  };
}

/**
 * buildAIPrompt - Constroi prompt especializado para IA visual XP.
 *
 * XP SEMPRE requer IA visual para extrai transacoes, pois o texto
 * extraido do PDF e inconsistente. O prompt inclui metadados do PDF
 * para verificacao cruzada pela IA.
 *
 * @param {string} cartaoNome - Nome do cartao
 * @param {string} tipoCartao - Tipo do cartao
 * @param {Object} metadados - Metadados extraidos (total_fatura_pdf, cartoes, subtotais)
 * @returns {string} Prompt completo para IA visual
 */
export function buildAIPrompt(cartaoNome, tipoCartao, metadados) {
  const totalFatura = metadados?.total_fatura_pdf
    ? `R$ ${metadados.total_fatura_pdf.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    : null;

  const cartoesInfo = metadados?.cartoes?.length > 0
    ? metadados.cartoes.map(c => `final ${c}`).join(', ')
    : null;

  const subtotaisInfo = metadados?.subtotais?.length > 0
    ? metadados.subtotais.map(s => `${s.descricao}: R$ ${s.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`).join(', ')
    : null;

  let metadadosBloco = '';
  if (totalFatura || cartoesInfo || subtotaisInfo) {
    metadadosBloco = '\nMETADADOS EXTRAIDOS DO PDF (use para verificacao cruzada):';
    if (totalFatura) metadadosBloco += `\n- Total da fatura: ${totalFatura}`;
    if (cartoesInfo) metadadosBloco += `\n- Cartoes na fatura: ${cartoesInfo}`;
    if (subtotaisInfo) metadadosBloco += `\n- Subtotais: ${subtotaisInfo}`;
  }

  return `Voce e um especialista em extrair transacoes de faturas de cartao de credito XP Investimentos (Visa Infinite).
Analise este PDF de fatura do cartao "${cartaoNome}"${tipoCartao ? ` (cartao ${tipoCartao})` : ''} e extraia TODAS as transacoes.
${metadadosBloco}

ESTRUTURA DO PDF XP:
- Pode ter multiplos cartoes (titular + adicionais), cada um com secao propria
- Transacoes organizadas por cartao, com subtotal por cartao
- Transacoes internacionais mostram: descricao | moeda original (EUR/USD) | cambio | valor BRL
- IOF aparece como linha separada logo abaixo da transacao internacional
- Estornos/reembolsos aparecem com prefixo "-" no valor (ex: "-110,95")

REGRAS DE EXTRACAO:

1. EXTRAIA transacoes de TODOS os cartoes (${cartoesInfo || 'verifique todos os cartoes no PDF'})
2. Para transacoes internacionais, use SEMPRE o valor em BRL (ultimo valor da linha)
3. NAO duplique transacoes
4. Data no formato DD/MM/YYYY

CLASSIFICACAO tipo_lancamento — OBRIGATORIO e CRITICO para cada transacao:
- "compra": compras nacionais e internacionais (PAYPAL*, FACEBK*, lojas, restaurantes, assinaturas, parcelamentos)
- "iof": QUALQUER linha que contenha "IOF" (Imposto sobre Operacoes Financeiras) — estas linhas costumam aparecer logo apos transacoes internacionais
- "estorno": estornos, creditos, devolucoes, reembolsos — QUALQUER valor com sinal NEGATIVO ("-") no PDF e um estorno. Capture com valor POSITIVO e tipo_lancamento "estorno"
- "pagamento_antecipado": pagamento antecipado de parcelas
- "tarifa_cartao": anuidade, tarifa do cartao, seguro

VALORES NEGATIVOS — ATENCAO ESPECIAL:
- Valores precedidos por "-" (sinal de menos) no PDF sao ESTORNOS/REEMBOLSOS
- Exemplo: "SHOTGUN* MAMBA NEGRA -110,95" -> tipo_lancamento: "estorno", valor: 110.95
- NUNCA classifique um valor negativo como "compra" — e SEMPRE "estorno"
- Capture o valor como numero POSITIVO no JSON, a classificacao "estorno" indica que e deducao

IGNORE completamente (NAO inclua no JSON):
- "Pagamento de fatura" — e pagamento do cliente, NAO e transacao de compra
- Cartoes que tem APENAS pagamento (sem compras) — ignore toda a secao
- Linhas de subtotal ("Subtotal", "Total") — sao somas de secao, NAO transacoes individuais
- Informacoes de resumo, saldo anterior, limite de credito
- Informacoes financeiras (juros, CET, parcelamento de fatura)

VERIFICACAO CRUZADA:
A soma de todas as transacoes tipo "compra" + "iof" + "tarifa_cartao" - "estorno" - "pagamento_antecipado" deve ser proxima de ${totalFatura || 'o total da fatura no PDF'}.
Se a soma ficar muito diferente (mais de R$ 5,00 de diferenca), revise:
- Valores negativos devem ser tipo "estorno", NAO "compra"
- IOF deve ser tipo "iof", NAO "compra"
- Nao inclua subtotais ou pagamentos de fatura

Retorne APENAS um JSON valido, SEM markdown, SEM comentarios:
{
  "transacoes": [
    {
      "data": "DD/MM/YYYY",
      "descricao": "descricao da transacao",
      "valor": 123.45,
      "parcela": "1/3" ou null,
      "tipo_lancamento": "compra"
    }
  ],
  "total_encontrado": numero_total_de_transacoes,
  "valor_total": soma_apenas_das_compras,
  "banco_detectado": "XP Investimentos"
}`;
}

/**
 * postAICorrections - Aplica correcoes pos-IA nas transacoes XP.
 *
 * 1. Filtra transacoes invalidas (subtotais, pagamentos, etc.)
 * 2. Corrige estornos mal-classificados como compra pela IA
 *
 * @param {Array} transacoes - Transacoes retornadas pela IA
 * @param {Object} metadados - Metadados para verificacao (total_fatura_pdf, etc.)
 * @returns {Array} Transacoes corrigidas
 */
export function postAICorrections(transacoes, metadados) {
  // 1. Filtrar transacoes invalidas
  let corrigidas = filtrarTransacoesIA(transacoes);

  // 2. Corrigir estornos mal-classificados
  corrigidas = corrigirEstornosIA(corrigidas, metadados?.total_fatura_pdf);

  return corrigidas;
}
