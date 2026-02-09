/**
 * Pipeline Renner / Realize Credito - Parser com IA condicional
 *
 * Caracteristicas do PDF Renner:
 * - Pagina 1: Resumo (Pagamento Total, Minimo, Parcelamento, boleto) — NAO contem transacoes
 * - Pagina 2: "Lancamentos detalhados do periodo" — contem as transacoes reais
 * - Pagina 3: Termos, condicoes, taxas — IGNORAR
 *
 * Formato das transacoes (pagina 2):
 *   DD/MM/YYYY | Descricao | Estabelecimento (opcional) | Valor
 *   Ex: "03/01/2026 Compra a Vista sem Juros Visa FACEBK RCM5Z9RHW2 506,90"
 *   Ex: "10/01/2026 Fatura Segura 12,90"
 *   Ex: "30/12/2025 Pagamento Fatura Pix -4.988,91"
 *
 * Problemas conhecidos do pdf-parse:
 * - Na pagina 1, o valor aparece ANTES do label "Pagamento Total" (layout em caixa invertido)
 * - Descricao "Compra a Vista sem Juros Visa" e generica — nome real esta na coluna Estabelecimento
 * - Se >50% das compras tem descricao generica, confianca baixa → needsAI = true
 *
 * Classificacao tipo_lancamento (ORDEM IMPORTA):
 *   1. pagamento_fatura → SKIP (Pagamento Fatura, Pagamento Recebido, etc.)
 *   2. compra → Compra a Vista, Compra Parcelada, Visa, Meu Cart, Saque (ANTES de juros!)
 *   3. tarifa_cartao → Fatura Segura, Seguro Fatura, Anuidade, Aval Emerg, Credito Emerg
 *   4. estorno → Estorno, Devoluc, Reembolso, Cashback
 *   5. iof → IOF
 *   6. tarifa_cartao → Juros, Multa, Encargo, Tarifa (so se NAO capturado por compra acima)
 *   7. compra (default)
 *
 * Pipeline condicional:
 *   confianca 'alta'  (>= 3 transacoes E sem descricoes genericas) → needsAI = false
 *   confianca 'baixa' (poucas transacoes OU descricoes genericas)  → needsAI = true
 *
 * Interface padrao:
 *   extractPipeline(texto, options) - funcao principal
 *   buildAIPrompt(cartaoNome, tipoCartao, metadados) - prompt especifico Renner
 *   postAICorrections(transacoes, metadados) - filtrarTransacoesIA + corrigirEstornosIA
 */

import {
  parseValorBR,
  parseDataBR,
  extrairParcela,
  calcularAuditoria,
  filtrarTransacoesIA,
  corrigirEstornosIA
} from '../utils.js';

// ===== CONSTANTES =====

export const BANK_ID = 'renner';

// ===== EXTRACAO DO TOTAL DA FATURA =====

/**
 * Extrai o "Pagamento Total" do resumo da fatura (pagina 1).
 * Este e o total_fatura_pdf para reconciliacao.
 *
 * CUIDADO: O texto extraido pelo pdf-parse para a pagina 1 inverte
 * a ordem label/valor no layout em caixa. O valor "5.046,18" aparece
 * ANTES do label "Pagamento Total" no texto extraido:
 *   "R$ 797,56\n5.046,18\nAlternativas complementares de pagamento\nPagamento Total"
 *
 * Padroes (em ordem de prioridade):
 *   1. Valor ANTES de "Pagamento Total" (2 linhas acima) — layout invertido
 *   2. Valor proximo (ate 100 chars) antes de "Pagamento Total" (>= 1000)
 *   3. Valor antes de "Total R$" — resumo pagina 2
 *   4. "PAGAMENTO TOTAL R$ valor" — ordem normal (fallback)
 */
