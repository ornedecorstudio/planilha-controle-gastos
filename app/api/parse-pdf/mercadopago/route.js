/**
 * Rota dedicada para processamento de faturas Mercado Pago em PDF.
 *
 * Estratégia robusta com auto-verificação em 2 passagens:
 * 1. Extrai metadados do texto (total, vencimento, cartões) via parser determinístico
 * 2. Envia PDF completo para IA visual com prompt específico MercadoPago
 * 3. Pós-processamento: filtra, deduplica, reconcilia com "Total a pagar"
 * 4. Se reconciliação falhar (divergência > R$ 5): segunda chamada à IA com
 *    lista das transações extraídas + divergência, pedindo correção
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
 * Constrói o prompt de extração (primeira passagem).
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
│ "Total a pagar R$ XX.XXX,XX"  ← CAPTURAR no campo total_a_pagar │
│ Vencimento: DD/MM/YYYY        ← CAPTURAR no campo vencimento    │
│ "Limite total R$ XX.XXX,XX"  ← IGNORAR (é limite de crédito)    │
│ "Limite disponível R$ X.XXX,XX" ← IGNORAR                       │
│                                         │
│ ┌─ "Movimentações na fatura" ─────────┐ │
│ │  Pagamento da fatura de out/2025    │ │
│ │  Pagamento recebido em 20/03/2025   │ │
│ │  Compra antiga de 16/05/2025        │ │
│ │  (TUDO AQUI = PAGAMENTO ANTERIOR)   │ │
│ └─────────────────────────────────────┘ │
│ ⚠️  IGNORAR TUDO DESTA SEÇÃO            │
└─────────────────────────────────────────┘

🚫 NÃO EXTRAIA NENHUMA TRANSAÇÃO DA PRIMEIRA PÁGINA.
   A seção "Movimentações na fatura" lista pagamentos de faturas ANTERIORES.
   Esses itens têm datas de MESES PASSADOS (março, maio, novembro...).
   Eles NÃO são compras do ciclo atual — são o histórico de pagamentos.

PÁGINAS SEGUINTES (2, 3, 4...) — Transações por cartão:
┌─────────────────────────────────────────┐
│ Cartão Visa [************5415]          │
│ Data    │ Movimentações      │ Valor    │
│ 17/12   │ PAYPAL *FACEBOOK   │ 154,17   │
│ 17/12   │ APPLE.COM/BILL     │  39,90   │
│ ...     │ ...                │ ...      │
│ Total                         │ X.XXX,XX │ ← IGNORAR (subtotal da seção)
└─────────────────────────────────────────┘
→ EXTRAIA APENAS transações destas tabelas (páginas 2+)

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
2. CAPTURAR "Vencimento: DD/MM/YYYY" da primeira página → campo vencimento
3. PULAR toda a primeira página (não extrair transações de lá)
4. A partir da SEGUNDA página, extrair transações de TODAS as seções "Cartão Visa"
5. Cada transação real tem: data, descrição, valor, e opcionalmente parcela
6. Se houver "Parcela X de Y", capture como "X/Y"
7. Para datas sem ano (ex: "17/12"), use o ano do vencimento${vencimento ? ` (vencimento: ${vencimento})` : ''}
8. NÃO DUPLIQUE — se a mesma transação aparece em duas seções por causa de quebra de página, inclua UMA vez só

CLASSIFICAÇÃO tipo_lancamento (OBRIGATÓRIO para cada transação):
- "compra": compras nacionais e internacionais (incluindo parceladas)
- "iof": IOF (Imposto sobre Operações Financeiras)
- "estorno": estornos, devoluções, reembolsos, créditos
- "pagamento_antecipado": pagamento antecipado, pagamento parcial
- "tarifa_cartao": "Tarifa de uso do crédito emergencial", anuidade, encargos

NÃO EXTRAIR (IGNORAR completamente):
- TUDO da seção "Movimentações na fatura" (pagamentos de faturas anteriores)
- Qualquer "Pagamento da fatura de..." ou "Pagamento recebido"
- Itens com datas muito antigas (meses antes do ciclo de faturamento)
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
  "total_a_pagar": valor_numerico,
  "vencimento": "DD/MM/YYYY",
  "total_encontrado": numero_de_transacoes,
  "valor_total": soma_de_todas_transacoes,
  "banco_detectado": "Mercado Pago"
}`;
}

/**
 * Constrói o prompt de correção (segunda passagem).
 * Enviado quando a reconciliação da primeira passagem falha.
 * Inclui a lista de transações extraídas e a divergência para que a IA
 * possa identificar e remover falsos positivos.
 */
