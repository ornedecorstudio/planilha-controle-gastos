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
        
        pdfParser.on('pdfParser_dataError', (errData) => {
          reject(new Error(errData.parserError));
        });
        
        pdfParser.on('pdfParser_dataReady', (pdfData) => {
          try {
            let text = '';
            if (pdfData && pdfData.Pages) {
              pdfData.Pages.forEach((page) => {
                if (page.Texts) {
                  page.Texts.forEach((textItem) => {
                    if (textItem.R) {
                      textItem.R.forEach((r) => {
                        if (r.T) {
                          text += decodeURIComponent(r.T) + ' ';
                        }
                      });
                    }
                  });
                  text += '\n';
                }
              });
            }
            resolve(text);
          } catch (parseError) {
            reject(parseError);
          }
        });
        
        pdfParser.parseBuffer(buffer);
      });
    } catch (pdfError) {
      console.error('Erro ao parsear PDF:', pdfError);
      return NextResponse.json({ 
        error: 'Erro ao ler PDF: ' + pdfError.message 
      }, { status: 500 });
    }

    // Detectar tipo de PDF
    const fileName = file.name?.toLowerCase() || '';
    const isMercadoPago = fileName.includes('mercado') || 
                          fileName.includes('mp') || 
                          rawText.includes('Mercado Pago') ||
                          rawText.includes('MERCADOPAGO') ||
                          rawText.includes('$4') || // Encoding corrompido comum
                          rawText.includes('POKPOL'); // PayPal com encoding errado

    const isRenner = fileName.includes('renner') || 
                     rawText.includes('Renner') ||
                     rawText.includes('RENNER') ||
                     rawText.includes('Lojas Renner');

    let transacoes = [];
    let method = 'regex';

    if (isRenner) {
      // Renner: usar regex (formato limpo)
      transacoes = processarRenner(rawText);
    } else if (isMercadoPago) {
      // Mercado Pago: usar IA (encoding corrompido)
      // Verificar se ANTHROPIC_API_KEY existe
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error('ANTHROPIC_API_KEY nao configurada');
        return NextResponse.json({ 
          error: 'Configuracao de IA ausente. Verifique ANTHROPIC_API_KEY no Vercel.' 
        }, { status: 500 });
      }
      
      try {
        transacoes = await processarComIA(rawText);
        method = 'ia';
      } catch (iaError) {
        console.error('Erro ao processar com IA:', iaError);
        return NextResponse.json({ 
          error: 'Erro ao processar com IA: ' + iaError.message 
        }, { status: 500 });
      }
    } else {
      // Tentar extrator generico
      transacoes = processarGenerico(rawText);
    }

    return NextResponse.json({
      success: true,
      transacoes,
      totalTransacoes: transacoes.length,
      method,
      rawTextLength: rawText.length,
      tipoDetectado: isRenner ? 'Renner' : isMercadoPago ? 'Mercado Pago' : 'Generico'
    });

  } catch (error) {
    console.error('Erro geral no parse-pdf:', error);
    return NextResponse.json({ 
      error: 'Erro ao processar PDF: ' + error.message 
    }, { status: 500 });
  }
}

// Processador para Renner (regex)
function processarRenner(text) {
  const transacoes = [];
  const lines = text.split('\n');
  
  // Padrao Renner: "dd/mm/yyyy DESCRICAO VALOR"
  const regex = /(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
  
  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      const [, data, descricao, valorStr] = match;
      const valor = parseFloat(valorStr.replace(/\./g, '').replace(',', '.'));
      
      // Filtrar taxas do cartao
      const descUpper = descricao.toUpperCase();
      if (descUpper.includes('ANUIDADE') || 
          descUpper.includes('FATURA SEGURA') ||
          descUpper.includes('AVAL EMERG')) {
        continue;
      }
      
      transacoes.push({
        data: formatarData(data),
        descricao: descricao.trim(),
        valor
      });
    }
  }
  
  return transacoes;
}

// Processador para Mercado Pago (IA)
async function processarComIA(rawText) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY nao configurada');
  }

  const prompt = `Voce e um especialista em extrair dados de faturas de cartao de credito brasileiras.

O texto abaixo foi extraido de um PDF do Mercado Pago e pode ter encoding corrompido. Exemplos de corrupcao:
- "$4" pode significar "R$"
- "POKPOL" pode ser "PAYPAL"
- Caracteres estranhos no lugar de acentos

Extraia TODAS as transacoes encontradas no formato JSON array:
[
  {
    "data": "YYYY-MM-DD",
    "descricao": "NOME DO ESTABELECIMENTO",
    "valor": 123.45
  }
]

REGRAS:
1. Datas no formato YYYY-MM-DD
2. Valores como numero decimal (sem R$)
3. Descricao limpa (corrigir encoding)
4. Ignorar taxas de cartao (anuidade, seguro, IOF de servicos)
5. Se nao encontrar transacoes, retorne []

Texto do PDF:
${rawText.substring(0, 15000)}

Retorne APENAS o JSON array, sem markdown, sem explicacoes.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Erro da API Anthropic:', response.status, errorText);
    throw new Error(`API Anthropic retornou ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  
  if (!data.content || !data.content[0] || !data.content[0].text) {
    throw new Error('Resposta invalida da API');
  }

  const responseText = data.content[0].text.trim();
  
  // Tentar parsear JSON
  try {
    // Remover possivel markdown
    let jsonText = responseText;
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json?\n?/g, '').replace(/```$/g, '');
    }
    
    const transacoes = JSON.parse(jsonText);
    
    if (!Array.isArray(transacoes)) {
      throw new Error('Resposta nao e um array');
    }
    
    return transacoes.map(t => ({
      data: t.data,
      descricao: t.descricao,
      valor: typeof t.valor === 'number' ? t.valor : parseFloat(t.valor) || 0
    }));
    
  } catch (parseError) {
    console.error('Erro ao parsear resposta da IA:', parseError);
    console.error('Resposta recebida:', responseText);
    throw new Error('Falha ao interpretar resposta da IA');
  }
}

// Processador generico (fallback)
function processarGenerico(text) {
  const transacoes = [];
  const lines = text.split('\n');
  
  // Tentar varios padroes comuns
  const patterns = [
    // dd/mm/yyyy DESCRICAO R$ 123,45
    /(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/,
    // dd/mm DESCRICAO 123,45
    /(\d{2}\/\d{2})\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/,
    // DESCRICAO dd/mm/yyyy 123,45
    /(.+?)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{1,3}(?:\.\d{3})*,\d{2})/
  ];
  
  for (const line of lines) {
    for (const regex of patterns) {
      const match = line.match(regex);
      if (match) {
        let data, descricao, valorStr;
        
        // Ajustar baseado no padrao
        if (match[1].match(/^\d{2}\/\d{2}/)) {
          data = match[1];
          descricao = match[2];
          valorStr = match[3];
        } else {
          descricao = match[1];
          data = match[2];
          valorStr = match[3];
        }
        
        const valor = parseFloat(valorStr.replace(/\./g, '').replace(',', '.'));
        
        if (valor > 0) {
          transacoes.push({
            data: formatarData(data),
            descricao: descricao.trim(),
            valor
          });
        }
        break;
      }
    }
  }
  
  return transacoes;
}

// Converter data para YYYY-MM-DD
function formatarData(dataStr) {
  const parts = dataStr.split('/');
  if (parts.length === 3) {
    const [dia, mes, ano] = parts;
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  } else if (parts.length === 2) {
    const [dia, mes] = parts;
    const ano = new Date().getFullYear();
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }
  return dataStr;
}
