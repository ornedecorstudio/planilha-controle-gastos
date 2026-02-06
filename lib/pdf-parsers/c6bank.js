/**
 * Parser de Fatura C6 Bank
 * 
 * Características:
 * - Pode ter MÚLTIPLOS cartões (virtual, físico, adicionais)
 * - Cada cartão tem sua própria seção de transações
 * - Transações internacionais mostram valor em USD + valor convertido em BRL + IOF separado
 * - Usar SEMPRE o valor em BRL (convertido), IGNORAR o valor em USD
 * - Parcelamentos aparecem como "Parcela X/Y"
 */

import { parseValorBR, parseDataBR, extrairParcela } from './index.js';

export function parseC6Bank(texto) {
  const transacoes = [];
  
  // Detectar ano da fatura
  let anoReferencia = new Date().getFullYear();
  const matchAno = texto.match(/(?:FATURA|VENCIMENTO|FECHAMENTO).*?(\d{4})/i);
  if (matchAno) {
    anoReferencia = parseInt(matchAno[1]);
  }
  
  // Set para evitar duplicatas
  const transacoesUnicas = new Set();
  
  // Termos a ignorar
  const ignorar = [
    'PAGAMENTO FATURA',
    'PAGAMENTO RECEBIDO',
    'ANUIDADE',
    'TARIFA',
    'ENCARGO',
    'JUROS',
    'MULTA'
  ];
  
  // Padrão 1: Transações nacionais
  // DATA | DESCRIÇÃO | VALOR
  const regexNacional = /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+?)\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/gm;
  let match;
  
  while ((match = regexNacional.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valor = parseValorBR(match[3]);
    const parcela = extrairParcela(descricao);
    
    const descUpper = descricao.toUpperCase();
    
    // Ignora outros termos (IOF é incluído como gasto)
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
  
  // Padrão 2: Transações internacionais C6
  // Formato típico: DATA | DESCRIÇÃO | USD XX.XX | BRL YYY,YY
  const regexInternacional = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+(?:USD|US\$)\s*[\d.,]+\s+(?:BRL|R\$)\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  
  while ((match = regexInternacional.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    let descricao = match[2].trim();
    const valorBRL = parseValorBR(match[3]);
    
    const descUpper = descricao.toUpperCase();

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
  
  // Padrão 3: Detectar seções de cartões diferentes
  // C6 separa por "Cartão virtual", "Cartão físico", etc.
  const regexSecaoCartao = /(CART[ÃA]O\s+(?:VIRTUAL|F[ÍI]SICO|ADICIONAL|FINAL\s+\d{4}))/gi;
  let secoesCartao = [];
  
  while ((match = regexSecaoCartao.exec(texto)) !== null) {
    secoesCartao.push({
      tipo: match[1],
      inicio: match.index
    });
  }
  
  // Processa cada seção
  for (let i = 0; i < secoesCartao.length; i++) {
    const inicio = secoesCartao[i].inicio;
    const fim = secoesCartao[i + 1]?.inicio || texto.length;
    const secao = texto.substring(inicio, fim);
    
    // Extrai transações da seção
    const regexSecao = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g;
    
    while ((match = regexSecao.exec(secao)) !== null) {
      const data = parseDataBR(match[1], anoReferencia);
      const descricao = match[2].trim();
      const valor = parseValorBR(match[3]);
      
      const descUpper = descricao.toUpperCase();
      const deveIgnorar = ignorar.some(termo => descUpper.includes(termo));
      if (deveIgnorar) continue;
      
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
  
  // Padrão 4: Formato de lista simples C6
  // Algumas faturas C6 vêm em formato mais simples
  const linhas = texto.split('\n').map(l => l.trim()).filter(l => l);
  
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    
    // Procura linha que começa com data
    const matchData = linha.match(/^(\d{1,2}\/\d{1,2})/);
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
  
  const valorTotal = transacoes.reduce((sum, t) => sum + t.valor, 0);
  
  return {
    transacoes,
    total_encontrado: transacoes.length,
    valor_total: valorTotal,
    banco_detectado: 'C6 Bank'
  };
}
