/**
 * Utilitários compartilhados para parsers de PDF de faturas.
 *
 * Todas as funções auxiliares (conversão de valores, datas, parcelas)
 * e funções de auditoria/reconciliação vivem aqui para evitar duplicação.
 */

// ===== CONVERSÃO DE VALORES =====

/**
 * Converte valor brasileiro (1.234,56) para número.
 */
export function parseValorBR(valorStr) {
  if (!valorStr) return 0;

  let limpo = valorStr.toString().trim()
    .replace(/R\$\s*/gi, '')
    .replace(/\s+/g, '');

  const temVirgula = limpo.includes(',');
  const temPonto = limpo.includes('.');

  if (temVirgula && temPonto) {
    limpo = limpo.replace(/\./g, '').replace(',', '.');
  } else if (temVirgula) {
    limpo = limpo.replace(',', '.');
  }

  const valor = parseFloat(limpo);
  return isNaN(valor) ? 0 : Math.abs(valor);
}

// ===== CONVERSÃO DE DATAS =====

/**
 * Converte data DD/MM/YYYY ou DD/MM ou DD MMM para YYYY-MM-DD.
 */
export function parseDataBR(dataStr, anoReferencia = new Date().getFullYear()) {
  if (!dataStr) return null;

  const limpo = dataStr.trim();

  // Formato DD/MM/YYYY
  let match = limpo.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const [, dia, mes, ano] = match;
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }

  // Formato DD/MM/YY
  match = limpo.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})/);
  if (match) {
    const [, dia, mes, anoShort] = match;
    const ano = parseInt(anoShort) > 50 ? `19${anoShort}` : `20${anoShort}`;
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }

  // Formato DD/MM (sem ano)
  match = limpo.match(/(\d{1,2})\/(\d{1,2})/);
  if (match) {
    const [, dia, mes] = match;
    return `${anoReferencia}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }

  // Formato DD MMM (ex: 15 DEZ)
  const meses = {
    'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04',
    'MAI': '05', 'JUN': '06', 'JUL': '07', 'AGO': '08',
    'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12'
  };
  match = limpo.toUpperCase().match(/(\d{1,2})\s*(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)/);
  if (match) {
    const [, dia, mesNome] = match;
    const mes = meses[mesNome];
    return `${anoReferencia}-${mes}-${dia.padStart(2, '0')}`;
  }

  return null;
}

// ===== EXTRAÇÃO DE PARCELA =====

/**
 * Extrai parcela do texto (ex: "2/10", "PARCELA 2 DE 10").
 */
export function extrairParcela(texto) {
  if (!texto) return null;

  const textoUpper = texto.toUpperCase();

  // Formato X/Y
  let match = textoUpper.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (match) {
    return `${match[1]}/${match[2]}`;
  }

  // Formato PARCELA X DE Y
  match = textoUpper.match(/PARC(?:ELA)?\s*(\d{1,2})\s*(?:DE|\/)\s*(\d{1,2})/);
  if (match) {
    return `${match[1]}/${match[2]}`;
  }

  // Formato PARC XX/YY
  match = textoUpper.match(/PARC\s*(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (match) {
    return `${match[1]}/${match[2]}`;
  }

  return null;
}

// ===== AUDITORIA / RECONCILIAÇÃO =====

/**
 * Calcula o objeto de auditoria/reconciliação padrão a partir de transações.
 *
 * Fórmula: total = compras + iof + tarifa_cartao - estornos - pagamento_antecipado
 *
 * @param {Array} transacoes - Array de transações com tipo_lancamento
 * @param {number|null} totalFaturaPDF - Total extraído do PDF para verificação
 * @returns {Object} Objeto auditoria padrão
 */
export function calcularAuditoria(transacoes, totalFaturaPDF = null) {
  const totalCompras = transacoes
    .filter(t => (t.tipo_lancamento || 'compra') === 'compra')
    .reduce((sum, t) => sum + (t.valor || 0), 0);

  const iof = transacoes
    .filter(t => t.tipo_lancamento === 'iof')
    .reduce((sum, t) => sum + (t.valor || 0), 0);

  const estornos = transacoes
    .filter(t => t.tipo_lancamento === 'estorno')
    .reduce((sum, t) => sum + (t.valor || 0), 0);

  const pagamentoAntecipado = transacoes
    .filter(t => t.tipo_lancamento === 'pagamento_antecipado')
    .reduce((sum, t) => sum + (t.valor || 0), 0);

  const tarifaCartao = transacoes
    .filter(t => t.tipo_lancamento === 'tarifa_cartao')
    .reduce((sum, t) => sum + (t.valor || 0), 0);

  const totalFaturaCalculado = parseFloat(
    (totalCompras + iof + tarifaCartao - estornos - pagamentoAntecipado).toFixed(2)
  );

  let reconciliado = null;
  let diferencaCentavos = null;

  if (totalFaturaPDF !== null && totalFaturaPDF !== undefined) {
    diferencaCentavos = Math.round((totalFaturaPDF - totalFaturaCalculado) * 100);
    reconciliado = Math.abs(diferencaCentavos) <= 1;
  }

  return {
    total_compras: parseFloat(totalCompras.toFixed(2)),
    iof: parseFloat(iof.toFixed(2)),
    estornos: parseFloat(estornos.toFixed(2)),
    pagamento_antecipado: parseFloat(pagamentoAntecipado.toFixed(2)),
    tarifa_cartao: parseFloat(tarifaCartao.toFixed(2)),
    total_fatura_pdf: totalFaturaPDF,
    total_fatura_calculado: totalFaturaCalculado,
    reconciliado,
    diferenca_centavos: diferencaCentavos,
    equacao: `${totalCompras.toFixed(2)} + ${iof.toFixed(2)} + ${tarifaCartao.toFixed(2)} - ${estornos.toFixed(2)} - ${pagamentoAntecipado.toFixed(2)} = ${totalFaturaCalculado.toFixed(2)}`
  };
}

// ===== PÓS-PROCESSAMENTO IA =====

/**
 * Filtra transações da IA removendo entradas que não são transações reais.
 * Lista universal de descrições bloqueadas aplicável a todos os bancos.
 */
export function filtrarTransacoesIA(transacoes) {
  const DESCRICOES_IGNORAR = [
    'SUBTOTAL', 'SUB TOTAL', 'SUB-TOTAL',
    'TOTAL GERAL', 'TOTAL DOS LANCAMENTOS', 'TOTAL DOS LANÇAMENTOS',
    'VALOR TOTAL', 'TOTAL DESPESAS',
    'TOTAL DE PAGAMENTOS', 'TOTAL DE CREDITOS', 'TOTAL DE CRÉDITOS',
    'SALDO ANTERIOR', 'SALDO DESTA FATURA',
    'PAGAMENTO DE FATURA', 'PAGAMENTO RECEBIDO',
    'PAGAMENTO EFETUADO', 'PAGAMENTO FATURA',
    'SEU LIMITE', 'LIMITE DISPONIVEL', 'LIMITE DISPONÍVEL',
    'LIMITE TOTAL', 'LIMITE DE SAQUE',
    'PAGAMENTO TOTAL', 'PAGAMENTO MINIMO', 'PAGAMENTO MÍNIMO',
  ];

  return transacoes.filter(t => {
    const desc = (t.descricao || '').toUpperCase();
    const ehIgnorada = DESCRICOES_IGNORAR.some(termo => desc.includes(termo));
    if (ehIgnorada) {
      console.log(`[utils] Transação filtrada pós-IA: "${t.descricao}" R$ ${t.valor} (tipo: ${t.tipo_lancamento})`);
    }
    return !ehIgnorada;
  });
}

/**
 * Corrige tipo_lancamento de transações da IA usando heurísticas.
 *
 * Detecta estornos mal-classificados como "compra" pela IA.
 * Se a divergência total é ~2x o valor de alguma transação,
 * essa transação provavelmente é um estorno mal-classificado.
 */
export function corrigirEstornosIA(transacoes, totalFaturaPDF) {
  if (!totalFaturaPDF) return transacoes;

  const totalCompras = transacoes
    .filter(t => (t.tipo_lancamento || 'compra') === 'compra')
    .reduce((sum, t) => sum + (t.valor || 0), 0);
  const iof = transacoes
    .filter(t => t.tipo_lancamento === 'iof')
    .reduce((sum, t) => sum + (t.valor || 0), 0);
  const tarifaCartao = transacoes
    .filter(t => t.tipo_lancamento === 'tarifa_cartao')
    .reduce((sum, t) => sum + (t.valor || 0), 0);
  const estornos = transacoes
    .filter(t => t.tipo_lancamento === 'estorno')
    .reduce((sum, t) => sum + (t.valor || 0), 0);
  const pagAntecipado = transacoes
    .filter(t => t.tipo_lancamento === 'pagamento_antecipado')
    .reduce((sum, t) => sum + (t.valor || 0), 0);

  const totalCalculado = totalCompras + iof + tarifaCartao - estornos - pagAntecipado;
  const divergencia = totalCalculado - totalFaturaPDF;

  if (Math.abs(divergencia) < 5) return transacoes;

  console.log(`[utils] Correção pós-IA: divergência de R$ ${divergencia.toFixed(2)} detectada`);

  const metadeDivergencia = divergencia / 2;

  const corrigidas = transacoes.map(t => {
    if (t.tipo_lancamento !== 'compra' && t.tipo_lancamento !== 'tarifa_cartao') return t;

    const diff = Math.abs(t.valor - metadeDivergencia);
    if (diff < 0.02) {
      console.log(`[utils] Correção pós-IA: reclassificando "${t.descricao}" R$ ${t.valor} de "${t.tipo_lancamento}" para "estorno"`);
      return { ...t, tipo_lancamento: 'estorno' };
    }
    return t;
  });

  // Verifica se a correção melhorou
  const novoEstornos = corrigidas
    .filter(t => t.tipo_lancamento === 'estorno')
    .reduce((sum, t) => sum + (t.valor || 0), 0);
  const novoCompras = corrigidas
    .filter(t => (t.tipo_lancamento || 'compra') === 'compra')
    .reduce((sum, t) => sum + (t.valor || 0), 0);
  const novaTarifa = corrigidas
    .filter(t => t.tipo_lancamento === 'tarifa_cartao')
    .reduce((sum, t) => sum + (t.valor || 0), 0);
  const novoTotal = novoCompras + iof + novaTarifa - novoEstornos - pagAntecipado;
  const novaDivergencia = novoTotal - totalFaturaPDF;

  if (Math.abs(novaDivergencia) < Math.abs(divergencia)) {
    console.log(`[utils] Correção pós-IA: divergência reduzida de R$ ${divergencia.toFixed(2)} para R$ ${novaDivergencia.toFixed(2)}`);
    return corrigidas;
  }

  console.log(`[utils] Correção pós-IA: nenhuma transação match para metade da divergência`);
  return transacoes;
}
