import { NextResponse } from 'next/server';

// Modelo para extracao de dados - Opus 4.5 para melhor precisao
const ANTHROPIC_MODEL = 'claude-opus-4-20250514';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

export async function POST(request) {
  try {
    const formData = await request.formData();

    // CORRECAO: Buscar campo 'pdf' que e o nome enviado pelo frontend
    const file = formData.get('pdf');
    const cartaoNome = formData.get('cartao_nome') || '';
    const tipoCartao = formData.get('tipo_cartao') || '';

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

    // Prompt robusto para extracao de transacoes - suporta todos os bancos brasileiros
    const prompt = `Voce e um especialista em extrair transacoes de faturas de cartao de credito brasileiras.
Analise este PDF de fatura do cartao "${cartaoNome}"${tipoCartao ? ` (cartao ${tipoCartao})` : ''} e extraia TODAS as transacoes.

BANCOS SUPORTADOS E SEUS FORMATOS:

1. NUBANK:
   - Transacoes aparecem com data no formato "DD MMM" (ex: "15 DEZ")
   - Descricao vem em uma linha
   - Valor vem separado, formato "R$ 1.234,56" ou apenas "1.234,56"
   - Parcelamentos aparecem como "PARCELA 2/10" ou similar

2. ITAU:
   - Transacoes no formato tabular: DATA | DESCRICAO | VALOR
   - Data pode ser "DD/MM" ou "DD/MM/AA"
   - Valores negativos indicam estornos/pagamentos
   - Parcelamentos: "PARC 02/10" ou "2/10"
   - Pode ter secoes separadas: "COMPRAS PARCELADAS" e "COMPRAS A VISTA"

3. SANTANDER:
   - Formato similar ao Itau
   - Data: "DD/MM/AAAA" ou "DD/MM"
   - Valores com "R$" ou sem
   - Parcelamentos no final da descricao: "(02/10)" ou "PARC. 02/10"

4. C6 BANK:
   - IMPORTANTE: Pode ter MULTIPLOS cartoes (virtual, fisico, adicionais)
   - Cada cartao tem sua propria secao de transacoes
   - EXTRAIA transacoes de TODOS os cartoes listados no PDF
   - Transacoes internacionais mostram valor em USD + valor convertido em BRL + IOF separado
   - Use SEMPRE o valor em BRL (convertido), IGNORE o valor em USD
   - Formato: lista com data, descricao e valor
   - Parcelamentos aparecem como "Parcela X/Y"

5. MERCADO PAGO:
   - Layout mobile/minimalista com poucos elementos
   - Data, descricao e valor podem estar em linhas separadas
   - Parcelamentos aparecem como "Parcela X de Y"
   - Visa Card

6. PICPAY:
   - IMPORTANTE: Pode ter ate 5 cartoes separados (diferentes finais)
   - Cada cartao tem secao propria com transacoes
   - EXTRAIA transacoes de TODOS os cartoes do PDF
   - Transacoes internacionais com conversao USD/BRL
   - Pode incluir programa Smiles (ignorar informacoes de milhas)
   - Mastercard BLACK

7. RENNER (REALIZE CREDITO):
   - Cartao de loja (Meu Cartao / Visa)
   - Formato simples com poucas transacoes
   - Parcelamentos longos (ate 12x)
   - "Fatura Segura" deve ser IGNORADA

8. XP:
   - Cartao premium (Visa Infinite)
   - MULTIPLAS moedas: EUR, USD, BRL
   - Muitas paginas com transacoes detalhadas
   - Transacoes internacionais com conversao - use SEMPRE o valor em BRL
   - Pode ter multiplos cartoes (titular + adicionais)
   - EXTRAIA transacoes de TODOS os cartoes

9. OUTROS BANCOS:
   - Bradesco, Banco do Brasil, Inter seguem padroes similares ao Itau
   - Priorize extrair: data, descricao completa, valor, parcela

Para cada transacao, extraia:
1. data: Data da transacao (SEMPRE no formato DD/MM/YYYY - complete o ano se necessario)
2. descricao: Descricao completa da transacao (mantenha exatamente como aparece)
3. valor: Valor em reais (numero positivo, sem R$, use ponto como decimal ex: 1234.56)
4. parcela: Se houver parcelamento (ex: "2/10"), senao null

REGRAS DE EXTRACAO:
- EXTRAIA todas as compras e despesas de TODOS os cartoes no PDF
- IGNORE: pagamentos recebidos, creditos, estornos (valores com sinal negativo ou indicacao)
- IGNORE: taxas como "Fatura Segura", "ANUIDADE", "AVAL EMERG. CREDITO", "IOF", "ENCARGOS"
- IGNORE: "PAGAMENTO DE FATURA", "PAGAMENTO EFETUADO", "CREDITO EM CONTA"
- IGNORE: linhas de IOF de transacoes internacionais (sao taxas, nao compras)
- Se a data estiver incompleta (sem ano), use o ano/mes da fatura
- Para valores com virgula brasileira (1.234,56), converta para formato decimal (1234.56)
- Para transacoes internacionais, use SEMPRE o valor ja convertido em BRL
- NAO duplique transacoes - cada compra deve aparecer apenas uma vez

Retorne APENAS um JSON valido, SEM markdown ou explicacoes:
{
  "transacoes": [
    {
      "data": "DD/MM/YYYY",
      "descricao": "descricao da transacao",
      "valor": 123.45,
      "parcela": "1/3"
    }
  ],
  "total_encontrado": numero_de_transacoes,
  "valor_total": soma_dos_valores,
  "banco_detectado": "nome do banco identificado ou desconhecido"
}`;

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

    // Verificar se a resposta foi bem sucedida
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Erro da API Anthropic:', response.status, errorData);

      // Mensagem de erro mais informativa
      let errorMsg = `API Anthropic retornou ${response.status}`;
      if (errorData.error?.message) {
        errorMsg += `: ${errorData.error.message}`;
      }
      if (response.status === 400) {
        errorMsg += '. Verifique se o PDF nao esta corrompido ou muito grande (max 10MB).';
      }

      return NextResponse.json(
        {
          error: errorMsg,
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
      banco_detectado: result.banco_detectado || 'desconhecido',
      modelo_usado: ANTHROPIC_MODEL,
      metodo: 'IA_PDF'
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
