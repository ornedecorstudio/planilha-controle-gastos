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

// ===== INTERFACE IA =====

/**
 * Gera prompt de extracao para IA visual processar faturas Mercado Pago.
 *
 * Embora o parser deterministico funcione bem na maioria dos casos,
 * este prompt serve como fallback quando o texto extraido pelo pdf-parse
 * nao e suficiente (layout mobile corrompido, novas versoes do PDF, etc.).
 *
 * @param {string} cartaoNome - Nome do cartao (ex: "Visa final 1234")
 * @param {string} tipoCartao - Tipo do cartao (fisico, virtual, etc.)
 * @param {object} metadados - Metadados extraidos pelo extractPipeline
 * @returns {string} Prompt formatado para IA
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

  const anoRef = metadados?.ano_referencia || new Date().getFullYear();

  let metadadosBloco = '';
  if (totalFatura || cartoesInfo || subtotaisInfo) {
    metadadosBloco = `
<metadados_pdf>
Dados extraidos automaticamente do PDF para verificacao cruzada:`;
    if (totalFatura) metadadosBloco += `\n- Total da fatura (Total a pagar): ${totalFatura}`;
    if (cartoesInfo) metadadosBloco += `\n- Cartoes presentes na fatura: ${cartoesInfo}`;
    if (subtotaisInfo) metadadosBloco += `\n- Subtotais por cartao: ${subtotaisInfo}`;
    metadadosBloco += `\n- Ano de referencia: ${anoRef}`;
    metadadosBloco += `\n</metadados_pdf>`;
  }

  return `Voce e um especialista em extrair transacoes de faturas de cartao de credito Mercado Pago.
Analise este PDF de fatura do cartao "${cartaoNome}"${tipoCartao ? ` (cartao ${tipoCartao})` : ''} e extraia todas as transacoes.
${metadadosBloco}

<estrutura_pdf>
Faturas Mercado Pago tem a seguinte organizacao:

- Primeira pagina: resumo com "Total a pagar", dados do cliente e opcoes de pagamento.
  Essa pagina nao contem transacoes individuais.

- Paginas seguintes: secoes de transacoes organizadas por cartao (fisico, virtual).
  Cada secao de cartao comeca com o nome e ultimos digitos (ex: "Cartao final 1234").
  Dentro de cada secao, as transacoes aparecem com data, descricao e valor.

- Layout mobile/minimalista: data, descricao e valor podem aparecer em linhas separadas
  em vez de uma unica linha. Isso e normal neste banco.

- Parcelamentos aparecem como "Parcela X de Y" na descricao.

- A secao "Movimentacoes na fatura" (quando presente) contem itens do ciclo
  de cobranca ANTERIOR. Esses itens ja foram cobrados na fatura passada e nao
  devem ser extraidos novamente.
</estrutura_pdf>

<regras_extracao>
1. Extraia transacoes de todos os cartoes presentes na fatura (${cartoesInfo || 'verifique todos os cartoes no PDF'}).
2. Cada transacao precisa ter: data, descricao, valor e tipo de lancamento.
3. Use o ano ${anoRef} para completar datas que aparecem apenas como DD/MM.
4. Nao duplique transacoes que aparecem em mais de uma secao.

Classificacao de tipo_lancamento (obrigatoria em cada transacao):
- "compra": compras normais em lojas, sites, assinaturas, parcelamentos, servicos.
- "iof": linhas contendo "IOF" (Imposto sobre Operacoes Financeiras).
- "estorno": estornos, creditos na fatura, devolucoes, reembolsos, cashback, bonificacoes.
  Valores negativos no PDF sao estornos. Capture-os com valor positivo e tipo "estorno".
- "tarifa_cartao": anuidade, tarifas do cartao, seguro fatura.
- "pagamento_antecipado": pagamento antecipado de parcelas futuras.
</regras_extracao>

<o_que_ignorar>
Nao inclua no JSON nenhum dos itens abaixo, porque nao sao transacoes de compra:
- "Pagamento de fatura" / "Pagamento recebido" / "Pagamento efetuado"
  (sao pagamentos feitos pelo cliente para quitar a fatura anterior)
- Subtotais e totais de secao ("Total", "Subtotal")
  (sao somas parciais, nao transacoes individuais)
- Saldo anterior e limites de credito
  (sao informacoes de contexto, nao compras)
- Secao "Movimentacoes na fatura"
  (contem lancamentos do ciclo anterior, ja cobrados antes)
- Informacoes financeiras: juros, CET, parcelamento de fatura, credito rotativo
- Endereco, codigo de barras, dados de correspondencia
</o_que_ignorar>

<reconciliacao>
Para verificar se a extracao esta correta, use esta formula:

  compras + iof + tarifa_cartao - estornos - pagamento_antecipado = total da fatura

A soma deve ser proxima de ${totalFatura || 'o total informado no PDF'}.
Se a diferenca for maior que R$ 5,00, revise:
- Valores negativos devem ser classificados como "estorno", nao como "compra".
- IOF deve ser classificado como "iof", nao como "compra".
- Pagamentos de fatura e subtotais nao devem estar na lista.
- Verifique se nao faltam transacoes de algum cartao ou pagina.
</reconciliacao>

<formato_saida>
Retorne apenas um JSON valido, sem markdown e sem comentarios:
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
  "banco_detectado": "Mercado Pago"
}

Regras do JSON:
- "data": formato DD/MM/YYYY, usando o ano ${anoRef}.
- "descricao": texto original da transacao como aparece no PDF.
- "valor": numero decimal positivo (ex: 49.90), mesmo para estornos.
- "parcela": string "X/Y" se houver parcelamento, ou null se nao houver.
- "tipo_lancamento": uma das opcoes listadas acima, obrigatoriamente.
- "total_encontrado": quantidade total de transacoes no array.
- "valor_total": soma apenas das transacoes com tipo_lancamento "compra".
- "banco_detectado": sempre "Mercado Pago".
</formato_saida>`;
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
