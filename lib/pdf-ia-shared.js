/**
 * Módulo compartilhado para processamento de PDF com IA.
 * Funções utilitárias usadas por todas as rotas bank-specific.
 */

// Modelo para extração de dados via IA
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Chama a API Anthropic com um PDF (base64) e um prompt.
 * Retorna o texto da resposta ou lança erro.
 */
export async function chamarAnthropicComPDF(buffer, prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY não configurada');
  }

  const base64 = buffer.toString('base64');

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 32768,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    let errorMsg = `API Anthropic retornou ${response.status}`;
    if (errorData.error?.message) {
      errorMsg += `: ${errorData.error.message}`;
    }
    throw new Error(errorMsg);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '';
}

/**
 * Faz parse do JSON retornado pela IA.
 * Remove markdown wrappers e tenta parsear.
 */
export function parsearRespostaIA(responseText) {
  const cleanJson = responseText
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  return JSON.parse(cleanJson);
}

/**
 * Filtra transações da IA removendo entradas que não são transações reais.
 * Defesa contra erros da IA que incluem subtotais, pagamentos ou limites.
 */
export function filtrarTransacoesIA(transacoes) {
  const DESCRICOES_IGNORAR = [
    'SUBTOTAL', 'SUB TOTAL', 'SUB-TOTAL',
    'TOTAL GERAL', 'TOTAL DOS LANCAMENTOS', 'TOTAL DOS LANÇAMENTOS',
    'VALOR TOTAL', 'TOTAL DESPESAS', 'TOTAL A PAGAR',
    'TOTAL DE PAGAMENTOS', 'TOTAL DE CREDITOS', 'TOTAL DE CRÉDITOS',
    'SALDO ANTERIOR', 'SALDO DESTA FATURA',
    'PAGAMENTO DE FATURA', 'PAGAMENTO RECEBIDO',
    'PAGAMENTO EFETUADO', 'PAGAMENTO FATURA',
    'PAGAMENTO DA FATURA',
    'MOVIMENTAÇÕES NA FATURA', 'MOVIMENTACOES NA FATURA',
    'SEU LIMITE', 'LIMITE DISPONIVEL', 'LIMITE DISPONÍVEL',
    'LIMITE TOTAL', 'LIMITE DE SAQUE',
    'PAGAMENTO TOTAL', 'PAGAMENTO MINIMO', 'PAGAMENTO MÍNIMO',
  ];

  return transacoes.filter(t => {
    const desc = (t.descricao || '').toUpperCase();
    const ehIgnorada = DESCRICOES_IGNORAR.some(termo => desc.includes(termo));
    if (ehIgnorada) {
      console.log(`[filtro-IA] Removido: "${t.descricao}" R$ ${t.valor} (tipo: ${t.tipo_lancamento})`);
    }
    return !ehIgnorada;
  });
}

/**
 * Remove transações exatamente duplicadas (mesma descrição + data + valor).
 * Proteção contra cross-page duplication em PDFs multi-seção.
 */
export function removerDuplicatasExatas(transacoes) {
  const vistos = new Set();
  const unicas = [];
  const removidas = [];

  for (const t of transacoes) {
    // Chave: descrição normalizada + data + valor com 2 casas decimais
    const descNorm = (t.descricao || '').trim().toUpperCase();
    const valorNorm = parseFloat(t.valor || 0).toFixed(2);
    const chave = `${descNorm}|${t.data || ''}|${valorNorm}`;

    if (vistos.has(chave)) {
      removidas.push(t);
      console.log(`[dedup] Duplicata removida: "${t.descricao}" ${t.data} R$ ${t.valor}`);
    } else {
      vistos.add(chave);
      unicas.push(t);
    }
  }

  if (removidas.length > 0) {
    console.log(`[dedup] ${removidas.length} duplicata(s) removida(s) de ${transacoes.length} transações`);
  }

  return unicas;
}

/**
 * Constrói auditoria combinando resultado da IA com metadados do parser.
 * @param {Array} transacoesIA - transações extraídas pela IA
 * @param {Object} metadadosParser - metadados do parser determinístico
 * @param {number|null} totalAPagarIA - "Total a pagar" extraído pela IA visual
 */
export function construirAuditoriaIA(transacoesIA, metadadosParser, totalAPagarIA = null) {
  const totalCompras = transacoesIA
    .filter(t => (t.tipo_lancamento || 'compra') === 'compra')
    .reduce((sum, t) => sum + (t.valor || 0), 0);

  const iof = transacoesIA
    .filter(t => t.tipo_lancamento === 'iof')
    .reduce((sum, t) => sum + (t.valor || 0), 0);

  const estornos = transacoesIA
    .filter(t => t.tipo_lancamento === 'estorno')
    .reduce((sum, t) => sum + (t.valor || 0), 0);

  const pagamentoAntecipado = transacoesIA
    .filter(t => t.tipo_lancamento === 'pagamento_antecipado')
    .reduce((sum, t) => sum + (t.valor || 0), 0);

  const tarifaCartao = transacoesIA
    .filter(t => t.tipo_lancamento === 'tarifa_cartao')
    .reduce((sum, t) => sum + (t.valor || 0), 0);

  const totalFaturaCalculado = parseFloat(
    (totalCompras + iof + tarifaCartao - estornos - pagamentoAntecipado).toFixed(2)
  );

  // Prioridade: total_a_pagar da IA visual > total_fatura_pdf do parser
  const totalFaturaPDFParser = metadadosParser?.total_fatura_pdf || null;
  const totalFaturaPDF = (totalAPagarIA && totalAPagarIA > 0) ? totalAPagarIA : totalFaturaPDFParser;

  let reconciliado = null;
  let diferencaCentavos = null;

  if (totalFaturaPDF !== null) {
    diferencaCentavos = Math.round((totalFaturaPDF - totalFaturaCalculado) * 100);
    reconciliado = Math.abs(diferencaCentavos) <= 2;
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
    equacao: `${totalCompras.toFixed(2)} + ${iof.toFixed(2)} + ${tarifaCartao.toFixed(2)} - ${estornos.toFixed(2)} - ${pagamentoAntecipado.toFixed(2)} = ${totalFaturaCalculado.toFixed(2)}`,
    ...(totalAPagarIA ? { fonte_total: 'IA visual (Total a pagar)' } : totalFaturaPDFParser ? { fonte_total: 'Parser determinístico' } : {})
  };
}
