import { NextResponse } from 'next/server';

// ============================================================
// CATEGORIZACAO DETERMINISTICA (100% CONFIAVEL)
// ============================================================

function categorizarDeterministico(descricao) {
  const desc = descricao.toUpperCase().trim();

  // ===== REGRA: Compra de Cambio via PayPal (ANTES das regras de Marketing) =====
  // PAYPAL*PAYPAL *FA = Compra de cambio para pagamentos internacionais
  if (desc.match(/PAYPAL\*PAYPAL\s*\*FA/)) {
    return { categoria: 'Compra de Cambio', incluir: true, confianca: 'alta' };
  }

  // ===== REGRA ABSOLUTA 1: FACEBK = Marketing Digital =====
  if (desc.includes('FACEBK') || desc.includes('FACEBOOK') || desc.startsWith('FB ') || desc.includes('META ADS')) {
    return { categoria: 'Marketing Digital', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('PAYPAL') && (desc.includes('FACEBOOK') || desc.includes('FACEB'))) {
    return { categoria: 'Marketing Digital', incluir: true, confianca: 'alta' };
  }
  // Removida regra PAYPAL + FA que era muito generica e causava falsos positivos
  
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
  
  // ===== REGRA: IOF e taxas bancarias = Outros (INCLUIR como gasto empresarial) =====
  if (desc.includes('IOF') || desc.includes('IMPOSTO OPERACOES FINANCEIRAS')) {
    return { categoria: 'Outros', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('PAGAMENTO RECEBIDO') || desc.includes('INCLUSAO DE PAGAMENTO')) {
    return { categoria: 'Outros', incluir: false, confianca: 'alta' };
  }
  
  // ===== REGRA: Tarifas e seguros de cartao = EXCLUIR =====
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
    return { categoria: 'Compra de Cambio', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('OPENAI') || desc.includes('CHATGPT') || desc.includes('CLAUDE') || desc.includes('ANTHROPIC')) {
    return { categoria: 'IA e Automacao', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('ADOBE') || desc.includes('FIGMA') || desc.includes('SKETCH') || desc.includes('FREEPIK') || desc.includes('MAGNIFIC')) {
    return { categoria: 'Design/Ferramentas', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('BRDID') || desc.includes('VOIP') || desc.includes('TWILIO')) {
    return { categoria: 'Telefonia', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('TRELLO') || desc.includes('ATLASSIAN') || desc.includes('NOTION') || desc.includes('ASANA') || desc.includes('MONDAY')) {
    return { categoria: 'Gestao', incluir: true, confianca: 'alta' };
  }
  if (desc.includes('SHOPIFY') || desc.includes('NUVEMSHOP')) {
    return { categoria: 'Taxas Checkout', incluir: true, confianca: 'alta' };
  }
  
  // ===== REGRA ABSOLUTA 7: Gastos pessoais conhecidos = EXCLUIR =====
  const gastosExcluir = [
    'SUSHI', 'BURGER', 'PIZZA', 'MCDONALDS', 'MCDONALD', 'SUBWAY', 'HABIB', 'OUTBACK', 
    'RESTAURANTE', 'LANCHONETE', 'PADARIA', 'CAFETERIA', 'STARBUCKS', 'IFOOD',
    'HOTEIS.COM', 'HOTEIS', 'BOOKING', 'AIRBNB', 'DECOLAR', 'TRIVAGO', 'EXPEDIA',
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
  
  // ===== REGRA 8: Nomes de pessoas (transferencias) = EXCLUIR =====
  if (/^[A-Z]+ [A-Z]+ ?[A-Z]?$/.test(desc) || desc.includes('NORMA') || desc.includes('PIX ')) {
    return { categoria: 'Pessoal', incluir: false, confianca: 'media' };
  }

  // ===== REGRA 9: Transferencias Mercado Pago (MP*) = PESSOAL =====
  // Padroes comuns: MP*DIRETOSIM, MP*NOMEVENDEDOR, MP*MELIMAIS
  // Geralmente sao transferencias pessoais ou compras no Mercado Livre
  if (desc.startsWith('MP*') || desc.startsWith('MP *')) {
    // Verifica se nao e um estabelecimento comercial conhecido
    if (!desc.includes('TINY') && !desc.includes('YAMPI') && !desc.includes('CANVA')) {
      return { categoria: 'Pessoal', incluir: false, confianca: 'media' };
    }
  }

  // ===== REGRA 10: Pagamentos PagSeguro/Ecommerce (EC*) = PESSOAL =====
  // Padroes: EC *GUSTAMMUNIZ, EC *NOMEVENDEDOR
  // Geralmente sao compras pessoais em vendedores individuais
  if (desc.startsWith('EC *') || desc.startsWith('EC*')) {
    return { categoria: 'Pessoal', incluir: false, confianca: 'media' };
  }

  // ===== REGRA 11: Pagamentos via Pix/transferencias = PESSOAL =====
  // PAG* = PagSeguro transferencias
  if (desc.startsWith('PAG*') && !desc.includes('PAGSEGURO')) {
    return { categoria: 'Pessoal', incluir: false, confianca: 'media' };
  }

  // ===== CASO NAO IDENTIFICADO = Duvida =====
  return { categoria: null, incluir: null, confianca: 'baixa' };
}

export async function POST(request) {
  try {
    const { transacoes } = await request.json();
    
    if (!transacoes || transacoes.length === 0) {
      return NextResponse.json({ error: 'Nenhuma transacao fornecida' }, { status: 400 });
    }

    // ===== PASSO 1: Categorizacao deterministica =====
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
    
    // ===== PASSO 2: Se ha casos duvidosos, usar IA =====
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
    return NextResponse.json({ error: 'Erro ao processar categorizacao' }, { status: 500 });
  }
}

// ===== Funcao para chamar a IA apenas para casos duvidosos =====
// Usando Opus 4.5 para melhor precisao na categorizacao
async function categorizarComIA(duvidosos) {
  const prompt = `Voce e um especialista em contabilidade para e-commerce brasileiro. Analise estas ${duvidosos.length} transacoes e categorize cada uma com precisao.

CONTEXTO DO NEGOCIO:
- Empresa: ORNE (e-commerce de iluminacao)
- Objetivo: Separar gastos empresariais (PJ) de gastos pessoais (PF) para contabilidade

PADROES COMUNS EM FATURAS BRASILEIRAS:
- MP* = Mercado Pago (geralmente compras pessoais ou transferencias)
- EC* = PagSeguro/Ecommerce (geralmente compras em vendedores individuais)
- PAG* = PagSeguro transferencias
- PAYPAL*FACEBOOKSER = Marketing Digital (Facebook Ads)
- PAYPAL*PAYPAL*FA = Compra de cambio para pagamentos internacionais
- DL*ALIEXPRESS = Fornecedores (AliExpress)
- FACEBK*, FB* = Marketing Digital
- APPLE.COM/BILL = Geralmente pessoal (Apple Store, iCloud, etc)

CATEGORIAS EMPRESARIAIS (incluir: true):
- Marketing Digital: Facebook Ads, Google Ads, Meta Ads, campanhas pagas
- Pagamento Fornecedores: AliExpress, Alibaba, fornecedores de produtos
- Taxas Checkout: Yampi, CartPanda, Shopify, NuvemShop, plataformas de venda
- Compra de Cambio: Wise, TransferWise, Remessa Online, conversao de moeda
- IA e Automacao: OpenAI, ChatGPT, Claude, ferramentas de automacao
- Design/Ferramentas: Canva, Adobe, Figma, ferramentas de design
- Telefonia: BrDID, VOIP, Twilio, telefonia empresarial
- ERP: Tiny, Bling, sistemas de gestao
- Gestao: Trello, Notion, Asana, ferramentas de produtividade empresarial
- Viagem Trabalho: Passagens e hospedagens para trabalho
- Outros PJ: Outros gastos claramente empresariais

CATEGORIAS PESSOAIS (incluir: false):
- Pessoal: Compras pessoais, restaurantes, entretenimento, streaming, jogos
- Tarifas Cartao: Anuidades, seguros, taxas bancarias
- Entretenimento: Netflix, Spotify, Disney+, jogos, lazer
- Transporte Pessoal: Uber, 99, taxi para uso pessoal
- Compras Pessoais: Roupas, eletronicos pessoais, presentes
- Outros: Na duvida, categorize como pessoal

REGRA DE OURO: Na duvida entre empresarial e pessoal, sempre opte por PESSOAL (incluir: false) para evitar problemas fiscais.

TRANSACOES PARA ANALISAR:
${duvidosos.map((d, i) => `${i + 1}. "${d.descricao}" - R$ ${d.valor}`).join('\n')}

IMPORTANTE: Retorne APENAS um JSON valido, sem explicacoes:
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
