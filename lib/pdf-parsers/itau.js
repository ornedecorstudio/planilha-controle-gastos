/**
 * Parser de Fatura Itaú
 * 
 * Características:
 * - Formato tabular: DATA | DESCRIÇÃO | VALOR
 * - Data pode ser "DD/MM" ou "DD/MM/AA"
 * - Valores negativos indicam estornos/pagamentos
 * - Parcelamentos: "PARC 02/10" ou "2/10"
 * - Pode ter seções separadas: "COMPRAS PARCELADAS" e "COMPRAS A VISTA"
 */

import { parseValorBR, parseDataBR, extrairParcela } from './index.js';

export function parseItau(texto) {
  const transacoes = [];
  
  // Detectar ano da fatura
  let anoReferencia = new Date().getFullYear();
  const matchAno = texto.match(/(?:FATURA|VENCIMENTO).*?(\d{4})/i);
  if (matchAno) {
    anoReferencia = parseInt(matchAno[1]);
  }
  
  // Set para evitar duplicatas
  const transacoesUnicas = new Set();
  
  // Termos a ignorar
  const ignorar = [
    'PAGAMENTO FATURA',
    'PAGAMENTO RECEBIDO',
    'PAGAMENTO EFETUADO',
    'ANUIDADE',
    'TARIFA',
    'ENCARGO',
    'JUROS',
    'MULTA',
    'DEBITO AUTOMATICO',
    'SALDO ANTERIOR'
  ];
  
  // Padrão 1: Formato tabular principal Itaú
  // DATA | DESCRIÇÃO | VALOR
  const regexTabular = /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/gm;
  let match;
  
  while ((match = regexTabular.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    let valorStr = match[3];
    
    // Ignora valores negativos (são estornos/pagamentos)
    if (valorStr.startsWith('-')) continue;
    
    const valor = parseValorBR(valorStr);
    const parcela = extrairParcela(descricao);
    
    const descUpper = descricao.toUpperCase();
    
    // Ignora termos específicos
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
  
  // Padrão 2: Seção de compras parceladas
  const regexParceladas = /COMPRAS?\s+PARCELADAS?([\s\S]*?)(?=COMPRAS?\s+(?:A\s+)?VISTA|RESUMO|TOTAL|$)/gi;
  match = regexParceladas.exec(texto);
  
  if (match) {
    const secaoParceladas = match[1];
    const regexItem = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})/g;
    
    let itemMatch;
    while ((itemMatch = regexItem.exec(secaoParceladas)) !== null) {
      const data = parseDataBR(itemMatch[1], anoReferencia);
      const descricao = itemMatch[2].trim();
      const valor = parseValorBR(itemMatch[3]);
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
  }
  
  // Padrão 3: Seção de compras à vista
  const regexVista = /COMPRAS?\s+(?:A\s+)?VISTA([\s\S]*?)(?=COMPRAS?\s+PARCELADAS?|RESUMO|TOTAL|$)/gi;
  match = regexVista.exec(texto);
  
  if (match) {
    const secaoVista = match[1];
    const regexItem = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})/g;
    
    let itemMatch;
    while ((itemMatch = regexItem.exec(secaoVista)) !== null) {
      const data = parseDataBR(itemMatch[1], anoReferencia);
      const descricao = itemMatch[2].trim();
      const valor = parseValorBR(itemMatch[3]);
      
      const descUpper = descricao.toUpperCase();
      const deveIgnorar = ignorar.some(termo => descUpper.includes(termo));
      if (deveIgnorar) continue;
      
      if (data && descricao && valor > 0) {
        const chave = `${data}|${descricao}|${valor.toFixed(2)}`;
        
        if (!transacoesUnicas.has(chave)) {
          transacoesUnicas.add(chave);
          transacoes.push({ data, descricao, valor, parcela: null });
        }
      }
    }
  }
  
  // Padrão 4: Formato alternativo Itaú (linha por linha)
  const linhas = texto.split('\n').map(l => l.trim()).filter(l => l);
  
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    
    // Procura linha que começa com data DD/MM
    const matchData = linha.match(/^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+)/);
    if (matchData) {
      const data = parseDataBR(matchData[1], anoReferencia);
      let resto = matchData[2].trim();
      
      // Procura valor no final (positivo)
      const matchValor = resto.match(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/);
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
    banco_detectado: 'Itaú'
  };
}
