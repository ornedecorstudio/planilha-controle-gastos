import { NextResponse } from 'next/server';

// Esta API extrai texto de PDFs de faturas (Mercado Pago, Renner, etc.)
// Detecta automaticamente o tipo de PDF e usa a estrategia adequada

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('pdf');
    
    if (!file) {
      return NextResponse.json({ error: 'Nenhum arquivo PDF enviado' }, { status: 400 });
    }
    
    // Verificar se e PDF
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
      
      console.log('Texto bruto extraido (500 chars):', rawText.substring(0, 500));
      
    } catch (pdfError) {
      console.error('Erro ao parsear PDF:', pdfError);
      return NextResponse.json({ 
        error: 'Erro ao processar PDF',
        details: pdfError.message 
      }, { status: 500 });
    }
    
    // Detectar tipo de PDF baseado no conteudo
    const isRenner = rawText.includes('Realize Credito') || 
                     rawText.includes('LOJAS RENNER') || 
                     rawText.includes('Meu Cartao') ||
                     rawText.includes('Compra a Vista sem Juros');
    
    const isMercadoPago = rawText.includes('Mercado Pago') || 
                          rawText.includes('$4 ') ||
                          rawText.includes('POKPOL') ||
                          rawText.includes('OPPLE');
    
    console.log(`Tipo detectado: ${isRenner ? 'RENNER' : isMercadoPago ? 'MERCADO PAGO' : 'DESCONHECIDO'}`);
    
    // ===== PROCESSAMENTO RENNER (texto legivel) =====
    if (isRenner) {
      return processarRenner(rawText);
    }
    
    // ===== PROCESSAMENTO MERCADO PAGO (precisa IA) =====
    if (isMercadoPago) {
      return processarMercadoPagoComIA(rawText);
    }
    
    // ===== FALLBACK: tentar extrair com regex generico, senao usar IA =====
    const transacoesGenericas = extrairTransacoesGenericas(rawText);
    if (transacoesGenericas.length > 0) {
      return NextResponse.json({ 
        text: transacoesGenericas.join('\n'),
        totalLines: transacoesGenericas.length,
        rawTextLength: rawText.length,
        method: 'regex-generico'
      });
    }
    
    // Se nao conseguiu extrair, usar IA
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
  
  let textoNormalizado = rawText.replace(/(\d),\s+(\d)/g, '$1,$2');
  
  const regexCompra = /(\d{2}\/\d{2}\/\d{4})\s+Compra a\s*Vista sem Juros Visa\s+([\d.,]+)\s+([A-Z0-9\s*]+?)(?=\s+\d{2}\/\d{2}\/\d{4}|\s+Fatura Segura|\s+ANUIDADE|\s+AVAL|\s+Compras parceladas|\s*$)/gi;
  
  let match;
  while ((match = regexCompra.exec(textoNormalizado)) !== null) {
    const data = match[1];
    let valorStr = match[2];
    let estabelecimento = match[3].trim();
    
    valorStr = valorStr.replace(/\./g, '').replace(',', '.');
    const valor = parseFloat(valorStr);
    
    estabelecimento = estabelecimento.replace(/^\d+\s+/, '').trim();
    
    if (valor > 0 && estabelecimento.length > 0) {
      transacoes.push(`${data} ${estabelecimento} R$ ${valor.toFixed(2).replace('.', ',')}`);
    }
  }
  
  console.log(`RENNER: ${transacoes.length} transacoes extraidas`);
  
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
      error: 'API Key do Claude nao configurada',
      details: 'Configure ANTHROPIC_API_KEY nas variaveis de ambiente'
    }, { status: 500 });
  }
  
  try {
    const prompt = `Voce e um especialista em extrair dados de faturas de cartao de credito.

O texto abaixo foi extraido de um PDF de fatura. O PDF pode usar uma fonte com encoding estranho onde caracteres sao substituidos. Por exemplo:
- "$4" significa "R$"
- "J" as vezes significa "."
- "POKPOL B5OIEZOOGSE$" significa "PAYPAL *FACEBOOKSER"
- "OPPLEJIO/ZFLL" significa "APPLE.COM/BILL"
- "alie.press" significa "aliexpress"

Extraia APENAS as transacoes de compra (nao inclua pagamentos de fatura, tarifas, anuidades, seguros ou totais).
Cada transacao deve ter: DATA (DD/MM) e DESCRICAO e VALOR.

IMPORTANTE: 
- Ignore valores negativos (sao pagamentos)
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
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Erro API Claude:', response.status, errorData);
      throw new Error(`Erro na API Claude: ${response.status}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    
    console.log('Resposta Claude (500 chars):', text.substring(0, 500));
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      const transacoes = result.transacoes || [];
      
      const lines = transacoes.map(t => 
        `${t.data} ${t.descricao} R$ ${typeof t.valor === 'number' ? t.valor.toFixed(2).replace('.', ',') : t.valor}`
      );
      
      console.log(`MERCADO PAGO (IA): ${lines.length} transacoes extraidas`);
      
      return NextResponse.json({ 
        text: lines.join('\n'),
        totalLines: lines.length,
        rawTextLength: rawText.length,
        method: 'claude-ai'
      });
    }
    
    return NextResponse.json({ 
      error: 'Nao foi possivel extrair transacoes do PDF',
      details: 'Claude nao retornou JSON valido'
    }, { status: 500 });
    
  } catch (aiError) {
    console.error('Erro na IA:', aiError);
    return NextResponse.json({ 
      error: 'Erro ao processar com IA',
      details: aiError.message 
    }, { status: 500 });
  }
}

// ===== EXTRATOR GENERICO =====
function extrairTransacoesGenericas(rawText) {
  const transacoes = [];
  
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
