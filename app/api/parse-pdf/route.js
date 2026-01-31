import { NextResponse } from 'next/server';

// Esta API extrai texto de PDFs de faturas (ex: Mercado Pago)
// Usa pdf2json para extrair e Claude AI para decodificar o texto com encoding estranho

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
      
      console.log('Texto bruto extraído:', rawText.substring(0, 500));
      
    } catch (pdfError) {
      console.error('Erro ao parsear PDF:', pdfError);
      return NextResponse.json({ 
        error: 'Erro ao processar PDF',
        details: pdfError.message 
      }, { status: 500 });
    }
    
    // Usar Claude AI para decodificar e extrair transações
    // O PDF do Mercado Pago usa fonte customizada com encoding estranho
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ 
        error: 'API Key do Claude não configurada',
        details: 'Configure ANTHROPIC_API_KEY nas variáveis de ambiente'
      }, { status: 500 });
    }
    
    try {
      const prompt = `Você é um especialista em extrair dados de faturas de cartão de crédito.

O texto abaixo foi extraído de um PDF de fatura do Mercado Pago. O PDF usa uma fonte com encoding estranho onde caracteres são substituídos. Por exemplo:
- "$4" significa "R$"
- "J" às vezes significa "."
- "PóKPóL B5óíEZOOGSE$" significa "PAYPAL *FACEBOOKSER"
- "óPPLEJíOz/ZFLL" significa "APPLE.COM/BILL"
- "alie.press" significa "aliexpress"

Extraia APENAS as transações de compra (não inclua pagamentos de fatura, tarifas ou totais).
Cada transação deve ter: DATA (DD/MM) e DESCRIÇÃO e VALOR.

Responda APENAS com JSON no formato:
{"transacoes":[{"data":"DD/MM","descricao":"NOME DO ESTABELECIMENTO","valor":123.45}]}

TEXTO DO PDF:
${rawText.substring(0, 8000)}`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!response.ok) {
        throw new Error('Erro na API Claude');
      }

      const data = await response.json();
      const text = data.content?.[0]?.text || '';
      
      console.log('Resposta Claude:', text.substring(0, 500));
      
      // Extrair JSON da resposta
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        const transacoes = result.transacoes || [];
        
        // Formatar para o parser do frontend
        const lines = transacoes.map(t => 
          `${t.data} ${t.descricao} R$ ${t.valor.toFixed(2).replace('.', ',')}`
        );
        
        console.log(`PDF processado: ${lines.length} transações extraídas via IA`);
        
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
    
  } catch (error) {
    console.error('Erro ao processar PDF:', error);
    return NextResponse.json({ 
      error: 'Erro ao processar PDF',
      details: error.message 
    }, { status: 500 });
  }
}
