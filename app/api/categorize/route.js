import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { transacoes } = await request.json();
    
    if (!transacoes || transacoes.length === 0) {
      return NextResponse.json({ error: 'Nenhuma transação fornecida' }, { status: 400 });
    }

    const prompt = `Você é um assistente especializado em categorizar transações financeiras de uma empresa de e-commerce de iluminação (ORNE).

CATEGORIAS DISPONÍVEIS (use EXATAMENTE estes nomes):
- Marketing Digital: Facebook/Meta Ads, Google Ads, Microsoft Ads, PayPal *FACEBOOKSER, FACEBK, qualquer coisa relacionada a anúncios e tráfego pago
- Pagamento Fornecedores: AliExpress, AliPay, PayPal em USD, compras de produtos para revenda
- Taxas Checkout: Cartpanda, Yampi, taxas de gateway de pagamento
- Compra de Câmbio: Wise, transferências internacionais, câmbio
- IA e Automação: OpenAI, ChatGPT, Claude, Anthropic, ferramentas de IA
- Telefonia: BrDid, telefonia VoIP
- ERP: Tiny, sistemas de gestão empresarial
- Gestão: Trello, Atlassian, Notion, ferramentas de produtividade
- Viagem: Companhias aéreas (Azul, Gol, Latam), hotéis, Uber, 99, transporte
- Outros: Qualquer coisa que não se encaixe nas anteriores

TRANSAÇÕES PARA CATEGORIZAR:
${transacoes.map((t, i) => `${i + 1}. ${t.data} | ${t.descricao} | R$ ${t.valor}`).join('\n')}

RESPONDA APENAS COM UM JSON válido no formato:
{"categorias": ["categoria1", "categoria2", ...]}

Use EXATAMENTE os nomes das categorias listadas acima. O array deve ter ${transacoes.length} itens, um para cada transação na mesma ordem.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Erro na API Claude:', errorText);
      // Fallback para categorização por padrões
      const categoriasFallback = transacoes.map(t => categorizarPorPadrao(t.descricao));
      return NextResponse.json({ categorias: categoriasFallback, fallback: true });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    
    // Extrair JSON da resposta
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return NextResponse.json({ categorias: result.categorias || [] });
    }
    
    // Fallback se não conseguir extrair JSON
    const categoriasFallback = transacoes.map(t => categorizarPorPadrao(t.descricao));
    return NextResponse.json({ categorias: categoriasFallback, fallback: true });
    
  } catch (error) {
    console.error('Erro ao categorizar:', error);
    return NextResponse.json({ error: 'Erro ao processar categorização' }, { status: 500 });
  }
}

function categorizarPorPadrao(descricao) {
  const desc = descricao.toUpperCase();
  
  if (desc.includes('FACEBK') || desc.includes('FACEBOOK') || desc.includes('META') || 
      desc.includes('GOOGLE ADS') || desc.includes('MICROSOFT') || desc.includes('ADS')) {
    return 'Marketing Digital';
  }
  if (desc.includes('ALIEXPRESS') || desc.includes('ALIPAY') || desc.includes('ALIBABA')) {
    return 'Pagamento Fornecedores';
  }
  if (desc.includes('CARTPANDA') || desc.includes('YAMPI')) {
    return 'Taxas Checkout';
  }
  if (desc.includes('WISE') || desc.includes('CAMBIO') || desc.includes('REMESSA')) {
    return 'Compra de Câmbio';
  }
  if (desc.includes('OPENAI') || desc.includes('CHATGPT') || desc.includes('CLAUDE') || desc.includes('ANTHROPIC')) {
    return 'IA e Automação';
  }
  if (desc.includes('BRDID') || desc.includes('VOIP')) {
    return 'Telefonia';
  }
  if (desc.includes('TINY')) {
    return 'ERP';
  }
  if (desc.includes('TRELLO') || desc.includes('ATLASSIAN') || desc.includes('NOTION')) {
    return 'Gestão';
  }
  if (desc.includes('AZUL') || desc.includes('GOL') || desc.includes('LATAM') || 
      desc.includes('UBER') || desc.includes('99') || desc.includes('HOTEL') ||
      desc.includes('AEREO') || desc.includes('VIAGEM')) {
    return 'Viagem';
  }
  
  return 'Outros';
}
