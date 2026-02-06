/**
 * Parser de Fatura C6 Bank
 *
 * Características:
 * - Pode ter MÚLTIPLOS cartões (virtual, físico, adicionais)
 * - Cada cartão tem sua própria seção de transações
 * - Transações internacionais mostram valor em USD + valor convertido em BRL + IOF separado
 * - Usar SEMPRE o valor em BRL (convertido), IGNORAR o valor em USD
 * - Parcelamentos aparecem como "Parcela X/Y"
 * - Classifica cada transação com tipo_lancamento (compra, iof, estorno, pagamento_antecipado)
 * - Extrai "Total a pagar" do resumo e constrói objeto de reconciliação
 */

import { parseValorBR, parseDataBR, extrairParcela } from './index.js';

// Keywords para classificação de tipo_lancamento
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

// Termos a ignorar completamente (não geram transação)
const ignorar = [
  'PAGAMENTO FATURA',
  'PAGAMENTO RECEBIDO',
  'ANUIDADE',
  'TARIFA',
  'ENCARGO',
  'JUROS',
  'MULTA'
];

/**
 * Classifica uma descrição de transação em tipo_lancamento.
 * Ordem de prioridade:
 *   1. pagamento_antecipado
 *   2. estorno
 *   3. iof
 *   4. ignorar (retorna null)
 *   5. compra (default)
 */
function classificarTipoLancamento(descUpper) {
  // 1. Pagamento antecipado (verificar ANTES da lista ignorar)
  if (keywordsPagamentoAntecipado.some(kw => descUpper.includes(kw))) {
    return 'pagamento_antecipado';
  }

  // 2. Estorno / crédito
  if (keywordsEstorno.some(kw => descUpper.includes(kw))) {
    return 'estorno';
  }

  // 3. IOF
  if (descUpper.includes('IOF') || descUpper.includes('IMPOSTO OPERACOES FINANCEIRAS')) {
    return 'iof';
  }

  // 4. Ignorar (pagamento de fatura, anuidade, tarifa, etc.)
  if (ignorar.some(termo => descUpper.includes(termo))) {
    return null; // sinaliza que deve ser pulado
  }

  // 5. Compra normal
  return 'compra';
}

/**
 * Extrai o "Total a pagar" do texto do PDF.
 * Busca padrões como "Total a pagar R$ 13.651,74"
 */
function extrairTotalFaturaPDF(texto) {
  const regexTotalFatura = /(?:TOTAL\s+(?:A\s+)?PAGAR|VALOR\s+TOTAL\s+(?:DESTA\s+)?FATURA|TOTAL\s+DA\s+FATURA)\s*:?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;

  let match;
  let ultimoValor = null;

  // Pega o último match (geralmente o total consolidado)
  while ((match = regexTotalFatura.exec(texto)) !== null) {
    ultimoValor = parseValorBR(match[1]);
  }

  return ultimoValor;
}

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
   * Tenta adicionar uma transação à lista.
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

  // Padrão 1: Transações nacionais
  // DATA | DESCRIÇÃO | VALOR
  const regexNacional = /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+?)\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/gm;
  let match;

  while ((match = regexNacional.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valor = parseValorBR(match[3]);
    const parcela = extrairParcela(descricao);
    adicionarTransacao(data, descricao, valor, parcela);
  }

  // Padrão 2: Transações internacionais C6
  // Formato típico: DATA | DESCRIÇÃO | USD XX.XX | BRL YYY,YY
  const regexInternacional = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+(?:USD|US\$)\s*[\d.,]+\s+(?:BRL|R\$)\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;

  while ((match = regexInternacional.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valorBRL = parseValorBR(match[3]);
    adicionarTransacao(data, descricao, valorBRL, null);
  }

  // Padrão 3: Detectar seções de cartões diferentes
  // C6 separa por "Cartão virtual", "Cartão físico", etc.
  const regexSecaoCartao = /(CART[ÃA]O\s+(?:VIRTUAL|F[ÍI]SICO|ADICIONAL|FINAL\s+\d{4}))/gi;
  let secoesCartao = [];

  while ((match = regexSecaoCartao.exec(texto)) !== null) {
    secoesCartao.push({
      tipo: match[1],
      inicio: match.index
    });
  }

  // Processa cada seção
  for (let i = 0; i < secoesCartao.length; i++) {
    const inicio = secoesCartao[i].inicio;
    const fim = secoesCartao[i + 1]?.inicio || texto.length;
    const secao = texto.substring(inicio, fim);

    // Extrai transações da seção
    const regexSecao = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g;

    while ((match = regexSecao.exec(secao)) !== null) {
      const data = parseDataBR(match[1], anoReferencia);
      const descricao = match[2].trim();
      const valor = parseValorBR(match[3]);
      adicionarTransacao(data, descricao, valor, extrairParcela(descricao));
    }
  }

  // Padrão 4: Formato de lista simples C6
  // Algumas faturas C6 vêm em formato mais simples
  const linhas = texto.split('\n').map(l => l.trim()).filter(l => l);

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];

    // Procura linha que começa com data
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

  // === Calcular resumo_fatura com reconciliação ===
  const totalCompras = transacoes
    .filter(t => t.tipo_lancamento === 'compra')
    .reduce((sum, t) => sum + t.valor, 0);

  const iof = transacoes
    .filter(t => t.tipo_lancamento === 'iof')
    .reduce((sum, t) => sum + t.valor, 0);

  const estornos = transacoes
    .filter(t => t.tipo_lancamento === 'estorno')
    .reduce((sum, t) => sum + t.valor, 0);

  const pagamentoAntecipado = transacoes
    .filter(t => t.tipo_lancamento === 'pagamento_antecipado')
    .reduce((sum, t) => sum + t.valor, 0);

  const totalFaturaPDF = extrairTotalFaturaPDF(texto);
  const totalFaturaCalculado = parseFloat((totalCompras + iof - estornos - pagamentoAntecipado).toFixed(2));

  let reconciliado = null;
  let diferencaCentavos = null;

  if (totalFaturaPDF !== null) {
    diferencaCentavos = Math.round((totalFaturaPDF - totalFaturaCalculado) * 100);
    reconciliado = Math.abs(diferencaCentavos) <= 1;
  }

  // valor_total = total_compras para compatibilidade (sem IOF, estornos, pgto antecipado)
  const valorTotal = parseFloat(totalCompras.toFixed(2));

  return {
    transacoes,
    total_encontrado: transacoes.length,
    valor_total: valorTotal,
    banco_detectado: 'C6 Bank',
    resumo_fatura: {
      total_compras: parseFloat(totalCompras.toFixed(2)),
      iof: parseFloat(iof.toFixed(2)),
      estornos: parseFloat(estornos.toFixed(2)),
      pagamento_antecipado: parseFloat(pagamentoAntecipado.toFixed(2)),
      total_fatura_pdf: totalFaturaPDF,
      total_fatura_calculado: totalFaturaCalculado,
      reconciliado,
      diferenca_centavos: diferencaCentavos,
      equacao: `${totalCompras.toFixed(2)} + ${iof.toFixed(2)} - ${estornos.toFixed(2)} - ${pagamentoAntecipado.toFixed(2)} = ${totalFaturaCalculado.toFixed(2)}`
    }
  };
}