function construirPromptCorrecao(transacoesExtraidas, totalCalculado, totalAPagar, vencimento) {
  const listaTransacoes = transacoesExtraidas
    .map((t, i) => `  ${i + 1}. ${t.data} | ${t.descricao} | R$ ${t.valor.toFixed(2)} | ${t.tipo_lancamento}${t.parcela ? ` | parcela ${t.parcela}` : ''}`)
    .join('\n');

  const divergencia = (totalCalculado - totalAPagar).toFixed(2);

  return `CORREÇÃO NECESSÁRIA — A extração anterior desta fatura Mercado Pago teve ERRO.

O "Total a pagar" no PDF é R$ ${totalAPagar.toFixed(2)}.
A soma das ${transacoesExtraidas.length} transações extraídas é R$ ${totalCalculado.toFixed(2)}.
Há R$ ${divergencia} A MAIS do que deveria.
${vencimento ? `Vencimento da fatura: ${vencimento}` : ''}

Transações extraídas na primeira tentativa:
${listaTransacoes}

═══════════════════════════════════════════
ERROS COMUNS QUE CAUSAM ESSA DIVERGÊNCIA
═══════════════════════════════════════════

1. ITENS DA "MOVIMENTAÇÕES NA FATURA" (primeira página) incluídos por engano:
   → Esses itens têm datas de MESES ANTERIORES ao ciclo da fatura
   → São pagamentos/créditos de faturas passadas, NÃO compras
   → Aparecem na primeira página, ANTES das seções "Cartão Visa"
   → REMOVA todos eles

2. TRANSAÇÕES DUPLICADAS entre seções (quebra de página):
   → Mesmo item aparece 2x porque a seção continua na próxima página
   → REMOVA a duplicata

3. VALORES LIDOS INCORRETAMENTE:
   → Confusão entre dígitos similares no PDF
   → CORRIJA o valor

═══════════════════════════════════════════
TAREFA
═══════════════════════════════════════════

Analise o PDF novamente VISUALMENTE e retorne a lista CORRETA de transações.
- Compare CADA transação da lista acima com o que aparece nas seções "Cartão Visa" (páginas 2+)
- REMOVA qualquer item que NÃO esteja nas tabelas de transações das páginas 2+
- CORRIJA valores que foram lidos incorretamente
- A soma final DEVE ser igual ou muito próxima de R$ ${totalAPagar.toFixed(2)}

Retorne APENAS um JSON válido, SEM markdown:
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
  "total_a_pagar": ${totalAPagar.toFixed(2)},
  "vencimento": "${vencimento || 'DD/MM/YYYY'}",
  "total_encontrado": numero_de_transacoes,
  "valor_total": soma_de_todas_transacoes,
  "banco_detectado": "Mercado Pago",
  "correcoes_aplicadas": "descrição breve das correções feitas"
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
  const partes = vencimentoStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!partes) return transacoes;

  const vencimentoDate = new Date(parseInt(partes[3]), parseInt(partes[2]) - 1, parseInt(partes[1]));
  const limiteMinimoMs = 60 * 24 * 60 * 60 * 1000; // 60 dias em ms

  return transacoes.filter(t => {
    if (!t.data || t.parcela) return true; // Sem data ou com parcela -> mantém

    let transDate;
    const matchDMY = t.data.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    const matchYMD = t.data.match(/(\d{4})-(\d{2})-(\d{2})/);

    if (matchDMY) {
      transDate = new Date(parseInt(matchDMY[3]), parseInt(matchDMY[2]) - 1, parseInt(matchDMY[1]));
    } else if (matchYMD) {
      transDate = new Date(parseInt(matchYMD[1]), parseInt(matchYMD[2]) - 1, parseInt(matchYMD[3]));
    } else {
      return true;
    }

    const diffMs = vencimentoDate.getTime() - transDate.getTime();

    if (diffMs > limiteMinimoMs) {
      console.log(`[MercadoPago] Removida por data fora do ciclo: "${t.descricao}" ${t.data} R$ ${t.valor} (${Math.round(diffMs / 86400000)} dias antes do vencimento)`);
      return false;
    }

    return true;
  });
}

/**
 * Pós-processamento padrão: normaliza, filtra, deduplica, filtra por data.
 * Usado tanto na primeira quanto na segunda passagem.
 *
 * @param {Array} transacoesRaw - transações brutas da IA
 * @param {string|null} vencimento - formato "DD/MM/YYYY" (da IA ou parser)
 * @returns {Array} transações limpas
 */
function posProcessar(transacoesRaw, vencimento) {
  // 1. Normalizar tipo_lancamento
  let transacoes = transacoesRaw.map(t => ({
    ...t,
    tipo_lancamento: t.tipo_lancamento || 'compra'
  }));
  console.log(`[MercadoPago] Pós-proc: ${transacoes.length} transações iniciais`);

  // 2. Filtrar falsos positivos (subtotais, pagamentos, limites)
  const antesFilter = transacoes.length;
  transacoes = filtrarTransacoesIA(transacoes);
  if (transacoes.length < antesFilter) {
    console.log(`[MercadoPago] Pós-proc: filtro IA removeu ${antesFilter - transacoes.length}`);
  }

  // 3. Remover duplicatas exatas (cross-page duplication)
  const antesDedup = transacoes.length;
  transacoes = removerDuplicatasExatas(transacoes);
  if (transacoes.length < antesDedup) {
    console.log(`[MercadoPago] Pós-proc: dedup exata removeu ${antesDedup - transacoes.length}`);
  }

  // 4. Filtrar por data do ciclo de faturamento
  if (vencimento) {
    const antesData = transacoes.length;
    transacoes = filtrarPorDataMercadoPago(transacoes, vencimento);
    if (transacoes.length < antesData) {
      console.log(`[MercadoPago] Pós-proc: filtro data removeu ${antesData - transacoes.length}`);
    }
  } else {
    console.log('[MercadoPago] Pós-proc: vencimento indisponível — filtro de data ignorado');
  }

  console.log(`[MercadoPago] Pós-proc: ${transacoes.length} transações finais`);
  return transacoes;
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
 * Fluxo:
 *   Passagem 1 → Pós-processamento → Reconciliação
 *   Se divergente (>R$ 5): Passagem 2 (correção) → Pós-processamento → Reconciliação
 *   Retorna o melhor resultado
 *
 * @param {Buffer} buffer - conteúdo do PDF
 * @param {string} cartaoNome - nome do cartão selecionado
 * @param {string} tipoCartao - tipo do cartão (credito/debito)
 * @returns {NextResponse}
 */
export async function processarMercadoPago(buffer, cartaoNome, tipoCartao) {
  try {
    // ===== PASSO 1: Metadados via parser determinístico =====
    let metadadosParser = null;

    try {
      const pdfParse = (await import('pdf-parse')).default;
      const pdfData = await pdfParse(buffer);
      const textoExtraido = pdfData.text || '';

      console.log(`[MercadoPago] Texto extraído: ${textoExtraido.length} caracteres`);

      const resultado = parseMercadoPago(textoExtraido);

      if (resultado?.metadados_verificacao) {
        metadadosParser = resultado.metadados_verificacao;
        console.log(`[MercadoPago] Metadados parser: total=${metadadosParser.total_fatura_pdf}, vencimento=${metadadosParser.vencimento}, cartões=${metadadosParser.cartoes?.join(',')}`);
      }
    } catch (parseError) {
      console.error('[MercadoPago] Erro no pdf-parse:', parseError.message);
    }

    // ===== PASSO 2: Primeira passagem — IA Visual =====
    console.log('[MercadoPago] === PASSAGEM 1: Extração inicial ===');

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
      console.error('[MercadoPago] Resposta:', responseText.substring(0, 500));
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

    console.log(`[MercadoPago] PASS 1: IA retornou ${result.transacoes.length} transações`);

    // Vencimento: prioridade IA > parser
    const vencimento = result.vencimento || metadadosParser?.vencimento || null;
    console.log(`[MercadoPago] Vencimento: ${vencimento} (fonte: ${result.vencimento ? 'IA' : metadadosParser?.vencimento ? 'parser' : 'indisponível'})`);

    // Total a pagar: prioridade IA > parser
    const totalAPagarIA = result.total_a_pagar ? parseFloat(result.total_a_pagar) : null;
    const totalFaturaPDFParser = metadadosParser?.total_fatura_pdf || null;
    const totalAPagar = (totalAPagarIA && totalAPagarIA > 0) ? totalAPagarIA : totalFaturaPDFParser;

    if (totalAPagar) {
      console.log(`[MercadoPago] Total a pagar: R$ ${totalAPagar.toFixed(2)} (fonte: ${totalAPagarIA ? 'IA' : 'parser'})`);
    }

    // ===== PASSO 4: Pós-processamento =====
    let transacoes = posProcessar(result.transacoes, vencimento);

    // ===== PASSO 5: Auditoria e reconciliação =====
    let auditoria = construirAuditoriaIA(transacoes, metadadosParser, totalAPagarIA);

    console.log(`[MercadoPago] PASS 1 resultado: ${transacoes.length} transações, calculado=R$ ${auditoria.total_fatura_calculado}, PDF=R$ ${auditoria.total_fatura_pdf}`);
    if (auditoria.reconciliado !== null) {
      console.log(`[MercadoPago] PASS 1 reconciliação: ${auditoria.reconciliado ? 'OK' : `DIVERGENTE (${auditoria.diferenca_centavos} centavos)`}`);
    }

    // ===== PASSO 6: Segunda passagem (se necessário) =====
    // Só executa se: há total de referência, reconciliação falhou, divergência > R$ 5
    const LIMIAR_DIVERGENCIA_CENTAVOS = 500;
    const precisaCorrecao = totalAPagar &&
      auditoria.reconciliado === false &&
      Math.abs(auditoria.diferenca_centavos) > LIMIAR_DIVERGENCIA_CENTAVOS;

    if (precisaCorrecao) {
      console.log(`[MercadoPago] === PASSAGEM 2: Correção (divergência ${auditoria.diferenca_centavos} centavos) ===`);

      const promptCorrecao = construirPromptCorrecao(
        transacoes,
        auditoria.total_fatura_calculado,
        totalAPagar,
        vencimento
      );

      try {
        const responseCorrecao = await chamarAnthropicComPDF(buffer, promptCorrecao);
        const resultCorrecao = parsearRespostaIA(responseCorrecao);

        if (resultCorrecao.transacoes && Array.isArray(resultCorrecao.transacoes) && resultCorrecao.transacoes.length > 0) {
          console.log(`[MercadoPago] PASS 2: IA retornou ${resultCorrecao.transacoes.length} transações`);

          // Vencimento da correção (pode vir atualizado)
          const vencCorrecao = resultCorrecao.vencimento || vencimento;

          // Pós-processar resultado da correção
          const transacoesCorrigidas = posProcessar(resultCorrecao.transacoes, vencCorrecao);

          // Total a pagar da correção
          const totalAPagarCorrecao = resultCorrecao.total_a_pagar ? parseFloat(resultCorrecao.total_a_pagar) : totalAPagarIA;

          // Auditoria da correção
          const auditoriaCorrigida = construirAuditoriaIA(transacoesCorrigidas, metadadosParser, totalAPagarCorrecao);

          console.log(`[MercadoPago] PASS 2 resultado: ${transacoesCorrigidas.length} transações, calculado=R$ ${auditoriaCorrigida.total_fatura_calculado}, PDF=R$ ${auditoriaCorrigida.total_fatura_pdf}`);
          if (auditoriaCorrigida.reconciliado !== null) {
            console.log(`[MercadoPago] PASS 2 reconciliação: ${auditoriaCorrigida.reconciliado ? 'OK' : `DIVERGENTE (${auditoriaCorrigida.diferenca_centavos} centavos)`}`);
          }

          // Usar correção se é melhor que a primeira passagem
          const divPass1 = Math.abs(auditoria.diferenca_centavos || Infinity);
          const divPass2 = Math.abs(auditoriaCorrigida.diferenca_centavos || Infinity);

          if (auditoriaCorrigida.reconciliado === true || divPass2 < divPass1) {
            console.log(`[MercadoPago] PASS 2 ACEITA: divergência ${divPass1} → ${divPass2} centavos`);
            transacoes = transacoesCorrigidas;
            auditoria = {
              ...auditoriaCorrigida,
              segunda_passagem: true,
              correcoes: resultCorrecao.correcoes_aplicadas || null,
            };
          } else {
            console.log(`[MercadoPago] PASS 2 REJEITADA (não melhorou). Usando PASS 1.`);
          }
        } else {
          console.log('[MercadoPago] PASS 2: resposta inválida. Usando PASS 1.');
        }
      } catch (correcaoError) {
        console.error(`[MercadoPago] PASS 2 falhou: ${correcaoError.message}. Usando PASS 1.`);
      }
    }

    // ===== PASSO 7: Resultado final =====
    const metodo = auditoria.segunda_passagem ? 'IA_PDF_HIBRIDO_V2' : 'IA_PDF_HIBRIDO';

    console.log(`[MercadoPago] FINAL: ${transacoes.length} transações via ${metodo}, reconciliado=${auditoria.reconciliado}`);

    return NextResponse.json({
      success: true,
      transacoes,
      total_encontrado: transacoes.length,
      valor_total: transacoes
        .filter(t => (t.tipo_lancamento || 'compra') === 'compra')
        .reduce((sum, t) => sum + (t.valor || 0), 0),
      banco_detectado: 'Mercado Pago',
      metodo,
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
