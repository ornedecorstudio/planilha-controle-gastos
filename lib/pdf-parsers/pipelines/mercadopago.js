/**
 * Pipeline: Mercado Pago (Metadados + IA Visual Obrigatoria)
 *
 * Parser para faturas de cartao de credito Mercado Pago.
 *
 * Problema central: faturas Mercado Pago usam CIDFont com encoding customizado.
 * Os caracteres internos do PDF sao substituidos — por exemplo:
 *   Visual: "PAYPAL *FACEBOOKSER R$ 3.958,18"
 *   pdf-parse: "PóKPóL B5óíEZOOGSE$ $4 +J%39,19"
 *
 * Isso torna a extracao de texto via pdf-parse/regex fundamentalmente impossivel
 * para transacoes. A unica forma confiavel e a IA visual (Claude le o PDF renderizado).
 *
 * Estrategia (metadata-only + IA visual):
 *   1. Extrai metadados do texto quando possivel (total bruto, cartoes, ano)
 *   2. NAO tenta capturar transacoes (texto corrompido)
 *   3. SEMPRE retorna needsAI: true para forcar IA visual
 *   4. IA visual recebe metadados para verificacao cruzada
 *   5. postAICorrections aplica filtros e correcao de estornos
 *
 * Caracteristicas Mercado Pago:
 * - Encoding CIDFont corrompido (caracteres substituidos em valores e nomes)
 * - Pagina 1: Resumo (Total a pagar, Consumos, Tarifas) — sem transacoes
 * - Pagina 2: "Movimentacoes na fatura" (pagamentos + tarifas) + inicio transacoes
 * - Paginas 2-6: Transacoes do cartao distribuidas em blocos de ~8 por pagina
 * - Cada bloco termina com "Total R$ X.XXX,XX" — TOTAL GERAL, nao subtotal
 * - Pagina 7+: Parcelamento, info do cartao, termos legais — sem transacoes
 * - Transacoes com mesma data e estabelecimento podem ter valores diferentes (nao sao duplicatas)
 * - Parcelamentos: "Parcela X de Y" em coluna separada
 *
 * Interface padrao de pipeline:
 *   extractPipeline(texto, options)  - extrai metadados, retorna zero transacoes, needsAI=true
 *   buildAIPrompt(...)               - prompt especializado para IA visual
 *   postAICorrections(...)           - filtragem + correcao de estornos pos-IA
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

export const BANK_ID = 'mercadopago';

// ===== HELPERS DE METADADOS =====

/**
 * Detecta se o texto extraido pelo pdf-parse esta com encoding corrompido.
 *
 * Faturas Mercado Pago usam CIDFont com mapeamento customizado. O sintoma
 * principal e "$4" aparecendo em vez de "R$" e "J" em vez de "." nos valores.
 *
 * Tabela de substituicao conhecida:
 *   R → $, $ → 4, 3 → 5, 4 → M, 5 → 3, 7 → ), 8 → 9, 9 → %, . → J
 *
 * @param {string} texto - Texto extraido pelo pdf-parse
 * @returns {object} { corrompido: boolean, indicadores: number }
 */
function detectarEncodingCorrompido(texto) {
  let indicadores = 0;

  // "$4" em vez de "R$" — indicador mais forte
  if (/\$4\s+\d/.test(texto)) indicadores += 3;

  // "J" como separador de milhares (ex: "12J495" em vez de "12.495")
  if (/\d{1,3}J\d{3}/.test(texto)) indicadores += 2;

  // Caracteres tipicos do encoding corrompido em contexto de fatura
  if (/PóKPóL|5óíEZOOG|zE\$íóõO/i.test(texto)) indicadores += 2;

  // "aJmJ" ou "aJaJ" (indicador de "a.m." / "a.a." corrompido)
  if (/aJmJ|aJaJ/.test(texto)) indicadores += 1;

  return {
    corrompido: indicadores >= 3,
    indicadores
  };
}

