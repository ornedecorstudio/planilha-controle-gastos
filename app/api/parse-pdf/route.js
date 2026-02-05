import { NextResponse } from 'next/server';

// Importa os parsers determinísticos
import { processarPDFDeterministico, detectarBanco } from '@/lib/pdf-parsers/index.js';

// Modelo para extração de dados via IA - usado apenas como fallback
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Limite mínimo de transações para considerar o parser bem-sucedido
const MIN_TRANSACOES_PARSER = 3;

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

    try {
      // Importa pdf-parse dinamicamente (para evitar problemas com SSR)
      const pdfParse = (await import('pdf-parse')).default;
      
      const pdfData = await pdfParse(buffer);
      textoExtraido = pdfData.text || '';
      
      console.log(`[parse-pdf] Texto extraído: ${textoExtraido.length} caracteres`);
      console.log(`[parse-pdf] Banco detectado: ${detectarBanco(textoExtraido + ' ' + cartaoNome)}`);
      
      // Tenta parser determinístico
      if (textoExtraido.length > 100) {
        resultadoDeterministico = await processarPDFDeterministico(textoExtraido, cartaoNome);
        
        if (resultadoDeterministico && 
            resultadoDeterministico.transacoes && 
            resultadoDeterministico.transacoes.length >= MIN_TRANSACOES_PARSER) {
          
          console.log(`[parse-pdf] Parser determinístico bem-sucedido: ${resultadoDeterministico.transacoes.length} transações`);
          
          return NextResponse.json({
            success: true,
            transacoes: resultadoDeterministico.transacoes,
            total_encontrado: resultadoDeterministico.total_encontrado,
            valor_total: resultadoDeterministico.valor_total,
            banco_detectado: resultadoDeterministico.banco_detectado,
            metodo: 'PARSER_DETERMINISTICO'
          });
        }
        
        console.log(`[parse-pdf] Parser determinístico retornou poucas transações (${resultadoDeterministico?.transacoes?.length || 0}), usando IA como fallback`);
      }
    } catch (parseError) {
      console.error('[parse-pdf] Erro no pdf-parse:', parseError.message);
      // Continua para tentar com IA
    }

    // ===== PASSO 2: Fallback para IA =====
    console.log('[parse-pdf] Usando IA para extração...');

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
          metodo: 'PARSER_DETERMINISTICO_PARCIAL'
        });
      }
      
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY não configurada e parser determinístico falhou' },
        { status: 500 }
      );
    }

    // Converte para base64 para enviar à API
    const base64 = buffer.toString('base64');

    // Prompt otimizado para extração
    const prompt = `Você é um especialista em extrair transações de faturas de cartão de crédito brasileiras.
Analise este PDF de fatura do cartão "${cartaoNome}"${tipoCartao ? ` (cartão ${tipoCartao})` : ''} e extraia TODAS as transações.

REGRAS IMPORTANTES:
1. EXTRAIA todas as compras e despesas de TODOS os cartões no PDF
2. IGNORE: pagamentos recebidos, créditos, estornos, IOF, anuidades, taxas, "Fatura Segura"
3. Para transações internacionais, use SEMPRE o valor já convertido em BRL
4. NÃO duplique transações
5. Data deve estar no formato DD/MM/YYYY
6. Valor deve ser número positivo (ex: 1234.56)

Retorne APENAS um JSON válido, SEM markdown:
{
  "transacoes": [
    {
      "data": "DD/MM/YYYY",
      "descricao": "descrição da transação",
      "valor": 123.45,
      "parcela": "1/3" ou null
    }
  ],
  "total_encontrado": número,
  "valor_total": soma_dos_valores,
  "banco_detectado": "nome do banco"
}`;

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
          aviso: 'IA indisponível, usando parser determinístico'
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
          aviso: 'IA retornou resposta inválida, usando parser determinístico'
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

    return NextResponse.json({
      success: true,
      transacoes: result.transacoes,
      total_encontrado: result.total_encontrado || result.transacoes.length,
      valor_total: result.valor_total || result.transacoes.reduce((sum, t) => sum + (t.valor || 0), 0),
      banco_detectado: result.banco_detectado || 'desconhecido',
      metodo: 'IA_PDF'
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
