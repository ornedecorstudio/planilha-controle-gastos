/**
 * Rota dedicada para processamento de faturas Mercado Pago em PDF.
 *
 * Estratégia: SEMPRE usa IA visual (texto corrompido pelo pdf-parse).
 * 1. Extrai metadados do texto (total, vencimento, cartões) para verificação
 * 2. Envia PDF completo para IA visual com prompt específico MercadoPago
 * 3. Pós-processamento: filtra, deduplica, reconcilia com "Total a pagar"
 *
 * Estrutura do PDF MercadoPago:
 * - Pág 1: Resumo (Total a pagar, Limite total, Movimentações na fatura)
 * - Pág 2+: Seções "Cartão Visa [****XXXX]" com tabelas de transações
 * - Cada seção tem "Total" ao final (subtotal — ignorar)
 * - Seções podem continuar na próxima página com mesmo header
 */

import { NextResponse } from 'next/server';
import { parseMercadoPago } from '@/lib/pdf-parsers/mercadopago.js';
import {
  chamarAnthropicComPDF,
  parsearRespostaIA,
  filtrarTransacoesIA,
  removerDuplicatasExatas,
  construirAuditoriaIA,
} from '@/lib/pdf-ia-shared.js';

/**
 * Constrói o prompt específico para MercadoPago.
 * Descreve a estrutura exata do PDF para que a IA extraia APENAS transações reais.
 */