/**
 * Extrai finais de cartao presentes na fatura.
 *
 * Padroes reconhecidos:
 *   - "Cartão Visa [************5415]" (visual)
 *   - "Cartão Visa" ou "Cart" seguido de digitos (texto corrompido)
 *
 * @param {string} texto - Texto extraido do PDF
 * @returns {string[]} Array de finais de cartao (ex: ["5415"])
 */
function extrairCartoes(texto) {
  const cartoes = new Set();

  // Padrao visual: Cartao Visa [****5415]
  const regexCartao = /Cart[aã]o\s+(?:Visa|Master)\s*\[[\*]+(\d{4})\]/gi;
  let match;
  while ((match = regexCartao.exec(texto)) !== null) {
    cartoes.add(match[1]);
  }

  // Padrao corrompido: pode aparecer como "5415" apos asteriscos
  const regexAsteriscos = /\*{4,}(\d{4})\]/g;
  while ((match = regexAsteriscos.exec(texto)) !== null) {
    cartoes.add(match[1]);
  }

  return [...cartoes];
}

/**
 * Extrai o total BRUTO da fatura (Consumos + Tarifas e encargos).
 *
 * O "Total a pagar" no PDF Mercado Pago e o valor LIQUIDO (apos creditos
 * de pagamentos anteriores). Para reconciliacao, precisamos do valor BRUTO
 * que e comparavel com a soma das transacoes extraidas.
 *
 * NOTA: Com encoding corrompido, os valores aparecem como "$4 12J%)%,6+"
 * em vez de "R$ 12.979,63". Os labels ("Consumos de", "Tarifas e encargos")
 * tambem podem estar parcialmente corrompidos. Estas regex tentam capturar
 * ambos os formatos, mas o fallback principal e a IA visual.
 *
 * @param {string} texto - Texto extraido do PDF
 * @returns {object|null} { consumos, tarifas, bruto } ou null
 */
function extrairTotalBrutoFatura(texto) {
  let totalConsumos = 0;
  let totalTarifas = 0;

  // Tentar formato normal primeiro (caso raro de encoding OK)
  const regexConsumosNormal = /Consumos?\s+(?:de\s+)?\d{1,2}\/\d{1,2}\s+a\s+\d{1,2}\/\d{1,2}\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  const matchConsumosNormal = regexConsumosNormal.exec(texto);
  if (matchConsumosNormal) {
    totalConsumos = parseValorBR(matchConsumosNormal[1]);
  }

  // Tentar formato corrompido: "íonsumos de 16/12 a 13/01 $4 12J%)%,6+"
  if (totalConsumos === 0) {
    const regexConsumosCorrupt = /[ií]onsumos?\s+(?:de\s+)?\d{1,2}\/\d{1,2}\s+a\s+\d{1,2}\/\d{1,2}\s+\$4\s+([\d,J%\+\)\(]+)/i;
    const matchCorrupt = regexConsumosCorrupt.exec(texto);
    if (matchCorrupt) {
      // Tentar decodificar valor corrompido usando tabela de substituicao
      const valorDecodificado = decodificarValorCorrompido(matchCorrupt[1]);
      if (valorDecodificado > 0) {
        totalConsumos = valorDecodificado;
      }
    }
  }

  // Tentar tarifas formato normal
  const regexTarifasNormal = /Tarifas?\s+e\s+encargos?\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  const matchTarifasNormal = regexTarifasNormal.exec(texto);
  if (matchTarifasNormal) {
    totalTarifas = parseValorBR(matchTarifasNormal[1]);
  }

  // Tentar tarifas formato corrompido
  if (totalTarifas === 0) {
    const regexTarifasCorrupt = /Tarifas?\s+e\s+encargos?\s+\$4\s+([\d,J%\+\)\(]+)/i;
    const matchTarifasCorrupt = regexTarifasCorrupt.exec(texto);
    if (matchTarifasCorrupt) {
      const valorDecodificado = decodificarValorCorrompido(matchTarifasCorrupt[1]);
      if (valorDecodificado > 0) {
        totalTarifas = valorDecodificado;
      }
    }
  }

  if (totalConsumos > 0) {
    const bruto = parseFloat((totalConsumos + totalTarifas).toFixed(2));
    console.log(`[Mercado Pago Pipeline] Total bruto: consumos=${totalConsumos}, tarifas=${totalTarifas}, bruto=${bruto}`);
    return { consumos: totalConsumos, tarifas: totalTarifas, bruto };
  }

  return null;
}

