import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { transacoes } = await request.json();
    
    if (!transacoes || transacoes.length === 0) {
      return NextResponse.json({ error: 'Nenhuma transação fornecida' }, { status: 400 });
    }

    const prompt = `Você é um assistente especializado em categorizar transações financeiras de faturas de cartão de crédito.

CONTEXTO: O cartão é usado tanto para GASTOS EMPRESARIAIS (e-commerce ORNE de iluminação) quanto para GASTOS PESSOAIS do titular.

SUA TAREFA:
1. Categorizar cada transação
2. Marcar se é gasto EMPRESARIAL (incluir=true) ou PESSOAL (incluir=false)

CATEGORIAS EMPRESARIAIS (incluir=true):
- Marketing Digital: FACEBK, Facebook, Meta Ads, Google Ads, Microsoft Ads, PayPal *FACEBOOK - são anúncios de tráfego pago
- Pagamento Fornecedores: AliExpress, AliPay, PayPal USD, compras em atacado/China
- Taxas Checkout: YAMPI, Cartpanda, PG *YAMPI - são taxas de gateway de pagamento do e-commerce
- Compra de Câmbio: Wise, transferências internacionais
- IA e Automação: OpenAI, ChatGPT, Claude, Anthropic, Canva (ferramenta de design)
- Telefonia: BrDid, telefonia VoIP
- ERP: TINY ERP, sistemas de gestão
- Gestão: Trello, Atlassian, Notion, ferramentas de produtividade
- Design/Ferramentas: Canva, Adobe, ferramentas de criação

TRANSAÇÕES A EXCLUIR (incluir=false):
- "Pagamento de fatura" - são pagamentos do próprio cartão, não são gastos
- Valores NEGATIVOS (créditos/estornos)
- Farmácias: REDEPHARMA, DROGASIL, DROGARIA, PACHECO - gastos pessoais de saúde
- Lojas de roupas/acessórios pessoais: RAYBAN, RENNER, C&A, ZARA, NIKE, ADIDAS
- Supermercados: CARREFOUR, EXTRA, PAO DE ACUCAR, ASSAI
- Restaurantes pessoais: nomes de restaurantes, SUSHI, BURGER, PIZZA, MCDONALDS, SUBWAY
- Postos de gasolina: SHELL, IPIRANGA, BR, PETROBRÁS
- Estacionamentos: PARKING, ESTACIONAMENTO
- Compras pessoais diversas: FERREIRA COSTA (loja de construção), PNEUMAC, MCA
- Viagens PESSOAIS: HOTEIS.COM, BOOKING (quando não for viagem a trabalho)
- Companhias aéreas SEM contexto empresarial
- Qualquer estabelecimento claramente pessoal/varejo

REGRAS IMPORTANTES:
1. FACEBK/Facebook = SEMPRE Marketing Digital (são anúncios Meta Ads)
2. YAMPI = SEMPRE Taxas Checkout (gateway de pagamento)
3. TINY ERP = SEMPRE ERP
4. Pagamento de fatura = SEMPRE excluir
5. Valores negativos = SEMPRE excluir
6. Na DÚVIDA se é pessoal ou empresarial = EXCLUIR (incluir=false)

TRANSAÇÕES PARA ANALISAR:
${transacoes.map((t, i) => `${i + 1}. ${t.data} | ${t.descricao} | R$ ${t.valor}`).join('\n')}

RESPONDA APENAS COM JSON VÁLIDO:
{
  "resultados": [
    {"categoria": "Marketing Digital", "incluir": true},
    {"categoria": "Pessoal", "incluir": false},
    ...
  ]
}

O array deve ter EXATAMENTE ${transacoes.length} itens, um para cada transação na mesma ordem.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-20250514',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Erro na API Claude:', errorText);
      // Fallback para categorização por padrões
      const resultadosFallback = transacoes.map(t => categorizarPorPadrao(t.descricao));
      return NextResponse.json({ resultados: resultadosFallback, fallback: true });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    
    // Extrair JSON da resposta
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      if (result.resultados) {
        return NextResponse.json({ resultados: result.resultados });
      }
      // Compatibilidade com formato antigo
      if (result.categorias) {
        const resultados = result.categorias.map(cat => ({ categoria: cat, incluir: true }));
        return NextResponse.json({ resultados });
      }
    }
    
    // Fallback se não conseguir extrair JSON
    const resultadosFallback = transacoes.map(t => categorizarPorPadrao(t.descricao));
    return NextResponse.json({ resultados: resultadosFallback, fallback: true });
    
  } catch (error) {
    console.error('Erro ao categorizar:', error);
    return NextResponse.json({ error: 'Erro ao processar categorização' }, { status: 500 });
  }
}

function categorizarPorPadrao(descricao) {
  const desc = descricao.toUpperCase();
  
  // EXCLUIR - Pagamentos e valores negativos
  if (desc.includes('PAGAMENTO DE FATURA') || desc.includes('PAGAMENTO FATURA')) {
    return { categoria: 'Pessoal', incluir: false };
  }
  
  // EXCLUIR - Gastos pessoais
  const pessoais = [
    'FARMACIA', 'DROGASIL', 'DROGARIA', 'REDEPHARMA', 'PACHECO', 'PANVEL',
    'RAYBAN', 'RENNER', 'C&A', 'ZARA', 'NIKE', 'ADIDAS', 'CENTAURO',
    'CARREFOUR', 'EXTRA', 'PAO DE ACUCAR', 'ASSAI', 'ATACADAO', 'BIG',
    'SUSHI', 'BURGER', 'PIZZA', 'MCDONALDS', 'SUBWAY', 'HABIB', 'OUTBACK',
    'SHELL', 'IPIRANGA', 'POSTO', 'PETROBRAS', 'GASOLINA',
    'PARKING', 'ESTACIONAMENTO', 'LAZ PARKING',
    'FERREIRA COSTA', 'PNEUMAC', 'MCA', 'NORMA',
    'HOTEIS.COM', 'BOOKING', 'AIRBNB',
    'UBER', '99POP', '99APP', 'CABIFY'
  ];
  
  for (const termo of pessoais) {
    if (desc.includes(termo)) {
      return { categoria: 'Pessoal', incluir: false };
    }
  }
  
  // INCLUIR - Gastos empresariais
  if (desc.includes('FACEBK') || desc.includes('FACEBOOK') || desc.includes('META')) {
    return { categoria: 'Marketing Digital', incluir: true };
  }
  if (desc.includes('GOOGLE ADS') || desc.includes('MICROSOFT')) {
    return { categoria: 'Marketing Digital', incluir: true };
  }
  if (desc.includes('ALIEXPRESS') || desc.includes('ALIPAY') || desc.includes('ALIBABA')) {
    return { categoria: 'Pagamento Fornecedores', incluir: true };
  }
  if (desc.includes('YAMPI') || desc.includes('CARTPANDA') || desc.includes('PG *YAMPI')) {
    return { categoria: 'Taxas Checkout', incluir: true };
  }
  if (desc.includes('WISE') || desc.includes('REMESSA')) {
    return { categoria: 'Compra de Câmbio', incluir: true };
  }
  if (desc.includes('OPENAI') || desc.includes('CHATGPT') || desc.includes('CLAUDE') || desc.includes('ANTHROPIC')) {
    return { categoria: 'IA e Automação', incluir: true };
  }
  if (desc.includes('CANVA')) {
    return { categoria: 'Design/Ferramentas', incluir: true };
  }
  if (desc.includes('BRDID') || desc.includes('VOIP')) {
    return { categoria: 'Telefonia', incluir: true };
  }
  if (desc.includes('TINY')) {
    return { categoria: 'ERP', incluir: true };
  }
  if (desc.includes('TRELLO') || desc.includes('ATLASSIAN') || desc.includes('NOTION')) {
    return { categoria: 'Gestão', incluir: true };
  }
  
  // Na dúvida, excluir
  return { categoria: 'Outros', incluir: false };
}