function extrairTotalFaturaPDF(texto) {
  // Padrao 1 (prioritario): valor que aparece ANTES de "Pagamento Total"
  // no texto, separado por uma linha intermediaria
  const regexAntes = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*\n[^\n]*\nPagamento\s+Total/i;
  const matchAntes = regexAntes.exec(texto);
  if (matchAntes) {
    const valor = parseValorBR(matchAntes[1]);
    if (valor >= 100) {
      console.log(`[Renner Pipeline] Total fatura extraido (antes do label): ${valor}`);
      return valor;
    }
  }

  // Padrao 2: valor >= 1000 proximo (antes) de "Pagamento Total"
  // Threshold alto para evitar capturar "797,56" (Minimo) que tambem aparece antes
  const regexPerto = /(\d{1,3}(?:\.\d{3})*,\d{2})[\s\S]{0,100}?Pagamento\s+Total/i;
  const matchPerto = regexPerto.exec(texto);
  if (matchPerto) {
    const valor = parseValorBR(matchPerto[1]);
    if (valor >= 1000) {
      console.log(`[Renner Pipeline] Total fatura extraido (proximo ao label): ${valor}`);
      return valor;
    }
  }

  // Padrao 3: "valor Total R$" na secao de resumo da pagina 2
  // No texto: "5.046,18 Total R$" — valor aparece ANTES de "Total R$"
  const regexTotalRS = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*Total\s+R\$/i;
  const matchTotalRS = regexTotalRS.exec(texto);
  if (matchTotalRS) {
    const valor = parseValorBR(matchTotalRS[1]);
    if (valor >= 100) {
      console.log(`[Renner Pipeline] Total fatura extraido (resumo pagina 2): ${valor}`);
      return valor;
    }
  }

  // Padrao 4 (fallback): "PAGAMENTO TOTAL" seguido de valor (ordem normal)
  const regexDepois = /PAGAMENTO\s+TOTAL\s*[:\s]*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  const matchDepois = regexDepois.exec(texto);
  if (matchDepois) {
    const valor = parseValorBR(matchDepois[1]);
    if (valor >= 100) {
      console.log(`[Renner Pipeline] Total fatura extraido (apos label): ${valor}`);
      return valor;
    }
  }

  console.log('[Renner Pipeline] Nenhum total da fatura encontrado');
  return null;
}

// ===== CLASSIFICACAO =====

/**
 * Classifica o tipo de lancamento de uma transacao Renner.
 *
 * IMPORTANTE: A ordem das verificacoes importa!
 * "Compra a Vista sem Juros Visa" contem "JUROS", entao compras
 * devem ser detectadas ANTES da regra de juros/encargos.
 *
 * Ordem:
 *   1. pagamento_fatura (SKIP) — Pagamento Fatura, Recebido, Efetuado, Pix
 *   2. compra — Compra a Vista, Parcelada, Visa, Meu Cart, Saque (ANTES de juros!)
 *   3. tarifa_cartao — Fatura Segura, Seguro Fatura, Anuidade, Aval Emerg, Credito Emerg
 *   4. estorno — Estorno, Devoluc, Reembolso, Cashback
 *   5. iof — IOF
 *   6. tarifa_cartao — Juros, Multa, Encargo, Tarifa (so se NAO capturado em #2)
 *   7. compra (default)
 *
 * @param {string} descricaoCompleta - Descricao completa da transacao
 * @returns {string} tipo_lancamento
 */
function classificarTipoRenner(descricaoCompleta) {
  const desc = descricaoCompleta.toUpperCase();

  // 1. Pagamentos do cliente (IGNORAR — nao incluir no resultado)
  if (desc.includes('PAGAMENTO FATURA') ||
      desc.includes('PAGAMENTO RECEBIDO') ||
      desc.includes('PAGAMENTO EFETUADO') ||
      desc.includes('PAGAMENTO PIX')) {
    return 'pagamento_fatura';
  }

  // 2. Compras — detectar ANTES de juros/tarifas para evitar false positive
  //    "Compra a Vista sem JUROS Visa" contem "JUROS" mas e compra!
  if (desc.includes('COMPRA A VISTA') ||
      desc.includes('COMPRA PARCELADA') ||
      desc.includes('COMPRA VISA') ||
      desc.includes('COMPRA MEU CART') ||
      desc.includes('SAQUE VISA') ||
      desc.includes('SAQUE MEU CART')) {
    return 'compra';
  }

  // 3. Tarifas do cartao (termos especificos)
  if (desc.includes('FATURA SEGURA') ||
      desc.includes('SEGURO FATURA') ||
      desc.includes('ANUIDADE') ||
      desc.includes('AVAL EMERG') ||
      desc.includes('AVALIACAO EMERG') ||
      desc.includes('CREDITO EMERG')) {
    return 'tarifa_cartao';
  }

  // 4. Estornos/devolucoes
  if (desc.includes('ESTORNO') ||
      desc.includes('DEVOLUC') ||
      desc.includes('REEMBOLSO') ||
      desc.includes('CASHBACK')) {
    return 'estorno';
  }

  // 5. IOF
  if (desc.includes('IOF')) {
    return 'iof';
  }

  // 6. Juros/encargos/multa — SO chega aqui se NAO for compra (item 2 ja filtrou)
  if (desc.includes('JUROS') ||
      desc.includes('MULTA') ||
      desc.includes('ENCARGO') ||
      desc.includes('TARIFA')) {
    return 'tarifa_cartao';
  }

  // 7. Default: compra
  return 'compra';
}

