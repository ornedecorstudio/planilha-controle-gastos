import { NextResponse } from 'next/server';

// Importa os parsers determinísticos
import { processarPDFDeterministico, detectarBanco } from '@/lib/pdf-parsers/index.js';

// Modelo para extração de dados via IA - usado apenas como fallback
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Limite mínimo de transações para considerar o parser bem-sucedido
const MIN_TRANSACOES_PARSER = 3;

/**
 * Constrói prompt específico para Itaú quando o parser detecta texto intercalado.
 * Inclui metadados extraídos pelo parser para verificação cruzada.
 */
function construirPromptItau(cartaoNome, tipoCartao, metadados) {
  const totalFatura = metadados?.total_fatura_pdf
    ? `O valor total da fatura é R$ ${metadados.total_fatura_pdf.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`
    : '';

  const subtotaisInfo = metadados?.subtotais?.length > 0
    ? `\nSubtotais encontrados no PDF:\n${metadados.subtotais.map(s => `  - ${s.descricao}: R$ ${s.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`).join('\n')}`
    : '';

  const cartoesInfo = metadados?.cartoes?.length > 0
    ? `\nCartões presentes na fatura: ${metadados.cartoes.map(c => `final ${c}`).join(', ')}.`
    : '';

  return `Você é um especialista em extrair transações de faturas de cartão de crédito Itaú.
Analise este PDF de fatura do cartão "${cartaoNome}"${tipoCartao ? ` (cartão ${tipoCartao})` : ''}.

CONTEXTO IMPORTANTE:
Esta fatura Itaú tem layout de DUAS COLUNAS. ${totalFatura}${subtotaisInfo}${cartoesInfo}

REGRAS DE EXTRAÇÃO — LEIA COM ATENÇÃO:
1. EXTRAIA TODAS as transações de TODOS os cartões presentes no PDF
2. Inclua transações de TODAS as seções: "compras e saques", "transações internacionais", "outros lançamentos"
3. Para transações internacionais, use SEMPRE o valor já convertido em BRL (não o valor em moeda estrangeira)
4. NÃO duplique transações
5. Data deve estar no formato DD/MM/YYYY (adicione o ano baseado no vencimento da fatura)
6. Valor deve ser número positivo (ex: 1234.56)

CLASSIFICAÇÃO tipo_lancamento — cada transação DEVE ter um tipo_lancamento:
- "compra": compras nacionais e internacionais (incluindo parceladas)
- "iof": IOF (Imposto sobre Operações Financeiras)
- "estorno": estornos, créditos na fatura, devoluções, reembolsos, cashback
- "pagamento_antecipado": pagamento antecipado, pagamento parcial
- "tarifa_cartao": anuidade, tarifa do cartão, seguro fatura, avaliação emergencial

IGNORE completamente (não inclua no JSON):
- "Pagamento fatura", "Pagamento recebido", "Pagamento efetuado" (são pagamentos do cliente)
- Linhas de subtotal, total, saldo anterior
- Cabeçalhos de seções

VERIFICAÇÃO: a soma de TODAS as transações tipo "compra" + "iof" + "tarifa_cartao" - "estorno" - "pagamento_antecipado" deve ser próxima de ${metadados?.total_fatura_pdf ? `R$ ${metadados.total_fatura_pdf.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : 'o total da fatura no PDF'}.

Retorne APENAS um JSON válido, SEM markdown:
{
  "transacoes": [
    {
      "data": "DD/MM/YYYY",
      "descricao": "descrição da transação",
      "valor": 123.45,
      "parcela": "1/3" ou null,
      "tipo_lancamento": "compra"
    }
  ],
  "total_encontrado": número,
  "valor_total": soma_apenas_das_compras,
  "banco_detectado": "Itaú"
}`;
}

/**
 * Constrói prompt genérico para outros bancos (com tipo_lancamento).
 */
function construirPromptGenerico(cartaoNome, tipoCartao) {
  return `Você é um especialista em extrair transações de faturas de cartão de crédito brasileiras.
Analise este PDF de fatura do cartão "${cartaoNome}"${tipoCartao ? ` (cartão ${tipoCartao})` : ''} e extraia TODAS as transações.

REGRAS IMPORTANTES:
1. EXTRAIA todas as compras e despesas de TODOS os cartões no PDF
2. Para transações internacionais, use SEMPRE o valor já convertido em BRL
3. NÃO duplique transações
4. Data deve estar no formato DD/MM/YYYY
5. Valor deve ser número positivo (ex: 1234.56)

CLASSIFICAÇÃO tipo_lancamento — cada transação DEVE ter um tipo_lancamento:
- "compra": compras nacionais e internacionais (incluindo parceladas)
- "iof": IOF (Imposto sobre Operações Financeiras)
- "estorno": estornos, créditos na fatura, devoluções, reembolsos, cashback
- "pagamento_antecipado": pagamento antecipado, pagamento parcial
- "tarifa_cartao": anuidade, tarifa do cartão, seguro fatura

IGNORE completamente:
- "Pagamento fatura", "Pagamento recebido" (são pagamentos do cliente)
- Linhas de subtotal, total, saldo anterior

Retorne APENAS um JSON válido, SEM markdown:
{
  "transacoes": [
    {
      "data": "DD/MM/YYYY",
      "descricao": "descrição da transação",
      "valor": 123.45,
      "parcela": "1/3" ou null,
      "tipo_lancamento": "compra"
    }
  ],
  "total_encontrado": número,
  "valor_total": soma_apenas_das_compras,
  "banco_detectado": "nome do banco"
}`;
}

/**
 * Constrói auditoria combinando resultado da IA com metadados do parser.
 */
function construirAuditoriaIA(transacoesIA, metadadosParser) {
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

  // Usa total_fatura_pdf do parser determinístico se disponível
  const totalFaturaPDF = metadadosParser?.total_fatura_pdf || null;

  let reconciliado = null;
  let diferencaCentavos = null;

  if (totalFaturaPDF !== null) {
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
    equacao: `${totalCompras.toFixed(2)} + ${iof.toFixed(2)} + ${tarifaCartao.toFixed(2)} - ${estornos.toFixed(2)} - ${pagamentoAntecipado.toFixed(2)} = ${totalFaturaCalculado.toFixed(2)}`,
    ...(metadadosParser?.subtotais ? { subtotais_pdf: metadadosParser.subtotais } : {})
  };
}

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

    // Converter arquivo para buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // ===== PASSO 1: Tentar extração determinística com pdf-parse =====
    let textoExtraido = '';
    let resultadoDeterministico = null;
    let bancoDetectado = 'desconhecido';
    let forcarIA = false;
    let metadadosParser = null;

    try {
      // Importa pdf-parse dinamicamente (para evitar problemas com SSR)
      const pdfParse = (await import('pdf-parse')).default;

      const pdfData = await pdfParse(buffer);
      textoExtraido = pdfData.text || '';

      bancoDetectado = detectarBanco(textoExtraido + ' ' + cartaoNome);
      console.log(`[parse-pdf] Texto extraído: ${textoExtraido.length} caracteres`);
      console.log(`[parse-pdf] Banco detectado: ${bancoDetectado}`);

      // Tenta parser determinístico
      if (textoExtraido.length > 100) {
        resultadoDeterministico = await processarPDFDeterministico(textoExtraido, cartaoNome);

        // Salvar metadados do parser para uso na IA
        if (resultadoDeterministico?.metadados_verificacao) {
          metadadosParser = resultadoDeterministico.metadados_verificacao;
        } else if (resultadoDeterministico?.resumo_fatura) {
          metadadosParser = {
            total_fatura_pdf: resultadoDeterministico.resumo_fatura.total_fatura_pdf,
            subtotais: resultadoDeterministico.resumo_fatura.subtotais_pdf || [],
          };
        }

        // Verificar se o parser sinalizou confiança baixa
        if (resultadoDeterministico?.confianca_texto === 'baixa') {
          console.log(`[parse-pdf] Parser ${bancoDetectado} sinalizou confiança baixa no texto — forçando IA visual`);
          forcarIA = true;
        }

        // Se confiança alta e transações suficientes, retorna resultado determinístico
        if (!forcarIA &&
            resultadoDeterministico &&
            resultadoDeterministico.transacoes &&
            resultadoDeterministico.transacoes.length >= MIN_TRANSACOES_PARSER) {

          console.log(`[parse-pdf] Parser determinístico bem-sucedido: ${resultadoDeterministico.transacoes.length} transações`);

          return NextResponse.json({
            success: true,
            transacoes: resultadoDeterministico.transacoes,
            total_encontrado: resultadoDeterministico.total_encontrado,
            valor_total: resultadoDeterministico.valor_total,
            banco_detectado: resultadoDeterministico.banco_detectado,
            metodo: 'PARSER_DETERMINISTICO',
            ...(resultadoDeterministico.resumo_fatura ? { auditoria: resultadoDeterministico.resumo_fatura } : {})
          });
        }

        if (!forcarIA) {
          console.log(`[parse-pdf] Parser determinístico retornou poucas transações (${resultadoDeterministico?.transacoes?.length || 0}), usando IA como fallback`);
        }
      }
    } catch (parseError) {
      console.error('[parse-pdf] Erro no pdf-parse:', parseError.message);
      // Continua para tentar com IA
    }

    // ===== PASSO 2: Fallback para IA (ou forçado por confiança baixa) =====
    console.log(`[parse-pdf] Usando IA para extração...${forcarIA ? ' (forçado por confiança baixa)' : ''}`);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Se não tem API key e parser falhou, retorna erro
      if (resultadoDeterministico && resultadoDeterministico.transacoes?.length > 0) {
        // Retorna o que o parser conseguiu, mesmo que seja pouco
        return NextResponse.json({
          success: true,
          transacoes: resultadoDeterministico.transacoes,
          total_encontrado: resultadoDeterministico.total_encontrado,
          valor_total: resultadoDeterministico.valor_total,
          banco_detectado: resultadoDeterministico.banco_detectado || 'desconhecido',
          metodo: 'PARSER_DETERMINISTICO_PARCIAL',
          ...(resultadoDeterministico.resumo_fatura ? { auditoria: resultadoDeterministico.resumo_fatura } : {})
        });
      }

      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY não configurada e parser determinístico falhou' },
        { status: 500 }
      );
    }

    // Converte para base64 para enviar à API
    const base64 = buffer.toString('base64');

    // Escolhe o prompt adequado baseado no banco detectado
    let prompt;
    if (bancoDetectado === 'itau') {
      prompt = construirPromptItau(cartaoNome, tipoCartao, metadadosParser);
      console.log('[parse-pdf] Usando prompt específico Itaú com metadados de verificação');
    } else {
      prompt = construirPromptGenerico(cartaoNome, tipoCartao);
    }

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 16384,
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
      console.error('Erro da API Anthropic:', response.status, errorData);

      // Se IA falhou mas parser teve algum resultado, usa ele
      if (resultadoDeterministico && resultadoDeterministico.transacoes?.length > 0) {
        return NextResponse.json({
          success: true,
          transacoes: resultadoDeterministico.transacoes,
          total_encontrado: resultadoDeterministico.total_encontrado,
          valor_total: resultadoDeterministico.valor_total,
          banco_detectado: resultadoDeterministico.banco_detectado || 'desconhecido',
          metodo: 'PARSER_DETERMINISTICO_FALLBACK',
          aviso: 'IA indisponível, usando parser determinístico',
          ...(resultadoDeterministico.resumo_fatura ? { auditoria: resultadoDeterministico.resumo_fatura } : {})
        });
      }

      let errorMsg = `API Anthropic retornou ${response.status}`;
      if (errorData.error?.message) {
        errorMsg += `: ${errorData.error.message}`;
      }

      return NextResponse.json(
        {
          error: errorMsg,
          details: errorData,
        },
        { status: 500 }
      );
    }

    const data = await response.json();
    const responseText = data.content?.[0]?.text || '';

    // Parse do JSON
    let result;
    try {
      const cleanJson = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      result = JSON.parse(cleanJson);
    } catch (parseError) {
      console.error('Erro ao fazer parse do JSON:', parseError);

      // Se IA retornou JSON inválido mas parser teve resultado, usa ele
      if (resultadoDeterministico && resultadoDeterministico.transacoes?.length > 0) {
        return NextResponse.json({
          success: true,
          transacoes: resultadoDeterministico.transacoes,
          total_encontrado: resultadoDeterministico.total_encontrado,
          valor_total: resultadoDeterministico.valor_total,
          banco_detectado: resultadoDeterministico.banco_detectado || 'desconhecido',
          metodo: 'PARSER_DETERMINISTICO_FALLBACK',
          aviso: 'IA retornou resposta inválida, usando parser determinístico',
          ...(resultadoDeterministico.resumo_fatura ? { auditoria: resultadoDeterministico.resumo_fatura } : {})
        });
      }

      return NextResponse.json(
        {
          error: 'Erro ao processar resposta da IA',
          details: 'A IA não retornou um JSON válido',
        },
        { status: 500 }
      );
    }

    if (!result.transacoes || !Array.isArray(result.transacoes)) {
      return NextResponse.json(
        {
          error: 'Estrutura de resposta inválida',
          details: 'O campo transacoes não foi encontrado ou não é um array'
        },
        { status: 500 }
      );
    }

    // Normalizar transações da IA (garantir tipo_lancamento em todas)
    const transacoesNormalizadas = result.transacoes.map(t => ({
      ...t,
      tipo_lancamento: t.tipo_lancamento || 'compra'
    }));

    // Construir auditoria combinando IA + metadados do parser
    const auditoriaIA = construirAuditoriaIA(transacoesNormalizadas, metadadosParser);

    const metodoIA = forcarIA ? 'IA_PDF_HIBRIDO' : 'IA_PDF';

    console.log(`[parse-pdf] IA retornou ${transacoesNormalizadas.length} transações (método: ${metodoIA})`);
    if (auditoriaIA.reconciliado !== null) {
      console.log(`[parse-pdf] Reconciliação IA: ${auditoriaIA.reconciliado ? 'OK' : 'DIVERGENTE'} (diferença: ${auditoriaIA.diferenca_centavos} centavos)`);
    }

    return NextResponse.json({
      success: true,
      transacoes: transacoesNormalizadas,
      total_encontrado: result.total_encontrado || transacoesNormalizadas.length,
      valor_total: result.valor_total || transacoesNormalizadas
        .filter(t => t.tipo_lancamento === 'compra')
        .reduce((sum, t) => sum + (t.valor || 0), 0),
      banco_detectado: result.banco_detectado || bancoDetectado || 'desconhecido',
      metodo: metodoIA,
      auditoria: auditoriaIA
    });

  } catch (error) {
    console.error('Erro no parse-pdf:', error);

    return NextResponse.json(
      {
        error: 'Erro ao processar PDF',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
