import { NextResponse } from 'next/server';

// Modelo mais poderoso para melhor extração de dados
const ANTHROPIC_MODEL = 'claude-opus-4-5-20251101';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

export async function POST(request) {
  try {
    const formData = await request.formData();

    const file = formData.get('pdf');
    const banco = formData.get('banco') || '';

    if (!file) {
      return NextResponse.json(
        { error: 'Nenhum arquivo enviado' },
        { status: 400 }
      );
    }

    // Verificar se a API key está configurada
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY não configurada no servidor' },
        { status: 500 }
      );
    }

    // Converter arquivo para base64
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString('base64');

    // Prompt para extração de movimentações de extrato bancário
    const prompt = `Você é um especialista em extrair movimentações de extratos bancários brasileiros.
Analise este PDF de extrato do banco "${banco}" e extraia TODAS as movimentações.

FORMATOS COMUNS DE EXTRATOS BANCÁRIOS:

1. NUBANK:
   - Movimentações aparecem com data, descrição e valor
   - Entradas aparecem com sinal positivo
   - Saídas aparecem com sinal negativo ou em vermelho

2. ITAÚ:
   - Formato tabular: DATA | HISTÓRICO | DOCUMENTO | VALOR | SALDO
   - Créditos (entradas) e débitos (saídas) bem identificados

3. SANTANDER:
   - DATA | DESCRIÇÃO | VALOR
   - Valores negativos indicam saídas

4. OUTROS BANCOS:
   - Bradesco, BB, Inter, Caixa seguem padrões similares

Para cada movimentação, extraia:
1. data: Data da movimentação (SEMPRE no formato DD/MM/YYYY)
2. descricao: Descrição completa da movimentação
3. valor: Valor absoluto em reais (número positivo, sem R$, use ponto como decimal)
4. tipo: "entrada" para créditos/depósitos, "saida" para débitos/pagamentos

REGRAS DE EXTRAÇÃO:
- EXTRAIA todas as movimentações de entrada e saída
- Para valores negativos ou débitos, marque tipo como "saida"
- Para valores positivos ou créditos, marque tipo como "entrada"
- IGNORE linhas de saldo (saldo anterior, saldo atual, saldo disponível)
- IGNORE cabeçalhos e rodapés
- Se a data estiver incompleta, complete com o ano do extrato

Retorne APENAS um JSON válido, SEM markdown ou explicações:
{
  "movimentacoes": [
    {
      "data": "DD/MM/YYYY",
      "descricao": "descrição da movimentação",
      "valor": 123.45,
      "tipo": "entrada" ou "saida"
    }
  ],
  "total_encontrado": numero_de_movimentacoes,
  "total_entradas": soma_das_entradas,
  "total_saidas": soma_das_saidas,
  "banco_detectado": "nome do banco identificado"
}`;

    // Chamar API da Anthropic
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
      // Limpar possíveis marcações de código
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
          details: 'A IA não retornou um JSON válido',
          raw_response: responseText.substring(0, 500)
        },
        { status: 500 }
      );
    }

    // Validar estrutura do resultado
    if (!result.movimentacoes || !Array.isArray(result.movimentacoes)) {
      return NextResponse.json(
        {
          error: 'Estrutura de resposta inválida',
          details: 'O campo movimentacoes não foi encontrado ou não é um array'
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      movimentacoes: result.movimentacoes,
      total_encontrado: result.total_encontrado || result.movimentacoes.length,
      total_entradas: result.total_entradas || result.movimentacoes.filter(m => m.tipo === 'entrada').reduce((s, m) => s + m.valor, 0),
      total_saidas: result.total_saidas || result.movimentacoes.filter(m => m.tipo === 'saida').reduce((s, m) => s + m.valor, 0),
      banco_detectado: result.banco_detectado || banco,
      modelo_usado: ANTHROPIC_MODEL
    });

  } catch (error) {
    console.error('Erro no parse-extrato:', error);

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
