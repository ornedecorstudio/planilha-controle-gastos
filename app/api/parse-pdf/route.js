import { NextResponse } from 'next/server';

// Esta API extrai texto de PDFs de faturas (Mercado Pago, Renner, etc.)
// Detecta automaticamente o tipo de PDF e usa a estratégia adequada

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('pdf');
    
    if (!file) {
      return NextResponse.json({ error: 'Nenhum arquivo PDF enviado' }, { status: 400 });
    }
    
    // Verificar se é PDF
    if (!file.type.includes('pdf') && !file.name?.endsWith('.pdf')) {
      return NextResponse.json({ error: 'O arquivo deve ser um PDF' }, { status: 400 });
    }
    
    // Converter para Buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
    // Extrair texto usando pdf2json
    let rawText = '';
    
    try {
      const PDFParser = (await import('pdf2json')).default;
      
      rawText = await new Promise((resolve, reject) => {
        const pdfParser = new PDFParser();
        
        pdfParser.on('pdfParser_dataReady', pdfData => {
          let allText = '';
          
          if (pdfData.Pages) {
            pdfData.Pages.forEach((page) => {
              if (page.Texts) {
                page.Texts.forEach(textItem => {
                  if (textItem.R) {
                    textItem.R.forEach(run => {
                      if (run.T) {
                        try {
                          allText += decodeURIComponent(run.T) + ' ';
                        } catch (e) {
                          allText += run.T + ' ';
                        }
                      }
                    });
                  }
                });
              }
              allText += '\n';
            });
          }
          
          resolve(allText);
        });
        
        pdfParser.on('pdfParser_dataError', err => {
          reject(err);
        });
        
        pdfParser.parseBuffer(buffer);
      });
      
      console.log('Texto bruto extraído (500 chars):', rawText.substring(0, 500));
      
    } catch (pdfError) {
      console.error('Erro ao parsear PDF:', pdfError);
      return NextResponse.json({ 
        error: 'Erro ao processar PDF',
        details: pdfError.message 
      }, { status: 500 });
    }
    
    // Detectar tipo de PDF baseado no conteúdo
    const isRenner = rawText.includes('Realize Crédito') || 
                     rawText.includes('LOJAS RENNER') || 
                     rawText.includes('Meu Cartão') ||
                     rawText.includes('Compra a Vista sem Juros');
    
    const isMercadoPago = rawText.includes('Mercado Pago') || 
                          rawText.includes('$4 ') || // Encoding estranho do MP
                          rawText.includes('PóKPóL') || // PAYPAL com encoding
                          rawText.includes('óPPLE'); // APPLE com encoding
    
    console.log(`Tipo detectado: ${isRenner ? 'RENNER' : isMercadoPago ? 'MERCADO PAGO' : 'DESCONHECIDO'}`);
    
    // ===== PROCESSAMENTO RENNER (texto legível) =====
    if (isRenner) {
      return processarRenner(rawText);
    }
    
    // ===== PROCESSAMENTO MERCADO PAGO (precisa IA) =====
    if (isMercadoPago) {
      return processarMercadoPagoComIA(rawText);
    }
    
    // ===== FALLBACK: tentar extrair com regex genérico, senão usar IA =====
    const transacoesGenericas = extrairTransacoesGenericas(rawText);
    if (transacoesGenericas.length > 0) {
      return NextResponse.json({ 
        text: transacoesGenericas.join('\n'),
        totalLines: transacoesGenericas.length,
        rawTextLength: rawText.length,
        method: 'regex-generico'
      });
    }
    
    // Se não conseguiu extrair, usar IA
    return processarMercadoPagoComIA(rawText);
    
  } catch (error) {
    console.error('Erro ao processar PDF:', error);
    return NextResponse.json({ 
      error: 'Erro ao processar PDF',
      details: error.message 
    }, { status: 500 });
  }
}

