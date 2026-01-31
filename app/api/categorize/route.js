import { NextResponse } from 'next/server';

// ============================================================
// CATEGORIZAÇÃO DETERMINÍSTICA (100% CONFIÁVEL)
// ============================================================

function categorizarDeterministico(descricao) {
  const desc = descricao.toUpperCase().trim();
  
  // ===== REGRA ABSOLUTA 1: FACEBK = Marketing Digital =====
  // Qualquer variação de FACEBK é Meta Ads
  if (desc.includes('FACEBK') || desc.includes('FACEBOOK') || desc.startsWith('FB ') || desc.includes('META ADS')) {
    return { categoria: 'Marketing Digital', incluir: true, confianca: 'alta' };
  }
  // PayPal Facebook (comum no C6/Amex)
  if (desc.includes('PAYPAL') && (desc.includes('FACEBOOK') || desc.includes('FACEB'))) {
    return { categoria: 'Marketing Digital', incluir: true, confianca: 'alta' };
  }
  
  // ===== REGRA ABSOLUTA 2: YAMPI = Taxas Checkout =====
  if (desc.includes('YAMPI') || desc.includes('PG *YAMPI') || desc.includes('CARTPANDA') || desc.includes('BRCARTPANDA')) {
    return { categoria: 'Taxas Checkout', incluir: true, confianca: 'alta' };
  }
  
  // ===== REGRA ABSOLUTA 3: TINY = ERP =====
  if (desc.includes('TINY')) {
    return { categoria: 'ERP', incluir: true, confianca: 'alta' };
  }
  
  // ===== REGRA ABSOLUTA 4: CANVA = Design/Ferramentas =====
  if (desc.includes('CANVA')) {
    return { categoria: 'Design/Ferramentas', incluir: true, confianca: 'alta' };
  }
  
  // ===== REGRA ABSOLUTA 5: Pagamento de fatura = EXCLUIR =====
  if (desc.includes('PAGAMENTO') && desc.includes('FATURA')) {
    return { categoria: 'Pessoal', incluir: false, confianca: 'alta' };
  }
  // Também detecta variações
  if (desc === 'PAGAMENTO DE FATURA' || desc.startsWith('PAGAMENTO DE FATURA') || desc.startsWith('PAGAMENTO FATURA')) {
    return { categoria: 'Pessoal', incluir: false, confianca: 'alta' };
  }
  
  // ===== REGRA: IOF e taxas bancárias = Outros (INCLUIR como gasto empresarial) =====
  // IOF é cobrado em compras internacionais de fornecedores, então é gasto da empresa
  if (desc.includes('IOF') || desc.includes('IMPOSTO OPERACOES FINANCEIRAS')) {
    return { categoria: 'Outros', incluir: true, confianca: 'alta' };
  }
  // Pagamento recebido (crédito na fatura) = EXCLUIR
  if (desc.includes('PAGAMENTO RECEBIDO') || desc.includes('INCLUSAO DE PAGAMENTO')) {
    return { categoria: 'Outros', incluir: false, confianca: 'alta' };
  }
  
  // ===== REGRA ABSOLUTA 6: Outros gastos empresariais conhecidos =====
  if (desc.includes('GOOGLE ADS') || desc.includes('GOOGLE AD') || desc.includes('ADWORDS')) {
    return { categoria: 'Marketing Digital', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('MICROSOFT') && (desc.includes('ADS') || desc.includes('ADVERTISING'))) {
    return { categoria: 'Marketing Digital', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('ALIEXPRESS') || desc.includes('ALIPAY') || desc.includes('ALIBABA') || desc.includes('ALI EXPRESS')) {
    return { categoria: 'Pagamento Fornecedores', incluir: true, confianca: 'alta' };
  }
  // Variações com PayPal e DL* (comum no C6)
  if (desc.includes('PAYPAL') && desc.includes('ALIPAY')) {
    return { categoria: 'Pagamento Fornecedores', incluir: true, confianca: 'alta' };
  }
  if (desc.startsWith('DL*ALIEXPRESS') || desc.includes('DL*ALI')) {
    return { categoria: 'Pagamento Fornecedores', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('PICPAY')) {
    return { categoria: 'Pagamento Fornecedores', incluir: true, confianca: 'alta' };
  }
  // Logística de entregas = Pagamento Fornecedores
  if (desc.includes('LOGGI') || desc.includes('CORREIOS') || desc.includes('JADLOG') || desc.includes('SEQUOIA')) {
    return { categoria: 'Pagamento Fornecedores', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('WISE') || desc.includes('TRANSFERWISE') || desc.includes('REMESSA ONLINE')) {
    return { categoria: 'Compra de Câmbio', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('OPENAI') || desc.includes('CHATGPT') || desc.includes('CLAUDE') || desc.includes('ANTHROPIC')) {
    return { categoria: 'IA e Automação', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('ADOBE') || desc.includes('FIGMA') || desc.includes('SKETCH')) {
    return { categoria: 'Design/Ferramentas', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('BRDID') || desc.includes('VOIP') || desc.includes('TWILIO')) {
    return { categoria: 'Telefonia', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('TRELLO') || desc.includes('ATLASSIAN') || desc.includes('NOTION') || desc.includes('ASANA') || desc.includes('MONDAY')) {
    return { categoria: 'Gestão', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('SHOPIFY') || desc.includes('NUVEMSHOP')) {
    return { categoria: 'Taxas Checkout', incluir: true, confianca: 'alta' };
  }
  
  // ===== REGRA ABSOLUTA 7: Gastos pessoais conhecidos = EXCLUIR =====
  const gastosExcluir = [
    // Restaurantes
    'SUSHI', 'BURGER', 'PIZZA', 'MCDONALDS', 'MCDONALD', 'SUBWAY', 'HABIB', 'OUTBACK', 
    'RESTAURANTE', 'LANCHONETE', 'PADARIA', 'CAFETERIA', 'STARBUCKS', 'IFOOD',
    // Hotéis e viagem pessoal
    'HOTEIS.COM', 'HOTEIS', 'BOOKING', 'AIRBNB', 'DECOLAR', 'TRIVAGO', 'EXPEDIA',
    // Farmácias
    'FARMACIA', 'DROGASIL', 'DROGARIA', 'REDEPHARMA', 'PACHECO', 'PANVEL', 'DROGA RAIA', 'DROGARAIA',
    // Roupas e acessórios
    'RAYBAN', 'RAY-BAN', 'RENNER', 'C&A', 'CEA', 'ZARA', 'NIKE', 'ADIDAS', 'CENTAURO', 'NETSHOES', 'RIACHUELO',
    // Supermercados
    'CARREFOUR', 'EXTRA', 'PAO DE ACUCAR', 'ASSAI', 'ATACADAO', 'BIG', 'SUPERMERCADO', 'MERCADO',
    // Combustível
    'SHELL', 'IPIRANGA', 'POSTO', 'PETROBRAS', 'GASOLINA', 'COMBUSTIVEL', 'AUTO POSTO',
    // Estacionamento
    'PARKING', 'ESTACIONAMENTO', 'LAZ PARKING', 'ESTAPAR', 'ZONA AZUL', 'AGILPARK',
    // Lojas pessoais conhecidas
    'FERREIRA COSTA', 'PNEUMAC', 'LEROY MERLIN', 'TELHA NORTE', 'CASA SHOW', 'MCA',
    // Museus e turismo
    'ART INST', 'INSTITUTO', 'MUSEUM', 'MUSEU', 'TEATRO', 'CINEMA', 'INGRESSO',
    // Transporte pessoal
    'UBER', '99POP', '99APP', 'CABIFY', '99 ', 'TAXI',
    // Entretenimento
    'NETFLIX', 'SPOTIFY', 'DISNEY', 'HBO', 'AMAZON PRIME', 'DEEZER', 'YOUTUBE PREMIUM',
    'PRODUTOS GLOBO', 'GLOBOPLAY', 'TELECINE',
    // Jogos e assinaturas pessoais
    'PLAYSTATION', 'SONY PLAYSTATION', 'SONYPLAYSTAT', 'XBOX', 'STEAM', 'NINTENDO',
    // Assinaturas Apple (iCloud, Apple Music, etc)
    'APPLE.COM/BILL', 'APPLE.COM', 'ITUNES',
    // Gift cards (geralmente pessoal)
    'GIFT CARD', 'GIFTCARD',
    // Lojas de eletrodomésticos
    'DAFONTE', 'CASAS BAHIA', 'MAGAZINE LUIZA', 'MAGALU', 'AMERICANAS', 'PONTO FRIO',
    // Marketplaces pessoais
    'SHOPEE', 'SWOPEE', 'MERCADOLIVRE', 'MERCADO LIVRE', 'MELI',
    // Serviços pessoais
    'SERASA', 'EXPERIAN'
  ];
  
  for (const termo of gastosExcluir) {
    if (desc.includes(termo)) {
      return { categoria: 'Pessoal', incluir: false, confianca: 'alta' };
    }
  }
  
  // ===== REGRA 8: Nomes de pessoas (transferências) = EXCLUIR =====
  // Detecta padrões como "NORMA LUCIA", "JOAO SILVA", etc.
  if (/^[A-Z]+ [A-Z]+ ?[A-Z]?$/.test(desc) || desc.includes('NORMA') || desc.includes('PIX ')) {
    return { categoria: 'Pessoal', incluir: false, confianca: 'media' };
  }
  
  // ===== CASO NÃO IDENTIFICADO = Dúvida =====
  return { categoria: null, incluir: null, confianca: 'baixa' };
}

export async function POST(request) {
  try {
    const { transacoes } = await request.json();
    
    if (!transacoes || transacoes.length === 0) {
      return NextResponse.json({ error: 'Nenhuma transação fornecida' }, { status: 400 });
    }

    // ===== PASSO 1: Categorização determinística =====
    const resultados = [];
    const duvidosos = [];
    
    for (let i = 0; i < transacoes.length; i++) {
      const t = transacoes[i];
      const resultado = categorizarDeterministico(t.descricao);
      
      if (resultado.categoria !== null) {
        // Categorização determinística funcionou
        resultados[i] = { categoria: resultado.categoria, incluir: resultado.incluir };
      } else {
        // Caso duvidoso - guardar para IA
        duvidosos.push({ index: i, ...t });
        resultados[i] = null; // placeholder
      }
    }
    
    // ===== PASSO 2: Se há casos duvidosos, usar IA =====
    if (duvidosos.length > 0 && process.env.ANTHROPIC_API_KEY) {
      try {
        const respostasIA = await categorizarComIA(duvidosos);
        
        // Preencher os resultados com respostas da IA
        for (let j = 0; j < duvidosos.length; j++) {
          const idx = duvidosos[j].index;
          if (respostasIA[j]) {
            resultados[idx] = respostasIA[j];
          } else {
            // Fallback se IA não respondeu
            resultados[idx] = { categoria: 'Outros', incluir: false };
          }
        }
      } catch (iaError) {
        console.error('Erro na IA, usando fallback:', iaError);
        // Fallback para todos os duvidosos
        for (const d of duvidosos) {
          resultados[d.index] = { categoria: 'Outros', incluir: false };
        }
      }
    } else {
      // Sem API key ou sem duvidosos - fallback
      for (const d of duvidosos) {
        resultados[d.index] = { categoria: 'Outros', incluir: false };
      }
    }
    
    return NextResponse.json({ 
      resultados,
      stats: {
        total: transacoes.length,
        automaticos: transacoes.length - duvidosos.length,
        analisadosIA: duvidosos.length
      }
    });
    
  } catch (error) {
    console.error('Erro ao categorizar:', error);
    return NextResponse.json({ error: 'Erro ao processar categorização' }, { status: 500 });
  }
}

// ===== Função para chamar a IA apenas para casos duvidosos =====
async function categorizarComIA(duvidosos) {
  const prompt = `Analise APENAS estas ${duvidosos.length} transações DUVIDOSAS e categorize cada uma.

CONTEXTO: Cartão de e-commerce de iluminação (ORNE). Separar gastos empresariais de pessoais.

CATEGORIAS EMPRESARIAIS (incluir: true):
- Marketing Digital, Pagamento Fornecedores, Taxas Checkout, Compra de Câmbio
- IA e Automação, Design/Ferramentas, Telefonia, ERP, Gestão

CATEGORIAS PESSOAIS (incluir: false):
- Pessoal (gastos pessoais identificáveis)
- Outros (desconhecidos - na dúvida, excluir)

TRANSAÇÕES:
${duvidosos.map((d, i) => `${i + 1}. "${d.descricao}" - R$ ${d.valor}`).join('\n')}

Responda APENAS com JSON:
{"resultados":[{"categoria":"...","incluir":true/false},...]}`;

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
    throw new Error('Erro na API Claude');
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';
  
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    const result = JSON.parse(jsonMatch[0]);
    return result.resultados || [];
  }
  
  return [];
}
