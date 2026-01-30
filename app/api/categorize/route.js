import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { transacoes } = await request.json();
    
    if (!transacoes || transacoes.length === 0) {
      return NextResponse.json({ error: 'Nenhuma transação fornecida' }, { status: 400 });
    }

    const prompt = `Você é um assistente especializado em categorizar transações financeiras de faturas de cartão de crédito de um e-commerce de iluminação (ORNE).

CONTEXTO: O cartão é usado tanto para GASTOS EMPRESARIAIS quanto para GASTOS PESSOAIS do titular.

## REGRAS ABSOLUTAS (SEGUIR À RISCA):

### REGRA 1 - FACEBK/FACEBOOK = SEMPRE Marketing Digital
- Qualquer transação com "FACEBK", "FACEBK*", "FACEBK *" = Marketing Digital, incluir=true
- NÃO IMPORTA o código depois (ex: FACEBK *ZZK495MCD2, FACEBK *ZM2HG5HJW2)
- TODOS são anúncios Meta Ads = Marketing Digital

### REGRA 2 - YAMPI = SEMPRE Taxas Checkout
- "PG *YAMPI" ou "YAMPI" = Taxas Checkout, incluir=true
- É gateway de pagamento do e-commerce

### REGRA 3 - TINY = SEMPRE ERP
- "TINY ERP" ou "TINY" = ERP, incluir=true
- É sistema de gestão empresarial

### REGRA 4 - CANVA = SEMPRE Design/Ferramentas  
- "CANVA", "EBN*CANVA" = Design/Ferramentas, incluir=true
- É ferramenta de design usada no negócio

### REGRA 5 - EXCLUIR GASTOS PESSOAIS (incluir=false):
- Restaurantes: SUSHI, BURGER, PIZZA, MCDONALDS, OUTBACK, qualquer nome de restaurante
- Hotéis/Viagem pessoal: HOTEIS.COM, BOOKING, AIRBNB, DECOLAR
- Farmácias: REDEPHARMA, DROGASIL, DROGARIA, PACHECO
- Roupas: RAYBAN, RENNER, C&A, ZARA, NIKE
- Supermercados: CARREFOUR, EXTRA, ASSAI
- Estacionamento: PARKING, LAZ PARKING
- Museus/turismo: ART INST, INSTITUTO, MUSEUM, MUSEU
- Lojas diversas: FERREIRA COSTA, PNEUMAC, MCA, NORMA
- Pagamentos: "Pagamento de fatura" = SEMPRE excluir

### REGRA 6 - DESCONHECIDOS
- Se não conseguir identificar claramente = categoria "Outros", incluir=false
- MCA, nomes de pessoas, estabelecimentos desconhecidos = Outros, incluir=false

## CATEGORIAS VÁLIDAS:
- Marketing Digital (FACEBK, Google Ads, Microsoft Ads)
- Pagamento Fornecedores (AliExpress, AliPay)
- Taxas Checkout (YAMPI, Cartpanda)
- Compra de Câmbio (Wise)
- IA e Automação (OpenAI, ChatGPT, Claude)
- Design/Ferramentas (Canva, Adobe)
- Telefonia (BrDid)
- ERP (Tiny)
- Gestão (Trello, Atlassian, Notion)
- Pessoal (gastos pessoais a excluir)
- Outros (desconhecidos a excluir)

## TRANSAÇÕES PARA ANALISAR:
${transacoes.map((t, i) => `${i + 1}. ${t.data} | ${t.descricao} | R$ ${t.valor}`).join('\n')}

## RESPONDA APENAS COM JSON VÁLIDO:
{
  "resultados": [
    {"categoria": "Marketing Digital", "incluir": true},
    {"categoria": "Pessoal", "incluir": false},
    ...
  ]
}

IMPORTANTE: 
- O array DEVE ter EXATAMENTE ${transacoes.length} itens
- TODA transação com FACEBK = Marketing Digital, incluir: true
- TODA transação com YAMPI/PG *YAMPI = Taxas Checkout, incluir: true
- TODA transação com TINY = ERP, incluir: true
- TODA transação com CANVA = Design/Ferramentas, incluir: true`;

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
  
  // REGRA 1: FACEBK = SEMPRE Marketing Digital
  if (desc.includes('FACEBK') || desc.includes('FACEBOOK') || desc.includes('META ADS')) {
    return { categoria: 'Marketing Digital', incluir: true };
  }
  
  // REGRA 2: YAMPI = SEMPRE Taxas Checkout
  if (desc.includes('YAMPI') || desc.includes('PG *YAMPI') || desc.includes('CARTPANDA')) {
    return { categoria: 'Taxas Checkout', incluir: true };
  }
  
  // REGRA 3: TINY = SEMPRE ERP
  if (desc.includes('TINY')) {
    return { categoria: 'ERP', incluir: true };
  }
  
  // REGRA 4: CANVA = SEMPRE Design/Ferramentas
  if (desc.includes('CANVA')) {
    return { categoria: 'Design/Ferramentas', incluir: true };
  }
  
  // REGRA 5: Outros gastos empresariais
  if (desc.includes('GOOGLE ADS') || desc.includes('MICROSOFT ADS')) {
    return { categoria: 'Marketing Digital', incluir: true };
  }
  if (desc.includes('ALIEXPRESS') || desc.includes('ALIPAY') || desc.includes('ALIBABA')) {
    return { categoria: 'Pagamento Fornecedores', incluir: true };
  }
  if (desc.includes('WISE') || desc.includes('REMESSA')) {
    return { categoria: 'Compra de Câmbio', incluir: true };
  }
  if (desc.includes('OPENAI') || desc.includes('CHATGPT') || desc.includes('CLAUDE') || desc.includes('ANTHROPIC')) {
    return { categoria: 'IA e Automação', incluir: true };
  }
  if (desc.includes('BRDID') || desc.includes('VOIP')) {
    return { categoria: 'Telefonia', incluir: true };
  }
  if (desc.includes('TRELLO') || desc.includes('ATLASSIAN') || desc.includes('NOTION')) {
    return { categoria: 'Gestão', incluir: true };
  }
  if (desc.includes('ADOBE')) {
    return { categoria: 'Design/Ferramentas', incluir: true };
  }
  
  // REGRA 6: EXCLUIR - Pagamentos e valores negativos
  if (desc.includes('PAGAMENTO DE FATURA') || desc.includes('PAGAMENTO FATURA')) {
    return { categoria: 'Pessoal', incluir: false };
  }
  
  // REGRA 7: EXCLUIR - Gastos pessoais conhecidos
  const pessoais = [
    // Restaurantes
    'SUSHI', 'BURGER', 'PIZZA', 'MCDONALDS', 'SUBWAY', 'HABIB', 'OUTBACK', 'RESTAURANTE',
    // Hotéis e viagem
    'HOTEIS.COM', 'HOTEIS', 'BOOKING', 'AIRBNB', 'DECOLAR',
    // Farmácias
    'FARMACIA', 'DROGASIL', 'DROGARIA', 'REDEPHARMA', 'PACHECO', 'PANVEL',
    // Roupas
    'RAYBAN', 'RENNER', 'C&A', 'ZARA', 'NIKE', 'ADIDAS', 'CENTAURO',
    // Supermercados
    'CARREFOUR', 'EXTRA', 'PAO DE ACUCAR', 'ASSAI', 'ATACADAO', 'BIG', 'SUPERMERCADO',
    // Combustível
    'SHELL', 'IPIRANGA', 'POSTO', 'PETROBRAS', 'GASOLINA', 'COMBUSTIVEL',
    // Estacionamento
    'PARKING', 'ESTACIONAMENTO', 'LAZ PARKING',
    // Lojas pessoais
    'FERREIRA COSTA', 'PNEUMAC', 'NORMA',
    // Museus e turismo
    'ART INST', 'INSTITUTO', 'MUSEUM', 'MUSEU',
    // Transporte pessoal
    'UBER', '99POP', '99APP', 'CABIFY'
  ];
  
  for (const termo of pessoais) {
    if (desc.includes(termo)) {
      return { categoria: 'Pessoal', incluir: false };
    }
  }
  
  // REGRA 8: Desconhecidos = Outros, não incluir
  // MCA, nomes desconhecidos, etc.
  return { categoria: 'Outros', incluir: false };
}