function construirPrompt(cartaoNome, tipoCartao, metadados) {
  const totalFaturaPDF = metadados?.total_fatura_pdf
    ? `R$ ${metadados.total_fatura_pdf.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    : null;

  const vencimento = metadados?.vencimento || null;
  const cartoes = metadados?.cartoes || [];
  const numSecoes = metadados?.num_secoes || null;

  let metadadosBloco = '';
  if (totalFaturaPDF || vencimento || cartoes.length > 0 || numSecoes) {
    metadadosBloco = '\nMETADADOS EXTRAÍDOS DO PDF (use para verificação cruzada):';
    if (totalFaturaPDF) metadadosBloco += `\n- Total a pagar no PDF: ${totalFaturaPDF}`;
    if (vencimento) metadadosBloco += `\n- Vencimento: ${vencimento}`;
    if (cartoes.length > 0) metadadosBloco += `\n- Cartões detectados (finais): ${cartoes.join(', ')}`;
    if (numSecoes) metadadosBloco += `\n- Seções de cartão detectadas: ${numSecoes}`;
  }

  return `Você é um especialista em extrair transações de faturas de cartão de crédito Mercado Pago.
Analise VISUALMENTE este PDF de fatura do cartão "${cartaoNome}"${tipoCartao ? ` (cartão ${tipoCartao})` : ''}.

IMPORTANTE: O texto extraído automaticamente deste PDF está CORROMPIDO. Ignore qualquer texto garbled.
Use APENAS a análise visual do documento PDF para extrair as transações.
${metadadosBloco}

═══════════════════════════════════════════
ESTRUTURA EXATA DO PDF MERCADO PAGO
═══════════════════════════════════════════

PRIMEIRA PÁGINA — Resumo da fatura:
┌─────────────────────────────────────────┐
│ Logo Mercado Pago                       │
│ Nome do titular                         │
│ "Total a pagar R$ XX.XXX,XX"  ← CAPTURAR este valor no campo total_a_pagar │
│ Vencimento: DD/MM/YYYY                  │
│ "Limite total R$ XX.XXX,XX"  ← IGNORAR (é limite de crédito)              │
│ "Limite disponível R$ X.XXX,XX" ← IGNORAR                                  │
│                                         │
│ "Movimentações na fatura"               │
│   → Pagamento da fatura de outubro/2025 │
│   → Pagamento recebido...               │
│   → (TUDO AQUI É PAGAMENTO — IGNORAR)  │
└─────────────────────────────────────────┘
⚠️  NÃO EXTRAIA NADA DA PRIMEIRA PÁGINA (exceto o "Total a pagar")
    "Movimentações na fatura" são pagamentos de faturas anteriores, NÃO são compras.

PÁGINAS SEGUINTES — Transações por cartão:
┌─────────────────────────────────────────┐
│ Cartão Visa [************5415]          │
│ Data    │ Movimentações      │ Valor    │
│ 17/12   │ PAYPAL *FACEBOOK   │ 154,17   │
│ 17/12   │ APPLE.COM/BILL     │  39,90   │
│ ...     │ ...                │ ...      │
│ Total                         │ X.XXX,XX │ ← IGNORAR (subtotal)
└─────────────────────────────────────────┘

ATENÇÃO — CONTINUAÇÃO ENTRE PÁGINAS:
Quando uma seção de cartão tem muitas transações, ela CONTINUA na próxima página.
O cabeçalho "Cartão Visa [****XXXX]" é REPETIDO no topo da nova página.
Isso NÃO significa que é uma seção nova — são as MESMAS transações continuando.
→ Cada transação aparece UMA ÚNICA VEZ no PDF inteiro.
→ Se você vir a mesma transação (mesma descrição + mesma data + mesmo valor) em duas seções, INCLUA APENAS UMA VEZ.

═══════════════════════════════════════════
REGRAS DE EXTRAÇÃO
═══════════════════════════════════════════

1. CAPTURAR "Total a pagar R$ XX.XXX,XX" da primeira página → campo total_a_pagar
2. PULAR toda a primeira página (não extrair transações de lá)
3. A partir da SEGUNDA página, extrair transações de TODAS as seções "Cartão Visa"
4. Cada transação real tem: data, descrição, valor, e opcionalmente parcela
5. Se houver "Parcela X de Y", capture como "X/Y"
6. Para datas sem ano (ex: "17/12"), use o ano do vencimento${vencimento ? ` (vencimento: ${vencimento})` : ''}
7. NÃO DUPLIQUE — se a mesma transação aparece em duas seções por causa de quebra de página, inclua UMA vez só

CLASSIFICAÇÃO tipo_lancamento (OBRIGATÓRIO para cada transação):
- "compra": compras nacionais e internacionais (incluindo parceladas)
- "iof": IOF (Imposto sobre Operações Financeiras)
- "estorno": estornos, devoluções, reembolsos, créditos
- "pagamento_antecipado": pagamento antecipado, pagamento parcial
- "tarifa_cartao": "Tarifa de uso do crédito emergencial", anuidade, encargos

NÃO EXTRAIR (IGNORAR completamente):
- TUDO da seção "Movimentações na fatura" (pagamentos anteriores)
- Qualquer "Pagamento da fatura de..." ou "Pagamento recebido"
- Linhas "Total" (são subtotais de seção)
- "Limite total", "Limite disponível" (limites, não transações)
- Cabeçalhos de seção, títulos, parcelamento, juros, CET

═══════════════════════════════════════════
VERIFICAÇÃO FINAL OBRIGATÓRIA
═══════════════════════════════════════════

ANTES de retornar, faça esta verificação:
1. Some: compras + IOF + tarifas - estornos - pagamentos antecipados
2. Compare com o "Total a pagar" da primeira página
3. A diferença deve ser ZERO ou no máximo R$ 0,02 (arredondamento)
4. Se a diferença for > R$ 5,00:
   - Você provavelmente INCLUIU itens da "Movimentações na fatura" (remova-os)
   - Ou DUPLICOU transações entre seções de página (remova duplicatas)
   - Corrija e recalcule antes de retornar

VALORES: números positivos, formato americano (1234.56, NÃO 1.234,56)

Retorne APENAS um JSON válido, SEM markdown, SEM comentários:
{
  "transacoes": [
    {
      "data": "DD/MM/YYYY",
      "descricao": "DESCRICAO",
      "valor": 123.45,
      "parcela": "1/3" ou null,
      "tipo_lancamento": "compra"
    }
  ],
  "total_a_pagar": valor_numerico_do_total_a_pagar,
  "total_encontrado": numero_de_transacoes,
  "valor_total": soma_de_todas_transacoes,
  "banco_detectado": "Mercado Pago"
}`;
}

/**
 * Filtra transações com datas muito anteriores ao ciclo de faturamento.
 * No MercadoPago, a "Movimentações na fatura" (primeira página) lista pagamentos
 * de meses anteriores. A IA às vezes inclui esses itens apesar das instruções.
 *
 * Lógica: se a transação tem data > 60 dias antes do vencimento e NÃO tem parcela,
 * é quase certamente um item de "Movimentações na fatura" e deve ser removida.
 * Transações parceladas com datas antigas são mantidas (parcela da compra original).
 *
 * @param {Array} transacoes
 * @param {string} vencimentoStr - formato "DD/MM/YYYY"
 */
function filtrarPorDataMercadoPago(transacoes, vencimentoStr) {
  // Parse vencimento
  const partes = vencimentoStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!partes) return transacoes;

  const vencimentoDate = new Date(parseInt(partes[3]), parseInt(partes[2]) - 1, parseInt(partes[1]));
  // O ciclo de faturamento vai de ~45 dias antes do vencimento até o vencimento
  // Transações legítimas: de ~60 dias antes do vencimento até o dia do vencimento
  const limiteMinimoMs = 60 * 24 * 60 * 60 * 1000; // 60 dias em ms

  return transacoes.filter(t => {
    if (!t.data || t.parcela) return true; // Sem data ou com parcela → mantém

    // Parse data da transação (DD/MM/YYYY ou YYYY-MM-DD)
    let transDate;
    const matchDMY = t.data.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    const matchYMD = t.data.match(/(\d{4})-(\d{2})-(\d{2})/);

    if (matchDMY) {
      transDate = new Date(parseInt(matchDMY[3]), parseInt(matchDMY[2]) - 1, parseInt(matchDMY[1]));
    } else if (matchYMD) {
      transDate = new Date(parseInt(matchYMD[1]), parseInt(matchYMD[2]) - 1, parseInt(matchYMD[3]));
    } else {
      return true; // Data incompreensível → mantém
    }

    const diffMs = vencimentoDate.getTime() - transDate.getTime();

    // Se transação é mais de 60 dias antes do vencimento → "Movimentações na fatura"
    if (diffMs > limiteMinimoMs) {
      console.log(`[MercadoPago] Removida por data fora do ciclo: "${t.descricao}" ${t.data} R$ ${t.valor} (${Math.round(diffMs / 86400000)} dias antes do vencimento)`);
      return false;
    }

    return true;
  });
}

/**
 * Remove quasi-duplicatas causadas por misread da IA em PDFs multi-seção.
 *
 * Problema: quando um cartão tem seções em múltiplas páginas, a IA às vezes
 * lê a mesma transação duas vezes com valores ligeiramente diferentes
 * (ex: 130,15 vs 150,15 — diferença de exatamente R$ 20).
 *
 * Estratégia: para pares de transações com mesma descrição + mesma data
 * onde os valores diferem por um múltiplo exato de R$ 10 ou R$ 20,
 * mantém apenas a que está mais próxima da média (mais provável ser correta).
 * Somente aplica para transações do mesmo dia com a mesma descrição.
 */
function removerQuasiDuplicatas(transacoes) {
  // Agrupar por (descrição normalizada + data)
  const grupos = {};
  for (let i = 0; i < transacoes.length; i++) {
    const t = transacoes[i];
    const descNorm = (t.descricao || '').trim().toUpperCase();
    const chave = `${descNorm}|${t.data || ''}`;
    if (!grupos[chave]) grupos[chave] = [];
    grupos[chave].push({ ...t, _idx: i });
  }

  const indicesRemover = new Set();

  for (const [chave, grupo] of Object.entries(grupos)) {
    if (grupo.length < 2) continue;

    // Para cada par no grupo, verificar se há quasi-duplicatas
    for (let i = 0; i < grupo.length; i++) {
      if (indicesRemover.has(grupo[i]._idx)) continue;

      for (let j = i + 1; j < grupo.length; j++) {
        if (indicesRemover.has(grupo[j]._idx)) continue;

        const diff = Math.abs(grupo[i].valor - grupo[j].valor);

        // Quasi-duplicata: diferença é múltiplo exato de 10 ou 20 (misread de dígito)
        // e ambos valores estão no mesmo order of magnitude
        const ehMultiplo10 = diff > 0 && diff <= 50 && (Math.abs(diff % 10) < 0.02 || Math.abs(diff % 10 - 10) < 0.02);
        const menorValor = Math.min(grupo[i].valor, grupo[j].valor);
        const maiorValor = Math.max(grupo[i].valor, grupo[j].valor);

        // A diferença deve ser significativa relativa ao valor (>5% sugere dígito diferente)
        // mas não muito grande (max 30% do menor valor)
        const percentDiff = (diff / menorValor) * 100;

        if (ehMultiplo10 && percentDiff >= 5 && percentDiff <= 30) {
          // Remove o de menor valor (mais provável ser o misread — dígito faltando)
          const idxRemover = grupo[i].valor < grupo[j].valor ? grupo[i]._idx : grupo[j]._idx;
          const removida = grupo[i].valor < grupo[j].valor ? grupo[i] : grupo[j];
          const mantida = grupo[i].valor < grupo[j].valor ? grupo[j] : grupo[i];

          indicesRemover.add(idxRemover);
          console.log(`[MercadoPago] Quasi-duplicata removida: "${removida.descricao}" ${removida.data} R$ ${removida.valor} (mantido R$ ${mantida.valor}, diff=${diff.toFixed(2)})`);
        }
      }
    }
  }

  if (indicesRemover.size === 0) return transacoes;

  return transacoes.filter((_, i) => !indicesRemover.has(i));
}

/**
 * Handler POST para processamento de faturas Mercado Pago.
 * Chamado diretamente via /api/parse-pdf/mercadopago
 */
export async function POST(request) {
  try {
    const formData = await request.formData();

    const file = formData.get('pdf');
    const cartaoNome = formData.get('cartao_nome') || '';
    const tipoCartao = formData.get('tipo_cartao') || '';

    if (!file) {
      return NextResponse.json(
        { error: 'Nenhum arquivo enviado' },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    return processarMercadoPago(buffer, cartaoNome, tipoCartao);
  } catch (error) {
    console.error('[MercadoPago] Erro:', error);
    return NextResponse.json(
      { error: `Erro ao processar fatura Mercado Pago: ${error.message}` },
      { status: 500 }
    );
  }
}

/**
 * Função principal exportada para processamento MercadoPago.
 * Pode ser chamada pelo dispatcher principal (parse-pdf/route.js)
 * ou diretamente pelo POST handler acima.
 *
 * @param {Buffer} buffer - conteúdo do PDF
 * @param {string} cartaoNome - nome do cartão selecionado
 * @param {string} tipoCartao - tipo do cartão (credito/debito)
 * @returns {NextResponse}
 */
export async function processarMercadoPago(buffer, cartaoNome, tipoCartao) {
  try {
    let metadadosParser = null;

    try {
      const pdfParse = (await import('pdf-parse')).default;
      const pdfData = await pdfParse(buffer);
      const textoExtraido = pdfData.text || '';

      console.log(`[MercadoPago] Texto extraído: ${textoExtraido.length} caracteres`);

      const resultado = parseMercadoPago(textoExtraido);

      if (resultado?.metadados_verificacao) {
        metadadosParser = resultado.metadados_verificacao;
        console.log(`[MercadoPago] Metadados: total=${metadadosParser.total_fatura_pdf}, vencimento=${metadadosParser.vencimento}, cartões=${metadadosParser.cartoes?.join(',')}`);
      }
    } catch (parseError) {
      console.error('[MercadoPago] Erro no pdf-parse:', parseError.message);
      // Continua sem metadados — a IA visual extrairá tudo
    }

    // ===== PASSO 2: IA Visual =====
    console.log('[MercadoPago] Iniciando análise visual com IA...');

    const prompt = construirPrompt(cartaoNome, tipoCartao, metadadosParser);

    let responseText;
    try {
      responseText = await chamarAnthropicComPDF(buffer, prompt);
    } catch (apiError) {
      return NextResponse.json(
        { error: apiError.message },
        { status: 500 }
      );
    }

    // ===== PASSO 3: Parse do JSON =====
    let result;
    try {
      result = parsearRespostaIA(responseText);
    } catch (parseError) {
      console.error('[MercadoPago] Erro ao parsear JSON da IA:', parseError.message);
      console.error('[MercadoPago] Resposta recebida:', responseText.substring(0, 500));
      return NextResponse.json(
        { error: 'IA retornou resposta inválida (JSON parse error)' },
        { status: 500 }
      );
    }

    if (!result.transacoes || !Array.isArray(result.transacoes)) {
      return NextResponse.json(
        { error: 'IA não retornou array de transações' },
        { status: 500 }
      );
    }

    console.log(`[MercadoPago] IA retornou ${result.transacoes.length} transações`);

    // ===== PASSO 4: Pós-processamento =====

    // 4a. Normalizar tipo_lancamento
    let transacoes = result.transacoes.map(t => ({
      ...t,
      tipo_lancamento: t.tipo_lancamento || 'compra'
    }));

    // 4b. Filtrar transações falsas (subtotais, pagamentos, limites)
    transacoes = filtrarTransacoesIA(transacoes);

    // 4c. Remover duplicatas exatas (cross-page duplication)
    const antesDedup = transacoes.length;
    transacoes = removerDuplicatasExatas(transacoes);
    if (transacoes.length < antesDedup) {
      console.log(`[MercadoPago] Dedup exata removeu ${antesDedup - transacoes.length} duplicata(s): ${antesDedup} → ${transacoes.length}`);
    }

    // 4d. Filtrar transações de "Movimentações na fatura" por data
    // Transações com datas muito anteriores ao ciclo de faturamento e sem parcela
    // são quase certamente itens do resumo de pagamentos (primeira página)
    const vencimento = metadadosParser?.vencimento || null;
    if (vencimento) {
      const antesDataFilter = transacoes.length;
      transacoes = filtrarPorDataMercadoPago(transacoes, vencimento);
      if (transacoes.length < antesDataFilter) {
        console.log(`[MercadoPago] Filtro de data removeu ${antesDataFilter - transacoes.length} transação(ões) fora do ciclo`);
      }
    }

    // 4e. Remover quasi-duplicatas (AI misread cross-page)
    // MercadoPago: a IA às vezes lê o mesmo valor com dígitos trocados
    // (ex: 130,15 e 150,15 para a mesma transação vista em seções diferentes)
    const antesQuasiDedup = transacoes.length;
    transacoes = removerQuasiDuplicatas(transacoes);
    if (transacoes.length < antesQuasiDedup) {
      console.log(`[MercadoPago] Quasi-dedup removeu ${antesQuasiDedup - transacoes.length} provável(is) misread(s)`);
    }

    // 4f. Capturar total_a_pagar da IA
    const totalAPagarIA = result.total_a_pagar ? parseFloat(result.total_a_pagar) : null;
    if (totalAPagarIA) {
      console.log(`[MercadoPago] IA retornou total_a_pagar: R$ ${totalAPagarIA.toFixed(2)}`);
    }

    // ===== PASSO 5: Auditoria =====
    const auditoria = construirAuditoriaIA(transacoes, metadadosParser, totalAPagarIA);

    console.log(`[MercadoPago] Final: ${transacoes.length} transações, calculado: R$ ${auditoria.total_fatura_calculado}, PDF: R$ ${auditoria.total_fatura_pdf}`);
    if (auditoria.reconciliado !== null) {
      console.log(`[MercadoPago] Reconciliação: ${auditoria.reconciliado ? 'OK ✓' : `DIVERGENTE (${auditoria.diferenca_centavos} centavos)`}`);
    }

    return NextResponse.json({
      success: true,
      transacoes,
      total_encontrado: transacoes.length,
      valor_total: result.valor_total || transacoes
        .filter(t => t.tipo_lancamento === 'compra')
        .reduce((sum, t) => sum + (t.valor || 0), 0),
      banco_detectado: 'Mercado Pago',
      metodo: 'IA_PDF_HIBRIDO',
      auditoria,
    });

  } catch (error) {
    console.error('[MercadoPago] Erro:', error);
    return NextResponse.json(
      { error: `Erro ao processar fatura Mercado Pago: ${error.message}` },
      { status: 500 }
    );
  }
}
