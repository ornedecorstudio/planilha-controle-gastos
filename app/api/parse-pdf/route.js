import { NextResponse } from 'next/server';

// Modelo correto da Anthropic - IMPORTANTE: usar este exatamente
const ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const cartaoNome = formData.get('cartao_nome') || '';
    
    if (!file) {
      return NextResponse.json(
        { error: 'Nenhum arquivo enviado' },
        { status: 400 }
      );
    }

    // Verificar se a API key esta configurada
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY nao configurada no servidor' },
        { status: 500 }
      );
    }

    // Converter arquivo para base64
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString('base64');
    
    // Prompt para extracao de transacoes do PDF
    const prompt = `Voce e um especialista em extrair transacoes de faturas de cartao de credito brasileiras.

Analise este PDF de fatura do cartao "${cartaoNome}" e extraia TODAS as transacoes.

Para cada transacao, identifique:
1. data: Data da transacao (formato DD/MM/YYYY)
2. descricao: Descricao completa da transacao
3. valor: Valor em reais (numero positivo, sem R$)
4. parcela: Se houver parcelamento, extraia (ex: "2/10" significa parcela 2 de 10)

IMPORTANTE:
- Ignore taxas como "Fatura Segura", "ANUIDADE", "AVAL EMERG. CREDITO", "IOF"
- Ignore pagamentos/creditos (valores negativos ou com indicacao de pagamento)
- Extraia apenas compras/despesas reais
- Se a data estiver incompleta, use o mes/ano da fatura

Retorne um JSON valido com a seguinte estrutura:
{
  "transacoes": [
    {
      "data": "DD/MM/YYYY",
      "descricao": "descricao da transacao",
      "valor": 123.45,
      "parcela": "1/3" ou null
    }
  ],
  "total_encontrado": numero_de_transacoes,
  "valor_total": soma_dos_valores
}

Retorne APENAS o JSON, sem explicacoes adicionais ou markdown.`;

    // Chamar API da Anthropic diretamente com fetch
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 8192,
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

    // Verificar se a resposta foi bem sucedida
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Erro da API Anthropic:', response.status, errorData);
      
      return NextResponse.json(
        { 
          error: `API Anthropic retornou ${response.status}`,
          details: errorData,
          modelo_usado: ANTHROPIC_MODEL
        },
        { status: 500 }
      );
    }

    const data = await response.json();
    
    // Extrair texto da resposta
    const responseText = data.content?.[0]?.text || '';
    
    // Tentar fazer parse do JSON
    let result;
    try {
      // Limpar possiveis marcacoes de codigo
      const cleanJson = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      result = JSON.parse(cleanJson);
    } catch (parseError) {
      console.error('Erro ao fazer parse do JSON:', parseError);
      console.error('Resposta da IA:', responseText);
      return NextResponse.json(
        { 
          error: 'Erro ao processar resposta da IA',
          details: 'A IA nao retornou um JSON valido',
          raw_response: responseText.substring(0, 500)
        },
        { status: 500 }
      );
    }

    // Validar estrutura do resultado
    if (!result.transacoes || !Array.isArray(result.transacoes)) {
      return NextResponse.json(
        { 
          error: 'Estrutura de resposta invalida',
          details: 'O campo transacoes nao foi encontrado ou nao e um array'
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      transacoes: result.transacoes,
      total_encontrado: result.total_encontrado || result.transacoes.length,
      valor_total: result.valor_total || result.transacoes.reduce((sum, t) => sum + (t.valor || 0), 0),
      modelo_usado: ANTHROPIC_MODEL
    });

  } catch (error) {
    console.error('Erro no parse-pdf:', error);
    
    return NextResponse.json(
      { 
        error: 'Erro ao processar PDF',
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
