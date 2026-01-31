import { NextResponse } from 'next/server';

// Esta API extrai texto de PDFs de faturas (ex: Mercado Pago)
// Usa uma abordagem simples de extração de texto

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('pdf');
    
    if (!file) {
      return NextResponse.json({ error: 'Nenhum arquivo PDF enviado' }, { status: 400 });
    }
    
    // Verificar se é PDF
    if (!file.type.includes('pdf')) {
      return NextResponse.json({ error: 'O arquivo deve ser um PDF' }, { status: 400 });
    }
    
    // Converter para ArrayBuffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
    // Usar pdf-parse para extrair texto
    let text = '';
    
    try {
      // Importação dinâmica do pdf-parse
      const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
      const data = await pdfParse(buffer);
      text = data.text || '';
    } catch (pdfError) {
      console.error('Erro ao parsear PDF:', pdfError);
      
      // Fallback: tentar extrair texto manualmente do buffer
      // Isso funciona para alguns PDFs simples
      const textDecoder = new TextDecoder('utf-8', { fatal: false });
      const rawText = textDecoder.decode(buffer);
      
      // Procurar por padrões de texto no PDF
      const textMatches = rawText.match(/\(([^)]+)\)/g);
      if (textMatches) {
        text = textMatches.map(m => m.slice(1, -1)).join(' ');
      }
    }
    
    // Processar o texto extraído para o formato esperado
    // Formato Mercado Pago: "17/12 PAYPAL *FACEBOOKSER R$ 2.537,17"
    const lines = text.split('\n').filter(line => line.trim());
    
    // Filtrar apenas linhas que parecem transações
    // Padrão: começa com DD/MM e tem valor R$
    const transactionLines = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Ignorar linhas de resumo, totais, cabeçalhos
      if (trimmed.toLowerCase().includes('total')) continue;
      if (trimmed.toLowerCase().includes('resumo')) continue;
      if (trimmed.toLowerCase().includes('vencimento')) continue;
      if (trimmed.toLowerCase().includes('pagamento da fatura')) continue;
      if (trimmed.toLowerCase().includes('tarifa de uso')) continue;
      if (trimmed.toLowerCase().includes('parcela') && trimmed.toLowerCase().includes('de')) continue;
      
      // Verificar se é uma linha de transação válida
      // Formato: DD/MM DESCRIÇÃO R$ VALOR ou DD/MM DESCRIÇÃO $4 VALOR
      const transactionMatch = trimmed.match(/^(\d{2}\/\d{2})\s+(.+?)\s+(?:R\$|\$4)\s*([\d.,J]+)$/i);
      
      if (transactionMatch) {
        const [, data, descricao, valor] = transactionMatch;
        // Limpar valor (substituir J por . para OCR ruim)
        const valorLimpo = valor.replace(/J/g, '.').replace(/,/g, '.');
        transactionLines.push(`${data} ${descricao.trim()} R$ ${valorLimpo}`);
      } else {
        // Tentar outro padrão: DD/MM DESCRIÇÃO VALOR (sem R$)
        const simpleMatch = trimmed.match(/^(\d{2}\/\d{2})\s+([A-Za-z*\s]+?)\s+([\d.,]+)$/i);
        if (simpleMatch) {
          const [, data, descricao, valor] = simpleMatch;
          transactionLines.push(`${data} ${descricao.trim()} R$ ${valor}`);
        }
      }
    }
    
    console.log(`PDF processado: ${transactionLines.length} transações encontradas`);
    console.log('Primeiras 5 linhas:', transactionLines.slice(0, 5));
    
    // Retornar o texto processado
    return NextResponse.json({ 
      text: transactionLines.join('\n'),
      totalLines: transactionLines.length,
      rawTextLength: text.length
    });
    
  } catch (error) {
    console.error('Erro ao processar PDF:', error);
    return NextResponse.json({ 
      error: 'Erro ao processar PDF',
      details: error.message 
    }, { status: 500 });
  }
}
