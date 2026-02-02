import { NextResponse } from 'next/server';

// ============================================================
// CATEGORIZAÇÃO DETERMINÍSTICA (100% CONFIÁVEL)
// ============================================================

function categorizarDeterministico(descricao) {
  const desc = descricao.toUpperCase().trim();

  // ===== REGRA: PAYPAL*PAYPAL *FA = Facebook Ads (Marketing Digital) =====
  // FA = abreviação de Facebook em faturas de cartão
  if (desc.match(/PAYPAL\*PAYPAL\s*\*FA/)) {
    return { categoria: 'Marketing Digital', incluir: true, confianca: 'alta' };
  }

  // ===== REGRA ABSOLUTA 1: FACEBK = Marketing Digital =====
  if (desc.includes('FACEBK') || desc.includes('FACEBOOK') || desc.startsWith('FB ') || desc.includes('META ADS')) {
    return { categoria: 'Marketing Digital', incluir: true, confianca: 'alta' };
  }
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
  if (desc === 'PAGAMENTO DE FATURA' || desc.startsWith('PAGAMENTO DE FATURA') || desc.startsWith('PAGAMENTO FATURA')) {
    return { categoria: 'Pessoal', incluir: false, confianca: 'alta' };
  }

  // ===== REGRA: IOF e taxas bancárias = Outros (INCLUIR como gasto empresarial) =====
  if (desc.includes('IOF') || desc.includes('IMPOSTO OPERACOES FINANCEIRAS')) {
    return { categoria: 'Outros', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('PAGAMENTO RECEBIDO') || desc.includes('INCLUSAO DE PAGAMENTO')) {
    return { categoria: 'Outros', incluir: false, confianca: 'alta' };
  }

  // ===== REGRA: Tarifas e seguros de cartão = EXCLUIR =====
  if (desc.includes('FATURA SEGURA') || desc.includes('SEGURO FATURA')) {
    return { categoria: 'Pessoal', incluir: false, confianca: 'alta' };
  }
  if (desc.includes('ANUIDADE')) {
    return { categoria: 'Pessoal', incluir: false, confianca: 'alta' };
  }
  if (desc.includes('AVAL EMERG') || desc.includes('AVALIACAO EMERG') || desc.includes('CREDITO EMERG')) {
    return { categoria: 'Pessoal', incluir: false, confianca: 'alta' };
  }
  if (desc.includes('TARIFA') || desc.includes('ENCARGO') || desc.includes('MULTA') || desc.includes('JUROS MORA')) {
    return { categoria: 'Pessoal', incluir: false, confianca: 'alta' };
  }

  // ===== REGRA: Passagens aéreas e viagens = PESSOAL =====
  // Companhias aéreas e sites de viagem são gastos pessoais por padrão
  const viagens = [
    'GOL', 'LATAM', 'AZUL', 'AVIANCA', 'TAM', 'AMERICAN AIRLINES', 'UNITED', 'DELTA',
    'SMILES', 'MULTIPLUS', 'LIVELO', 'TUDOAZUL',
    'PASSAGEM', 'PASSAGENS', 'AEREO', 'AEREA', 'AIRLINE', 'AIRLINES',
    'MAXMILHAS', 'VOEAZUL', 'VOEGOL', 'VOELATAM', '123MILHAS',
    'HOTEIS.COM', 'HOTEIS', 'BOOKING', 'AIRBNB', 'DECOLAR', 'TRIVAGO', 'EXPEDIA',
    'HOTEL', 'POUSADA', 'HOSPEDAGEM'
  ];
  for (const termo of viagens) {
    if (desc.includes(termo)) {
      return { categoria: 'Pessoal', incluir: false, confianca: 'alta' };
    }
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
  if (desc.includes('PAYPAL') && desc.includes('ALIPAY')) {
    return { categoria: 'Pagamento Fornecedores', incluir: true, confianca: 'alta' };
  }
  if (desc.startsWith('DL*ALIEXPRESS') || desc.includes('DL*ALI')) {
    return { categoria: 'Pagamento Fornecedores', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('PICPAY')) {
    return { categoria: 'Pagamento Fornecedores', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('LOGGI') || desc.includes('CORREIOS') || desc.includes('JADLOG') || desc.includes('SEQUOIA')) {
    return { categoria: 'Pagamento Fornecedores', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('WISE') || desc.includes('TRANSFERWISE') || desc.includes('REMESSA ONLINE')) {
    return { categoria: 'Compra de Câmbio', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('OPENAI') || desc.includes('CHATGPT') || desc.includes('CLAUDE') || desc.includes('ANTHROPIC')) {
    return { categoria: 'IA e Automação', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('ADOBE') || desc.includes('FIGMA') || desc.includes('SKETCH') || desc.includes('FREEPIK') || desc.includes('MAGNIFIC')) {
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
    'SUSHI', 'BURGER', 'PIZZA', 'MCDONALDS', 'MCDONALD', 'SUBWAY', 'HABIB', 'OUTBACK',
    'RESTAURANTE', 'LANCHONETE', 'PADARIA', 'CAFETERIA', 'STARBUCKS', 'IFOOD',
    'FARMACIA', 'DROGASIL', 'DROGARIA', 'REDEPHARMA', 'PACHECO', 'PANVEL', 'DROGA RAIA', 'DROGARAIA',
    'RAYBAN', 'RAY-BAN', 'RENNER', 'C&A', 'CEA', 'ZARA', 'NIKE', 'ADIDAS', 'CENTAURO', 'NETSHOES', 'RIACHUELO',
    'CARREFOUR', 'EXTRA', 'PAO DE ACUCAR', 'ASSAI', 'ATACADAO', 'BIG', 'SUPERMERCADO', 'MERCADO',
    'SHELL', 'IPIRANGA', 'POSTO', 'PETROBRAS', 'GASOLINA', 'COMBUSTIVEL', 'AUTO POSTO',
    'PARKING', 'ESTACIONAMENTO', 'LAZ PARKING', 'ESTAPAR', 'ZONA AZUL', 'AGILPARK',
    'FERREIRA COSTA', 'PNEUMAC', 'LEROY MERLIN', 'TELHA NORTE', 'CASA SHOW', 'MCA',
    'ART INST', 'INSTITUTO', 'MUSEUM', 'MUSEU', 'TEATRO', 'CINEMA', 'INGRESSO',
    'UBER', '99POP', '99APP', 'CABIFY', '99 ', 'TAXI',
    'NETFLIX', 'SPOTIFY', 'DISNEY', 'HBO', 'AMAZON PRIME', 'DEEZER', 'YOUTUBE PREMIUM',
    'PRODUTOS GLOBO', 'GLOBOPLAY', 'TELECINE',
    'PLAYSTATION', 'SONY PLAYSTATION', 'SONYPLAYSTAT', 'XBOX', 'STEAM', 'NINTENDO',
    'APPLE.COM/BILL', 'APPLE.COM', 'ITUNES',
    'GIFT CARD', 'GIFTCARD',
    'DAFONTE', 'CASAS BAHIA', 'MAGAZINE LUIZA', 'MAGALU', 'AMERICANAS', 'PONTO FRIO',
    'SHOPEE', 'SWOPEE', 'MERCADOLIVRE', 'MERCADO LIVRE', 'MELI',
    'SERASA', 'EXPERIAN'
  ];

  for (const termo of gastosExcluir) {
    if (desc.includes(termo)) {
      return { categoria: 'Pessoal', incluir: false, confianca: 'alta' };
    }
  }

  // ===== REGRA 8: Nomes de pessoas (transferências) = EXCLUIR =====
  if (/^[A-Z]+ [A-Z]+ ?[A-Z]?$/.test(desc) || desc.includes('NORMA') || desc.includes('PIX ')) {
    return { categoria: 'Pessoal', incluir: false, confianca: 'media' };
  }

  // ===== REGRA 9: Transferências Mercado Pago (MP*) = PESSOAL =====
  if (desc.startsWith('MP*') || desc.startsWith('MP *')) {
    if (!desc.includes('TINY') && !desc.includes('YAMPI') && !desc.includes('CANVA')) {
      return { categoria: 'Pessoal', incluir: false, confianca: 'media' };
    }
  }

  // ===== REGRA 10: Pagamentos PagSeguro/Ecommerce (EC*) = PESSOAL =====
  if (desc.startsWith('EC *') || desc.startsWith('EC*')) {
    return { categoria: 'Pessoal', incluir: false, confianca: 'media' };
  }

  // ===== REGRA 11: Pagamentos via Pix/transferências = PESSOAL =====
  if (desc.startsWith('PAG*') && !desc.includes('PAGSEGURO')) {
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
        resultados[i] = { categoria: resultado.categoria, incluir: resultado.incluir };
      } else {
        duvidosos.push({ index: i, ...t });
        resultados[i] = null;
      }
    }

    // ===== PASSO 2: Se há casos duvidosos, usar IA =====
    if (duvidosos.length > 0 && process.env.ANTHROPIC_API_KEY) {
      try {
        const respostasIA = await categorizarComIA(duvidosos);

        for (let j = 0; j < duvidosos.length; j++) {
          const idx = duvidosos[j].index;
          if (respostasIA[j]) {
            resultados[idx] = respostasIA[j];
          } else {
            resultados[idx] = { categoria: 'Outros', incluir: false };
          }
        }
      } catch (iaError) {
        console.error('Erro na IA, usando fallback:', iaError);
        for (const d of duvidosos) {
          resultados[d.index] = { categoria: 'Outros', incluir: false };
        }
      }
    } else {
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
  const prompt = `Você é um especialista em contabilidade para e-commerce brasileiro. Analise estas ${duvidosos.length} transações e categorize cada uma com precisão.

CONTEXTO DO NEGÓCIO:
- Empresa: ORNE (e-commerce de iluminação)
- Objetivo: Separar gastos empresariais (PJ) de gastos pessoais (PF) para contabilidade

PADRÕES COMUNS EM FATURAS BRASILEIRAS:
- MP* = Mercado Pago (geralmente compras pessoais ou transferências)
- EC* = PagSeguro/Ecommerce (geralmente compras em vendedores individuais)
- PAG* = PagSeguro transferências
- PAYPAL*FACEBOOKSER = Marketing Digital (Facebook Ads)
- PAYPAL*PAYPAL*FA = Marketing Digital (Facebook Ads)
- DL*ALIEXPRESS = Fornecedores (AliExpress)
- FACEBK*, FB* = Marketing Digital
- APPLE.COM/BILL = Geralmente pessoal (Apple Store, iCloud, etc)
- GOL, LATAM, AZUL = Passagens aéreas pessoais

CATEGORIAS EMPRESARIAIS (incluir: true):
- Marketing Digital: Facebook Ads, Google Ads, Meta Ads, campanhas pagas
- Pagamento Fornecedores: AliExpress, Alibaba, fornecedores de produtos
- Taxas Checkout: Yampi, CartPanda, Shopify, NuvemShop, plataformas de venda
- Compra de Câmbio: Wise, TransferWise, Remessa Online, conversão de moeda
- IA e Automação: OpenAI, ChatGPT, Claude, ferramentas de automação
- Design/Ferramentas: Canva, Adobe, Figma, ferramentas de design
- Telefonia: BrDID, VOIP, Twilio, telefonia empresarial
- ERP: Tiny, Bling, sistemas de gestão
- Gestão: Trello, Notion, Asana, ferramentas de produtividade empresarial
- Outros PJ: Outros gastos claramente empresariais

CATEGORIAS PESSOAIS (incluir: false):
- Pessoal: Compras pessoais, restaurantes, entretenimento, streaming, jogos, PASSAGENS AÉREAS, HOSPEDAGENS
- Tarifas Cartão: Anuidades, seguros, taxas bancárias
- Entretenimento: Netflix, Spotify, Disney+, jogos, lazer
- Transporte Pessoal: Uber, 99, taxi para uso pessoal
- Compras Pessoais: Roupas, eletrônicos pessoais, presentes
- Outros: Na dúvida, categorize como pessoal

REGRA DE OURO: Na dúvida entre empresarial e pessoal, SEMPRE opte por PESSOAL (incluir: false) para evitar problemas fiscais.
IMPORTANTE: Passagens aéreas e hospedagens são SEMPRE pessoais, a menos que seja claramente viagem a trabalho comprovada.

TRANSAÇÕES PARA ANALISAR:
${duvidosos.map((d, i) => `${i + 1}. "${d.descricao}" - R$ ${d.valor}`).join('\n')}

IMPORTANTE: Retorne APENAS um JSON válido, sem explicações:
{"resultados":[{"categoria":"NomeDaCategoria","incluir":true},...]}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Erro API Claude:', response.status, errorText);
    throw new Error(`Erro na API Claude: ${response.status}`);
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