/**
 * Tenta decodificar um valor monetario com encoding corrompido.
 *
 * Tabela de substituicao do CIDFont Mercado Pago:
 *   0→0, 1→1, 2→2, 3→5, 4→M, 5→3, 6→6, 7→), 8→9, 9→%, .→J, ,→,
 *
 * Invertendo: 0→0, 1→1, 2→2, 3→5, 5→3, 6→6, 9→8, %→9, M→4, )→7, J→.
 *
 * @param {string} corrompido - Valor corrompido (ex: "12J%)%,6+")
 * @returns {number} Valor decodificado ou 0 se falhar
 */
function decodificarValorCorrompido(corrompido) {
  const mapa = {
    '0': '0', '1': '1', '2': '2', '3': '5', '5': '3',
    '6': '6', '9': '8', '%': '9', 'M': '4', ')': '7',
    'J': '.', ',': ',', '+': '4'  // '+' parece mapear para '4' em alguns contextos
  };

  let decodificado = '';
  for (const char of corrompido) {
    decodificado += mapa[char] || char;
  }

  // Tentar parsear como valor BR
  const valor = parseValorBR(decodificado);
  if (valor > 0) {
    console.log(`[Mercado Pago Pipeline] Valor decodificado: "${corrompido}" → "${decodificado}" → ${valor}`);
  }
  return valor;
}

/**
 * Extrai o total da fatura do PDF (valor LIQUIDO — "Total a pagar").
 *
 * ATENCAO: Este valor inclui creditos/pagamentos anteriores e NAO e
 * comparavel com a soma bruta das transacoes. Mantido como fallback.
 *
 * @param {string} texto - Texto extraido do PDF
 * @returns {number|null} Valor liquido ou null
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
 * Detecta o ano de referencia da fatura.
 *
 * @param {string} texto - Texto extraido do PDF
 * @returns {number} Ano de referencia (ex: 2026)
 */
function detectarAnoReferencia(texto) {
  // Tentar vencimento primeiro: "Vencimento: 20/01/2026" ou "20/01/2026"
  const matchVenc = texto.match(/[Vv]encimento[:\s]+(\d{2}\/\d{2}\/(\d{4}))/);
  if (matchVenc) return parseInt(matchVenc[2]);

  // Tentar qualquer data com ano: DD/MM/YYYY
  const matchData = texto.match(/(\d{2}\/\d{2}\/(\d{4}))/);
  if (matchData) {
    const ano = parseInt(matchData[2]);
    if (ano >= 2020 && ano <= 2030) return ano;
  }

  // Tentar "fatura de janeiro" + ano no contexto
  const matchFatura = texto.match(/(?:FATURA|VENCIMENTO).*?(\d{4})/i);
  if (matchFatura) {
    const ano = parseInt(matchFatura[1]);
    if (ano >= 2020 && ano <= 2030) return ano;
  }

  return new Date().getFullYear();
}

// ===== PIPELINE PRINCIPAL =====

/**
 * Extrai metadados de uma fatura Mercado Pago.
 *
 * Mercado Pago SEMPRE usa CIDFont com encoding corrompido, entao o parser
 * deterministico NUNCA conseguira extrair transacoes corretamente via regex.
 * Retorna ZERO transacoes + needsAI=true para SEMPRE forcar IA visual,
 * junto com metadados para o prompt da IA.
 *
 * @param {string} texto - Texto completo extraido do PDF
 * @param {object} [options={}] - Opcoes (nao usadas atualmente)
 * @returns {object} PipelineResult padrao com needsAI: true
 */