// ===== PROCESSADOR RENNER =====
function processarRenner(rawText) {
  const transacoes = [];
  
  // Normalizar espaços problemáticos (ex: "109, 11" -> "109,11")
  let textoNormalizado = rawText.replace(/(\d),\s+(\d)/g, '$1,$2');
  
  // Padrão Renner: DD/MM/YYYY + "Compra a Vista sem Juros Visa" + valor + estabelecimento
  // Exemplos:
  // "03/01/2026 Compra a Vista sem Juros Visa 506,90 FACEBK RCM5Z9RHW2"
  // "06/01/2026 Compra a Vista sem Juros Visa 1.770,16 FACEBK BQZ7JAMHW2"
  
  // Regex para capturar transações de compra
  const regexCompra = /(\d{2}\/\d{2}\/\d{4})\s+Compra a\s*Vista sem Juros Visa\s+([\d.,]+)\s+([A-Z0-9\s*]+?)(?=\s+\d{2}\/\d{2}\/\d{4}|\s+Fatura Segura|\s+ANUIDADE|\s+AVAL|\s+Compras parceladas|\s*$)/gi;
  
  let match;
  while ((match = regexCompra.exec(textoNormalizado)) !== null) {
    const data = match[1];
    let valorStr = match[2];
    let estabelecimento = match[3].trim();
    
    // Limpar valor
    valorStr = valorStr.replace(/\./g, '').replace(',', '.');
    const valor = parseFloat(valorStr);
    
    // Limpar estabelecimento (remover números soltos no início que são restos de valores)
    estabelecimento = estabelecimento.replace(/^\d+\s+/, '').trim();
    
    if (valor > 0 && estabelecimento.length > 0) {
      // Formatar para o frontend: DD/MM/YYYY ESTABELECIMENTO R$ VALOR
      transacoes.push(`${data} ${estabelecimento} R$ ${valor.toFixed(2).replace('.', ',')}`);
    }
  }
  
  console.log(`RENNER: ${transacoes.length} transações extraídas`);
  console.log('Primeiras 5:', transacoes.slice(0, 5));
  
  return NextResponse.json({ 
    text: transacoes.join('\n'),
    totalLines: transacoes.length,
    rawTextLength: rawText.length,
    method: 'regex-renner'
  });
}

// ===== PROCESSADOR MERCADO PAGO (com IA) =====
async function processarMercadoPagoComIA(rawText) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ 
      error: 'API Key do Claude não configurada',
      details: 'Configure ANTHROPIC_API_KEY nas variáveis de ambiente'
    }, { status: 500 });
  }
  
  try {
    const prompt = `Você é um especialista em extrair dados de faturas de cartão de crédito.

O texto abaixo foi extraído de um PDF de fatura. O PDF pode usar uma fonte com encoding estranho onde caracteres são substituídos. Por exemplo:
- "$4" significa "R$"
- "J" às vezes significa "."
- "PóKPóL B5óíEZOOGSE$" significa "PAYPAL *FACEBOOKSER"
- "óPPLEJíOz/ZFLL" significa "APPLE.COM/BILL"
- "alie.press" significa "aliexpress"

Extraia APENAS as transações de compra (não inclua pagamentos de fatura, tarifas, anuidades, seguros ou totais).
Cada transação deve ter: DATA (DD/MM) e DESCRIÇÃO e VALOR.

IMPORTANTE: 
- Ignore valores negativos (são pagamentos)
- Ignore "Pagamento Fatura", "Tarifa", "Fatura Segura", "Anuidade", "Aval Emerg", etc.
- Foque em compras reais (FACEBK, PAYPAL, ALIEXPRESS, etc.)

Responda APENAS com JSON no formato:
{"transacoes":[{"data":"DD/MM","descricao":"NOME DO ESTABELECIMENTO","valor":123.45}]}

TEXTO DO PDF:
${rawText.substring(0, 10000)}`;

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
      throw new Error('Erro na API Claude');
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    
    console.log('Resposta Claude (500 chars):', text.substring(0, 500));
    
    // Extrair JSON da resposta
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      const transacoes = result.transacoes || [];
      
      // Formatar para o parser do frontend
      const lines = transacoes.map(t => 
        `${t.data} ${t.descricao} R$ ${typeof t.valor === 'number' ? t.valor.toFixed(2).replace('.', ',') : t.valor}`
      );
      
      console.log(`MERCADO PAGO (IA): ${lines.length} transações extraídas`);
      
      return NextResponse.json({ 
        text: lines.join('\n'),
        totalLines: lines.length,
        rawTextLength: rawText.length,
        method: 'claude-ai'
      });
    }
    
    return NextResponse.json({ 
      error: 'Não foi possível extrair transações do PDF',
      details: 'Claude não retornou JSON válido'
    }, { status: 500 });
    
  } catch (aiError) {
    console.error('Erro na IA:', aiError);
    return NextResponse.json({ 
      error: 'Erro ao processar com IA',
      details: aiError.message 
    }, { status: 500 });
  }
}

// ===== EXTRATOR GENÉRICO =====
function extrairTransacoesGenericas(rawText) {
  const transacoes = [];
  
  // Tentar encontrar padrões de transação genéricos
  // DD/MM/YYYY + texto + valor
  const regex = /(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?[\d.,]+)\s*$/gm;
  let match;
  
  while ((match = regex.exec(rawText)) !== null) {
    const [, data, desc, valor] = match;
    const valorNum = parseFloat(valor.replace(/\./g, '').replace(',', '.'));
    
    if (valorNum > 0 && desc.length > 2) {
      transacoes.push(`${data} ${desc.trim()} R$ ${valor}`);
    }
  }
  
  return transacoes;
}