// ===== EXTRACAO DE ESTABELECIMENTO =====

/**
 * Extrai o nome do estabelecimento da descricao.
 *
 * No PDF Renner, transacoes de compra tem formato:
 *   "Compra a Vista sem Juros Visa FACEBK RCM5Z9RHW2"
 *   "Compra a Vista sem Juros Meu Cartao LOJA XYZ"
 *
 * A parte generica ("Compra a Vista sem Juros Visa") deve ser removida
 * e o estabelecimento ("FACEBK RCM5Z9RHW2") usado como descricao.
 *
 * @param {string} descricao - Descricao raw da transacao
 * @returns {string} Estabelecimento ou descricao original
 */
function extrairEstabelecimento(descricao) {
  const prefixos = [
    /^Compra\s+a\s+Vista\s+sem\s+Juros\s+(?:Visa|Meu\s+Cart[aã]o)\s*/i,
    /^Compra\s+a\s+Vista\s+(?:Visa|Meu\s+Cart[aã]o)\s*/i,
    /^Compra\s+Parcelada\s+(?:Visa|Meu\s+Cart[aã]o)\s*/i,
    /^Compra\s+(?:Visa|Meu\s+Cart[aã]o)\s*/i,
    /^Saque\s+(?:Visa|Meu\s+Cart[aã]o)\s*/i,
  ];

  for (const prefixo of prefixos) {
    const match = descricao.match(prefixo);
    if (match) {
      const estabelecimento = descricao.substring(match[0].length).trim();
      if (estabelecimento.length > 0) {
        return estabelecimento;
      }
    }
  }

  return descricao;
}

// ===== EXTRACAO DA SECAO DE TRANSACOES =====

/**
 * Localiza a secao de transacoes no texto extraido.
 * Retorna o texto APENAS da secao de transacoes.
 *
 * Delimitadores:
 *   Inicio: "Lancamentos detalhados do periodo" ou "Credito/Debito" ou "Transacoes realizadas"
 *   Fim: "Compras parceladas" ou "Proximas Faturas" ou "Confira as informacoes" etc.
 *
 * @param {string} texto - Texto completo do PDF
 * @returns {string|null} Texto da secao de transacoes ou null
 */
function extrairSecaoTransacoes(texto) {
  const marcadoresInicio = [
    /LAN[CÇ]AMENTOS\s+DETALHADOS\s+DO\s+PER[IÍ]ODO\s*:?/i,
    /CR[EÉ]DITO\s*\/?\s*D[EÉ]BITO/i,
    /TRANSA[CÇ][OÕ]ES\s+REALIZADAS\s+PELO/i,
  ];

  let inicioPos = -1;
  for (const regex of marcadoresInicio) {
    const match = texto.search(regex);
    if (match !== -1) {
      inicioPos = match;
      break;
    }
  }

  if (inicioPos === -1) {
    console.log('[Renner Pipeline] Secao de transacoes nao encontrada');
    return null;
  }

  const marcadoresFim = [
    /COMPRAS\s+PARCELADAS/i,
    /PR[OÓ]XIMAS?\s+FATURAS?/i,
    /CONFIRA\s+AS\s+INFORMA[CÇ][OÕ]ES/i,
    /ATEN[CÇ][AÃ]O\s*:\s*OS\s+LAN[CÇ]AMENTOS/i,
    /LIMITES?\s+EM\s+R\$/i,
  ];

  let fimPos = texto.length;
  const textoAposInicio = texto.substring(inicioPos);

  for (const regex of marcadoresFim) {
    const match = textoAposInicio.search(regex);
    if (match !== -1 && match > 50) { // > 50 para nao pegar o header
      const posFim = inicioPos + match;
      if (posFim < fimPos) {
        fimPos = posFim;
      }
    }
  }

  const secao = texto.substring(inicioPos, fimPos);
  console.log(`[Renner Pipeline] Secao de transacoes: pos ${inicioPos}-${fimPos} (${secao.length} chars)`);
  return secao;
}

