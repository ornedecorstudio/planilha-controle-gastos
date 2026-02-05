/**
 * Parser Genérico de Faturas
 * 
 * Fallback para bancos não identificados.
 * Tenta múltiplos padrões comuns em faturas brasileiras.
 */

import { parseValorBR, parseDataBR, extrairParcela } from './index.js';

export function parseGeneric(texto) {
  const transacoes = [];
  
  // Detectar ano da fatura
  let anoReferencia = new Date().getFullYear();
  const matchAno = texto.match(/(?:FATURA|VENCIMENTO|FECHAMENTO|ANO).*?(\d{4})/i);
  if (matchAno) {
    anoReferencia = parseInt(matchAno[1]);
  }
  
  // Set para evitar duplicatas
  const transacoesUnicas = new Set();
  
  // Termos a ignorar (comuns em todas as faturas)
  const ignorar = [
    'PAGAMENTO FATURA',
    'PAGAMENTO RECEBIDO',
    'PAGAMENTO EFETUADO',
    'ANUIDADE',
    'TARIFA',
    'ENCARGO',
    'JUROS',
    'MULTA',
    'SALDO ANTERIOR',
    'CREDITO',
    'ESTORNO',
    'TOTAL DA FATURA',
    'VALOR TOTAL',
    'FATURA SEGURA',
    'SEGURO FATURA',
    'AVAL EMERG',
    'LIMITE DISPONIVEL',
    'LIMITE TOTAL'
  ];
  
  // Padrão 1: Formato mais comum - DATA | DESCRIÇÃO | VALOR
  const regexPadrao1 = /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.{3,60}?)\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  let match;
  
  while ((match = regexPadrao1.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valor = parseValorBR(match[3]);
    const parcela = extrairParcela(descricao);
    
    const descUpper = descricao.toUpperCase();
    const deveIgnorar = ignorar.some(termo => descUpper.includes(termo));
    if (deveIgnorar) continue;
    
    // Ignora se descrição muito curta ou muito longa
    if (descricao.length < 3 || descricao.length > 80) continue;
    
    // Ignora se parece ser cabeçalho
    if (descUpper.includes('DATA') && descUpper.includes('DESCRI')) continue;
    
    if (data && descricao && valor > 0) {
      const chave = `${data}|${descricao}|${valor.toFixed(2)}`;
      
      if (!transacoesUnicas.has(chave)) {
        transacoesUnicas.add(chave);
        transacoes.push({ data, descricao, valor, parcela });
      }
    }
  }
  
  // Padrão 2: Formato DD MMM (ex: "15 DEZ")
  const meses = {
    'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04',
    'MAI': '05', 'JUN': '06', 'JUL': '07', 'AGO': '08',
    'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12'
  };
  
  const regexPadrao2 = /(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(.{3,60}?)\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  
  while ((match = regexPadrao2.exec(texto)) !== null) {
    const dia = match[1].padStart(2, '0');
    const mes = meses[match[2].toUpperCase()];
    const data = `${anoReferencia}-${mes}-${dia}`;
    const descricao = match[3].trim();
    const valor = parseValorBR(match[4]);
    const parcela = extrairParcela(descricao);
    
    const descUpper = descricao.toUpperCase();
    const deveIgnorar = ignorar.some(termo => descUpper.includes(termo));
    if (deveIgnorar) continue;
    
    if (data && descricao && valor > 0) {
      const chave = `${data}|${descricao}|${valor.toFixed(2)}`;
      
      if (!transacoesUnicas.has(chave)) {
        transacoesUnicas.add(chave);
        transacoes.push({ data, descricao, valor, parcela });
      }
    }
  }
  
  // Padrão 3: Linhas separadas
  const linhas = texto.split('\n').map(l => l.trim()).filter(l => l);
  
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    
    // Procura linha que começa com data
    const matchData = linha.match(/^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/);
    if (matchData) {
      const data = parseDataBR(matchData[1], anoReferencia);
      let resto = linha.substring(matchData[0].length).trim();
      
      // Procura valor no final
      const matchValor = resto.match(/R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/);
      if (matchValor) {
        const valor = parseValorBR(matchValor[1]);
        const descricao = resto.replace(matchValor[0], '').trim();
        
        const descUpper = descricao.toUpperCase();
        const deveIgnorar = ignorar.some(termo => descUpper.includes(termo));
        if (deveIgnorar) continue;
        
        if (descricao.length < 3) continue;
        
        if (data && descricao && valor > 0) {
          const chave = `${data}|${descricao}|${valor.toFixed(2)}`;
          
          if (!transacoesUnicas.has(chave)) {
            transacoesUnicas.add(chave);
            transacoes.push({ 
              data, 
              descricao, 
              valor, 
              parcela: extrairParcela(descricao)
            });
          }
        }
      }
    }
  }
  
  // Padrão 4: Transações internacionais
  const regexInternacional = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+(?:USD|US\$|EUR|€)\s*[\d.,]+\s+(?:BRL|R\$)\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  
  while ((match = regexInternacional.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valorBRL = parseValorBR(match[3]);
    
    const descUpper = descricao.toUpperCase();
    if (descUpper === 'IOF' || descUpper.startsWith('IOF ')) continue;
    
    const deveIgnorar = ignorar.some(termo => descUpper.includes(termo));
    if (deveIgnorar) continue;
    
    if (data && descricao && valorBRL > 0) {
      const chave = `${data}|${descricao}|${valorBRL.toFixed(2)}`;
      
      if (!transacoesUnicas.has(chave)) {
        transacoesUnicas.add(chave);
        transacoes.push({ 
          data, 
          descricao, 
          valor: valorBRL, 
          parcela: null 
        });
      }
    }
  }
  
  const valorTotal = transacoes.reduce((sum, t) => sum + t.valor, 0);
  
  return {
    transacoes,
    total_encontrado: transacoes.length,
    valor_total: valorTotal,
    banco_detectado: 'Genérico'
  };
}