export function extractPipeline(texto, options = {}) {
  // 1. Detectar encoding corrompido (para logging e diagnostico)
  const encoding = detectarEncodingCorrompido(texto);
  console.log(`[Mercado Pago Pipeline] Encoding corrompido: ${encoding.corrompido} (indicadores: ${encoding.indicadores})`);

  // 2. Extrair ano de referencia
  const anoReferencia = detectarAnoReferencia(texto);
  console.log(`[Mercado Pago Pipeline] Ano referencia: ${anoReferencia}`);

  // 3. Extrair totais (podem funcionar parcialmente mesmo com encoding corrompido)
  const totalBruto = extrairTotalBrutoFatura(texto);
  const totalLiquido = extrairTotalFaturaPDF(texto);

  // Para reconciliacao, preferir bruto (comparavel com soma das transacoes)
  const totalParaReconciliacao = totalBruto?.bruto || totalLiquido;
  console.log(`[Mercado Pago Pipeline] Total para reconciliacao: ${totalParaReconciliacao} (bruto: ${totalBruto?.bruto}, liquido: ${totalLiquido})`);

  // 4. Detectar cartoes presentes
  const cartoes = extrairCartoes(texto);
  console.log(`[Mercado Pago Pipeline] Cartoes detectados: ${JSON.stringify(cartoes)}`);

  // 5. SEMPRE forcar IA visual — encoding corrompido impede parsing deterministico
  console.log('[Mercado Pago Pipeline] SEMPRE needsAI=true: Mercado Pago usa CIDFont com encoding corrompido — forcando IA visual');

  // Auditoria com zero transacoes + metadados do PDF
  const auditoria = calcularAuditoria([], totalParaReconciliacao);

  return {
    success: true,
    transacoes: [],           // ZERO transacoes — IA visual vai extrair
    total_encontrado: 0,
    valor_total: 0,
    banco_detectado: 'Mercado Pago',
    metodo: 'PARSER_DETERMINISTICO',
    auditoria,
    needsAI: true,            // SEMPRE true
    metadados_verificacao: {
      total_fatura_pdf: totalParaReconciliacao,
      total_liquido_pdf: totalLiquido,
      subtotais_bruto: totalBruto,
      cartoes,
      ano_referencia: anoReferencia,
      encoding_corrompido: encoding.corrompido,
    }
  };
}

// ===== INTERFACE IA =====

/**
 * Constroi prompt especializado para IA visual analisar fatura Mercado Pago.
 *
 * O prompt explica a estrutura exata do PDF (baseada em analise de faturas reais),
 * inclui metadados para verificacao cruzada, e instrui a IA a extrair transacoes
 * de todas as paginas, incluindo tarifas da secao "Movimentacoes na fatura".
 *
 * Pontos criticos do prompt:
 * - "Movimentacoes na fatura" mistura pagamentos (ignorar) com tarifas (incluir)
 * - Transacoes do cartao espalhadas em 4-6 paginas sob mesmo cabecalho
 * - "Total R$ X.XXX,XX" ao final de cada bloco e o TOTAL GERAL, nao subtotal
 * - Transacoes com mesma data/estabelecimento e valores diferentes NAO sao duplicatas
 * - total_a_pagar deve ser o valor BRUTO (Consumos + Tarifas), nao o liquido
 *
 * @param {string} cartaoNome - Nome do cartao (ex: "Visa final 5415")
 * @param {string} tipoCartao - Tipo do cartao (fisico, virtual, etc.)
 * @param {object} metadados - Metadados extraidos pelo extractPipeline
 * @returns {string} Prompt formatado para IA visual
 */