// ===== PARSER PRINCIPAL =====

/**
 * Parser deterministico de faturas Renner / Realize Credito.
 *
 * Extrai transacoes da secao "Lancamentos detalhados" usando regex,
 * classifica tipo_lancamento, extrai estabelecimento e calcula auditoria.
 *
 * Retorna confianca 'alta' ou 'baixa' para decidir se IA e necessaria.
 *
 * @param {string} texto - Texto extraido do PDF
 * @returns {Object} Resultado com transacoes, confianca e metadados
 */
export function parseRenner(texto) {
  const transacoes = [];

  // 1. Detectar ano de referencia via vencimento
  let anoReferencia = new Date().getFullYear();
  const matchVenc = texto.match(/VENCIMENTO\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (matchVenc) {
    const ano = parseInt(matchVenc[1].split('/')[2]);
    if (ano > 2000) anoReferencia = ano;
  } else {
    const matchAno = texto.match(/(\d{2}\/\d{2}\/\d{4})/);
    if (matchAno) {
      const ano = parseInt(matchAno[1].split('/')[2]);
      if (ano > 2000) anoReferencia = ano;
    }
  }
  console.log(`[Renner Pipeline] Ano referencia: ${anoReferencia}`);

  // 2. Extrair total da fatura (pagina 1)
  const totalFaturaPDF = extrairTotalFaturaPDF(texto);

  // 3. Localizar secao de transacoes
  const secaoTransacoes = extrairSecaoTransacoes(texto);

  if (!secaoTransacoes) {
    console.log('[Renner Pipeline] Secao de transacoes nao encontrada — confianca baixa');
    return {
      transacoes: [],
      total_encontrado: 0,
      valor_total: 0,
      banco_detectado: 'Renner/Realize',
      confianca: 'baixa',
      totalFaturaPDF
    };
  }

  // 4. Parsear transacoes dentro da secao
  // Pattern principal: data DD/MM/YYYY + descricao + valor (possivelmente negativo)
  const regexTransacao = /(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/gm;
  let match;

  while ((match = regexTransacao.exec(secaoTransacoes)) !== null) {
    const dataStr = match[1];
    const descricaoRaw = match[2].trim();
    const valorStr = match[3];

    const data = parseDataBR(dataStr, anoReferencia);
    if (!data) continue;

    const valorAbsoluto = parseValorBR(valorStr);
    const ehNegativo = valorStr.startsWith('-');

    const descricaoFinal = extrairEstabelecimento(descricaoRaw);
    const tipoLancamento = classificarTipoRenner(descricaoRaw);

    // Filtrar pagamentos do cliente
    if (tipoLancamento === 'pagamento_fatura') {
      console.log(`[Renner Pipeline] Ignorando pagamento: ${descricaoRaw} ${valorStr}`);
      continue;
    }

    // Valores negativos que nao sao estorno = pagamentos (ignorar)
    if (ehNegativo && tipoLancamento !== 'estorno') {
      console.log(`[Renner Pipeline] Ignorando valor negativo: ${descricaoRaw} ${valorStr}`);
      continue;
    }

    if (valorAbsoluto <= 0) continue;
    if (!descricaoFinal) continue;

    const parcela = extrairParcela(descricaoRaw);

    // Deduplicacao
    const existe = transacoes.some(t =>
      t.data === data &&
      t.descricao === descricaoFinal &&
      Math.abs(t.valor - valorAbsoluto) < 0.01
    );

    if (!existe) {
      transacoes.push({
        data,
        descricao: descricaoFinal,
        valor: valorAbsoluto,
        parcela,
        tipo_lancamento: tipoLancamento
      });
    }
  }

  // 5. Fallback: tentar pattern com data DD/MM (sem ano) se poucos resultados
  if (transacoes.length < 3) {
    console.log(`[Renner Pipeline] Poucos resultados (${transacoes.length}), tentando pattern DD/MM...`);
    const regexDDMM = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/gm;

    while ((match = regexDDMM.exec(secaoTransacoes)) !== null) {
      const dataStr = match[1];
      const descricaoRaw = match[2].trim();
      const valorStr = match[3];

      const data = parseDataBR(dataStr, anoReferencia);
      if (!data) continue;

      const valorAbsoluto = parseValorBR(valorStr);
      const ehNegativo = valorStr.startsWith('-');
      const descricaoFinal = extrairEstabelecimento(descricaoRaw);
      const tipoLancamento = classificarTipoRenner(descricaoRaw);

      if (tipoLancamento === 'pagamento_fatura') continue;
      if (ehNegativo && tipoLancamento !== 'estorno') continue;
      if (valorAbsoluto <= 0) continue;
      if (!descricaoFinal) continue;

      const parcela = extrairParcela(descricaoRaw);
      const existe = transacoes.some(t =>
        t.data === data &&
        t.descricao === descricaoFinal &&
        Math.abs(t.valor - valorAbsoluto) < 0.01
      );

      if (!existe) {
        transacoes.push({
          data,
          descricao: descricaoFinal,
          valor: valorAbsoluto,
          parcela,
          tipo_lancamento: tipoLancamento
        });
      }
    }
  }

  console.log(`[Renner Pipeline] ${transacoes.length} transacoes extraidas`);

  // 5.5. Verificar se as descricoes sao genericas (sem estabelecimento)
  // Se a maioria das compras tem descricao "Compra a Vista sem Juros Visa",
  // o pdf-parse nao extraiu os nomes dos estabelecimentos → forcar IA visual
  const compras = transacoes.filter(t => t.tipo_lancamento === 'compra');
  const comprasGenericas = compras.filter(t =>
    /^Compra\s+a\s+Vista\s+sem\s+Juros/i.test(t.descricao) ||
    /^Compra\s+a\s+Vista\s+(?:Visa|Meu)/i.test(t.descricao)
  );
  const descricaoGenericaDetectada = compras.length > 3 && comprasGenericas.length > compras.length * 0.5;
  if (descricaoGenericaDetectada) {
    console.log(`[Renner Pipeline] ${comprasGenericas.length}/${compras.length} compras com descricao generica — forcando IA visual`);
  }

  // 6. Determinar confianca
  const confianca = (transacoes.length >= 3 && !descricaoGenericaDetectada) ? 'alta' : 'baixa';
  console.log(`[Renner Pipeline] Confianca: ${confianca}`);

  return {
    transacoes,
    total_encontrado: transacoes.length,
    valor_total: parseFloat(transacoes.reduce((sum, t) => sum + t.valor, 0).toFixed(2)),
    banco_detectado: 'Renner/Realize',
    confianca,
    totalFaturaPDF
  };
}

// ===== PIPELINE INTERFACE =====

/**
 * extractPipeline - Ponto de entrada do pipeline.
 *
 * Executa o parser deterministico parseRenner e calcula auditoria.
 * Sinaliza needsAI = true se confianca baixa (poucas transacoes ou
 * descricoes genericas).
 *
 * @param {string} texto - Texto extraido do PDF
 * @param {Object} options - Opcoes do pipeline (nao usadas)
 * @returns {Object} PipelineResult padrao
 */
export function extractPipeline(texto, options = {}) {
  const resultado = parseRenner(texto);

  const auditoria = calcularAuditoria(resultado.transacoes, resultado.totalFaturaPDF);

  return {
    success: true,
    transacoes: resultado.transacoes,
    total_encontrado: resultado.total_encontrado,
    valor_total: resultado.valor_total,
    banco_detectado: 'Renner/Realize',
    metodo: 'PARSER_DETERMINISTICO',
    auditoria,
    needsAI: resultado.confianca === 'baixa',
    metadados_verificacao: {
      total_fatura_pdf: resultado.totalFaturaPDF
    }
  };
}

// ===== AI PROMPT =====

/**
 * Constroi prompt especifico para Renner / Realize Credito.
 *
 * Explica a estrutura do PDF (pagina 1 = resumo, pagina 2 = transacoes,
 * pagina 3 = termos) e instrui a IA a usar o nome do estabelecimento
 * como descricao quando a descricao e generica ("Compra a Vista sem Juros Visa").
 *
 * @param {string} cartaoNome - Nome do cartao
 * @param {string} tipoCartao - Tipo do cartao
 * @param {Object} metadados - Metadados extraidos (total_fatura_pdf)
 * @returns {string} Prompt formatado para IA
 */
export function buildAIPrompt(cartaoNome, tipoCartao, metadados) {
  const totalFatura = metadados?.total_fatura_pdf
    ? `R$ ${metadados.total_fatura_pdf.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    : null;

  return `Voce e um especialista em extrair transacoes de faturas de cartao de credito Renner (Realize Credito).
Analise este PDF de fatura do cartao "${cartaoNome}"${tipoCartao ? ` (cartao ${tipoCartao})` : ''}.

ESTRUTURA DO PDF RENNER:
- Pagina 1: RESUMO (Pagamento Total, Minimo, Parcelamento, boleto) — NAO extraia valores desta pagina como transacoes
- Pagina 2: "Lancamentos detalhados do periodo" — AQUI estao as transacoes reais
- Pagina 3: Termos e condicoes — IGNORE completamente
${totalFatura ? `\nTotal da fatura (para verificacao): ${totalFatura}` : ''}

FORMATO DAS TRANSACOES (pagina 2):
A tabela tem colunas: Data | Descricao | Estabelecimento | Credito/Debito
- "Compra a Vista sem Juros Visa" e uma descricao GENERICA — use o nome do ESTABELECIMENTO como descricao
  Exemplo: "03/01/2026 | Compra a Vista sem Juros Visa | FACEBK RCM5Z9RHW2 | 506,90" → descricao: "FACEBK RCM5Z9RHW2"
- Se nao ha estabelecimento (ex: "Fatura Segura"), use a descricao original

CLASSIFICACAO tipo_lancamento — OBRIGATORIO para cada transacao:
- "compra": compras (Compra a Vista sem Juros, Compra Parcelada, etc.)
- "iof": IOF
- "tarifa_cartao": Fatura Segura, ANUIDADE, AVAL EMERG. CREDITO, Seguro Fatura
- "estorno": estornos, devolucoes, creditos
- "pagamento_antecipado": pagamento antecipado

IGNORE completamente (NAO inclua no JSON):
- "Pagamento Fatura Pix" ou qualquer "Pagamento Fatura" (sao pagamentos do cliente, valor negativo)
- Valores da pagina 1 (Pagamento Total, Minimo, Parcelamento)
- Subtotais, saldos anteriores, cabecalhos

FORMATO DE SAIDA:
- Data: DD/MM/YYYY
- Valor: numero positivo com 2 casas decimais (ex: 506.90, NAO 506,90)
- Parcela: "1/12" se parcelada (ex: "ANUIDADE Int - Parc.1/12" → parcela "1/12"), null se nao

VERIFICACAO: a soma de compras + iof + tarifa_cartao - estornos deve ser proxima de ${totalFatura || 'o total da fatura no PDF'}.

Retorne APENAS um JSON valido, SEM markdown:
{
  "transacoes": [
    {
      "data": "DD/MM/YYYY",
      "descricao": "nome do estabelecimento",
      "valor": 123.45,
      "parcela": "1/12",
      "tipo_lancamento": "compra"
    }
  ],
  "total_encontrado": numero,
  "valor_total": soma_apenas_das_compras,
  "banco_detectado": "Renner/Realize"
}`;
}

// ===== POS-IA CORRECTIONS =====

/**
 * Aplica correcoes pos-IA nas transacoes extraidas.
 *
 * 1. filtrarTransacoesIA: remove entradas que nao sao transacoes reais
 *    (subtotais, saldos anteriores, pagamentos, limites)
 * 2. corrigirEstornosIA: corrige estornos mal-classificados como "compra"
 *    pela IA usando heuristica de divergencia
 *
 * @param {Array} transacoes - Transacoes retornadas pela IA
 * @param {Object} metadados - Metadados para verificacao (total_fatura_pdf)
 * @returns {Array} Transacoes corrigidas
 */
export function postAICorrections(transacoes, metadados) {
  let corrigidas = filtrarTransacoesIA(transacoes);
  corrigidas = corrigirEstornosIA(corrigidas, metadados?.total_fatura_pdf);
  return corrigidas;
}
