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
 *   - buildAIPrompt(cartaoNome, tipoCartao, metadados) -> prompt de extracao para IA (fallback)
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
 * buildAIPrompt - Gera prompt de extracao para IA quando o parser deterministico
 * nao consegue extrair todas as transacoes (ex: layouts inesperados, cartoes
 * adicionais com formatacao diferente, ou PDFs escaneados).
 *
 * O prompt segue boas praticas Claude Opus 4.6:
 * - Instrucoes diretas e explicitas em linguagem natural
 * - XML tags para estrutura
 * - Contexto/motivacao para cada regra
 * - Formato de saida JSON especificado com exemplos
 *
 * @param {string} cartaoNome - Nome do cartao (ex: "C6 Bank Cartao Virtual")
 * @param {string} tipoCartao - Tipo do cartao (ex: "virtual", "fisico")
 * @param {Object} metadados - Metadados extraidos pelo parser deterministico
 * @returns {string} Prompt completo para a IA
 */
export function buildAIPrompt(cartaoNome, tipoCartao, metadados) {
  const totalFatura = metadados?.total_fatura_pdf
    ? `R$ ${metadados.total_fatura_pdf.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    : null;

  let metadadosBloco = '';
  if (totalFatura) {
    metadadosBloco = `
<metadados_parser>
O parser deterministico extraiu os seguintes dados do PDF para verificacao cruzada:
- Total da fatura (Total a Pagar): ${totalFatura}
</metadados_parser>`;
  }

  return `Voce e um especialista em extrair transacoes de faturas de cartao de credito C6 Bank.
Analise este PDF de fatura do cartao "${cartaoNome}"${tipoCartao ? ` (cartao ${tipoCartao})` : ''} e extraia todas as transacoes.
${metadadosBloco}

<estrutura_pdf>
Faturas do C6 Bank podem conter multiplos cartoes (virtual, fisico, adicionais), e cada cartao tem sua propria secao de transacoes no PDF. Voce precisa extrair transacoes de todos os cartoes presentes.

Formato tipico de cada transacao:
- Transacoes nacionais: DATA | DESCRICAO | R$ VALOR
- Transacoes internacionais: DATA | DESCRICAO | USD XX.XX | BRL YYY,YY (use sempre o valor em BRL)
- IOF aparece como linha separada apos transacoes internacionais
- Parcelamentos aparecem como "Parcela X/Y" ou "X/Y" na descricao
</estrutura_pdf>

<regras_extracao>
1. Extraia transacoes de todos os cartoes presentes no PDF, sem duplicar nenhuma.
2. Para transacoes internacionais, use o valor convertido em BRL (o ultimo valor da linha), porque a planilha trabalha apenas em reais.
3. Datas devem estar no formato DD/MM/YYYY. Se o PDF mostrar apenas DD/MM, adicione o ano com base no vencimento ou fechamento da fatura.
4. Valores devem ser numeros positivos (ex: 1234.56), mesmo para estornos.
</regras_extracao>

<classificacao_tipo_lancamento>
Cada transacao precisa ter um campo tipo_lancamento. Isso e necessario para que a formula de reconciliacao funcione corretamente.

Os tipos possiveis sao:
- "compra": compras nacionais e internacionais, incluindo parcelamentos (PAYPAL*, FACEBK*, lojas, restaurantes, assinaturas, servicos)
- "iof": linhas que contem "IOF" ou "Imposto sobre Operacoes Financeiras" — aparecem apos transacoes internacionais e sao um imposto, nao uma compra
- "estorno": estornos, creditos na fatura, devolucoes, reembolsos, cashback, bonificacoes — qualquer valor com sinal negativo ("-") no PDF e um estorno
- "pagamento_antecipado": pagamento antecipado de parcelas ou pagamento parcial
- "tarifa_cartao": anuidade, tarifa do cartao, seguro fatura, fatura segura
</classificacao_tipo_lancamento>

<valores_negativos>
Valores precedidos por "-" (sinal de menos) no PDF representam estornos ou creditos.
Exemplo: "ESTORNO COMPRA LOJA X -150,00" deve virar tipo_lancamento: "estorno", valor: 150.00
Capture o valor como numero positivo no JSON. O campo tipo_lancamento "estorno" ja indica que e uma deducao.
Nunca classifique um valor negativo como "compra".
</valores_negativos>

<itens_ignorar>
Nao inclua no JSON os seguintes itens, porque eles nao sao transacoes reais de compra e distorcem a reconciliacao:
- "Pagamento de fatura" ou "Pagamento recebido" (e o pagamento que o cliente fez, nao uma compra)
- Subtotais de secao ("Subtotal", "Total do cartao") — sao somas parciais, nao transacoes
- Saldo anterior, limite de credito disponivel, limite total
- Encargos, juros de mora, multa por atraso (sao custos financeiros, nao compras)
- Cabecalhos de secao e informacoes de correspondencia
</itens_ignorar>

<verificacao_cruzada>
A formula de reconciliacao e:
  compras + iof + tarifa_cartao - estornos - pagamento_antecipado = total da fatura

A soma deve ser proxima de ${totalFatura || 'o total da fatura indicado no PDF'}.
Se a diferenca for maior que R$ 5,00, revise os seguintes pontos comuns de erro:
- Valores negativos classificados como "compra" em vez de "estorno"
- IOF classificado como "compra" em vez de "iof"
- Subtotais ou pagamentos de fatura incluidos por engano
- Transacoes de algum cartao adicional que foram esquecidas
</verificacao_cruzada>

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
  "banco_detectado": "C6 Bank"
}
</formato_saida>`;
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