export function buildAIPrompt(cartaoNome, tipoCartao, metadados) {
  const anoRef = metadados?.ano_referencia || new Date().getFullYear();

  const cartoesInfo = metadados?.cartoes?.length > 0
    ? metadados.cartoes.map(c => `final ${c}`).join(', ')
    : null;

  // Montar bloco de metadados para verificacao cruzada
  let metadadosBloco = '';
  const totalBruto = metadados?.subtotais_bruto;
  const totalLiquido = metadados?.total_liquido_pdf;
  const totalReconciliacao = metadados?.total_fatura_pdf;

  if (totalBruto || totalLiquido || cartoesInfo) {
    metadadosBloco = `
<metadados_pdf>
Dados extraidos automaticamente do PDF para verificacao cruzada:`;
    if (totalBruto) {
      metadadosBloco += `\n- Consumos do periodo: R$ ${totalBruto.consumos?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
      metadadosBloco += `\n- Tarifas e encargos: R$ ${totalBruto.tarifas?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
      metadadosBloco += `\n- Total bruto (para reconciliacao): R$ ${totalBruto.bruto?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    }
    if (totalLiquido) {
      metadadosBloco += `\n- Total a pagar (liquido, inclui pagamentos anteriores): R$ ${totalLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    }
    if (cartoesInfo) metadadosBloco += `\n- Cartoes presentes: ${cartoesInfo}`;
    metadadosBloco += `\n- Ano de referencia: ${anoRef}`;
    metadadosBloco += `\n</metadados_pdf>`;
  }

  const totalBrutoStr = totalReconciliacao
    ? `R$ ${totalReconciliacao.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    : 'o valor indicado no resumo da fatura (Consumos + Tarifas)';

  return `Voce e um especialista em extrair transacoes de faturas de cartao de credito Mercado Pago.
Analise este PDF de fatura do cartao "${cartaoNome}"${tipoCartao ? ` (cartao ${tipoCartao})` : ''} e extraia todas as transacoes.
${metadadosBloco}

<estrutura_pdf>
Faturas Mercado Pago tem a seguinte organizacao:

PAGINA 1 — RESUMO (nao contem transacoes individuais):
- "Total a pagar": valor LIQUIDO da fatura (inclui pagamentos anteriores, juros, etc.)
- "Resumo da fatura": Consumos do periodo, Tarifas e encargos, Multas, Total da fatura anterior, Pagamentos e creditos devolvidos
- O valor "Consumos de DD/MM a DD/MM" e o total BRUTO das compras do cartao
- Opcoes de parcelamento e pagamento minimo — NAO sao transacoes

PAGINA 2 — MOVIMENTACOES NA FATURA + INICIO DAS TRANSACOES:
- Secao "Movimentacoes na fatura": contem 2 tipos de itens misturados:
  a) "Pagamento da fatura de [mes]/[ano]" → IGNORAR (sao pagamentos feitos pelo cliente ao banco)
  b) "Tarifa de uso do credito emergencial" ou outras tarifas → INCLUIR como tipo "tarifa_cartao"
- Secao "Cartao Visa [****XXXX]": inicio das transacoes reais do cartao

PAGINAS 2 a 6 — TRANSACOES DO CARTAO (distribuidas em multiplas paginas):
- As transacoes de um mesmo cartao aparecem em blocos de ~8 transacoes por pagina
- Cada bloco repete o cabecalho "Cartao Visa [****XXXX]" e termina com "Total R$ X.XXX,XX"
- O "Total" que aparece ao final de cada bloco e o TOTAL GERAL de consumos do cartao inteiro, NAO um subtotal daquela pagina. Ele se repete identico em todas as paginas. IGNORE esses totais.
- As transacoes de TODAS as paginas pertencem ao mesmo cartao

PAGINAS 7+ — INFORMACOES FINANCEIRAS (nao contem transacoes):
- Opcoes de parcelamento de fatura
- Informacoes do cartao (limites, saques, lancamentos futuros)
- Termos legais e contatos
</estrutura_pdf>

<regras_extracao>
1. Extraia TODAS as transacoes individuais de TODAS as paginas de "Detalhes de consumo".
2. Inclua tarifas da secao "Movimentacoes na fatura" (ex: "Tarifa de uso do credito emergencial").
3. Use o ano ${anoRef} para completar datas que aparecem apenas como DD/MM.
4. Cada transacao deve ter: data, descricao, valor, parcela e tipo_lancamento.

Sobre transacoes que parecem duplicadas:
- E NORMAL ter multiplas transacoes com a mesma data e mesmo estabelecimento mas valores DIFERENTES.
  Exemplo: 6x "PAYPAL *FACEBOOKSER" no dia 17/12 com valores distintos (R$ 3.958,18, R$ 153,21, R$ 154,17, etc.)
  Essas NAO sao duplicatas — sao transacoes separadas que devem ser incluidas individualmente.
- So considere duplicata se data, descricao E valor forem IDENTICOS.

Classificacao de tipo_lancamento (obrigatoria em cada transacao):
- "compra": compras normais em lojas, sites, assinaturas, parcelamentos, servicos.
- "iof": linhas contendo "IOF" (Imposto sobre Operacoes Financeiras).
- "estorno": estornos, creditos na fatura, devolucoes, reembolsos, cashback, bonificacoes.
  Valores negativos no PDF sao estornos. Capture-os com valor positivo e tipo "estorno".
- "tarifa_cartao": tarifas do cartao, anuidade, seguro fatura, tarifa emergencial.
  "Tarifa de uso do credito emergencial" da secao Movimentacoes = tarifa_cartao.
- "pagamento_antecipado": pagamento antecipado de parcelas futuras.
</regras_extracao>

<o_que_ignorar>
NAO inclua no JSON nenhum dos itens abaixo:
- "Pagamento da fatura de [mes]/[ano]" (sao pagamentos feitos pelo cliente — incluir quebraria a reconciliacao)
- Linhas de "Total" que aparecem ao final de cada bloco de cartao (sao o total geral repetido)
- Subtotais e somas parciais
- Saldo anterior e limites de credito
- Informacoes financeiras: juros, CET, parcelamento de fatura, credito rotativo
- Opcoes de pagamento (pagamento minimo, parcelamento)
- Lancamentos futuros, compras parceladas a vencer
- Endereco, codigo de barras, dados de correspondencia, termos legais
</o_que_ignorar>

<reconciliacao>
Para verificar se a extracao esta completa e correta:

  soma(compras) + soma(iof) + soma(tarifa_cartao) - soma(estornos) - soma(pagamento_antecipado) = total bruto

O total bruto esperado e ${totalBrutoStr}.
O total bruto e a soma de "Consumos do periodo" + "Tarifas e encargos" do resumo da pagina 1.
NAO confundir com "Total a pagar" que e o valor liquido (descontados pagamentos anteriores).

Se a diferenca entre o calculado e o esperado for maior que R$ 5,00, revise:
- Verifique se algum "Pagamento da fatura" foi incluido por engano
- Verifique se a "Tarifa de uso do credito emergencial" foi incluida como tarifa_cartao
- Verifique se todas as paginas de transacoes foram processadas (transacoes continuam por 4-5 paginas)
- Verifique se transacoes com mesma data/estabelecimento mas valores diferentes foram incluidas separadamente
</reconciliacao>

<formato_saida>
Retorne apenas um JSON valido, sem markdown e sem comentarios:
{
  "transacoes": [
    {
      "data": "DD/MM/YYYY",
      "descricao": "descricao da transacao como aparece no PDF",
      "valor": 123.45,
      "parcela": "13/18" ou null,
      "tipo_lancamento": "compra"
    }
  ],
  "total_encontrado": numero_total_de_transacoes,
  "valor_total": soma_apenas_das_compras,
  "banco_detectado": "Mercado Pago",
  "total_a_pagar": valor_bruto_consumos_mais_tarifas
}

Regras do JSON:
- "data": formato DD/MM/YYYY, usando o ano ${anoRef}. Se a data for DD/MM sem ano, adicione ${anoRef}. Datas de dezembro usam ${anoRef - 1} se o vencimento for em janeiro/${anoRef}.
- "descricao": texto original da transacao como aparece no PDF (nomes de estabelecimentos).
- "valor": numero decimal positivo com ponto como separador (ex: 3958.18), mesmo para estornos.
- "parcela": string "X/Y" se houver parcela (ex: "13/18"), ou null se nao houver.
- "tipo_lancamento": obrigatoriamente uma das opcoes: "compra", "iof", "estorno", "tarifa_cartao", "pagamento_antecipado".
- "total_encontrado": quantidade total de transacoes no array.
- "valor_total": soma apenas das transacoes com tipo_lancamento "compra".
- "banco_detectado": sempre "Mercado Pago".
- "total_a_pagar": valor BRUTO da fatura = Consumos + Tarifas e encargos (NAO o "Total a pagar" liquido da pagina 1).
</formato_saida>`;
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
