/**
 * Parser de Fatura XP Investimentos
 * 
 * Características:
 * - Cartão premium (Visa Infinite)
 * - MÚLTIPLAS moedas: EUR, USD, BRL
 * - Muitas páginas com transações detalhadas
 * - Transações internacionais com conversão - usar SEMPRE o valor em BRL
 * - Pode ter múltiplos cartões (titular + adicionais)
 * - IOF aparece em linha separada (ignorar)
 */

import { parseValorBR, parseDataBR, extrairParcela } from './index.js';

export function parseXP(texto) {
  const transacoes = [];
  
  // Detectar ano da fatura
  let anoReferencia = new Date().getFullYear();
  const matchAno = texto.match(/(?:FATURA|VENCIMENTO|FECHAMENTO).*?(\d{4})/i);
  if (matchAno) {
    anoReferencia = parseInt(matchAno[1]);
  }
  
  // Set para evitar duplicatas
  const transacoesUnicas = new Set();
  
  // Lista de termos a ignorar
  const ignorar = [
    'PAGAMENTO FATURA',
    'PAGAMENTO RECEBIDO',
    'PAGAMENTO EFETUADO',
    'ANUIDADE',
    'TARIFA',
    'ENCARGO',
    'JUROS MORA',
    'MULTA'
  ];
  
  // Padrão 1: Transações nacionais - DATA | DESCRIÇÃO | VALOR BRL
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
  
  // Padrão 2: Transações internacionais com conversão
  // Formato: DATA | DESCRIÇÃO | USD XX.XX | TAXA | BRL YYY,YY
  // Usar SEMPRE o valor em BRL (último valor)
  const regexInternacional = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+(?:USD|US\$|EUR|€)\s*[\d.,]+\s+[\d.,]+\s+(?:BRL|R\$)\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  
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
  
  // Padrão 3: Formato alternativo XP
  // DATA DESCRIÇÃO VALOR(sem espaço antes do R$)
  const regexAlt = /(\d{1,2}\/\d{1,2})([A-Z][A-Za-z\s\*\-\.]+?)(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  
  while ((match = regexAlt.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valor = parseValorBR(match[3]);
    
    const descUpper = descricao.toUpperCase();
    const deveIgnorar = ignorar.some(termo => descUpper.includes(termo));
    if (deveIgnorar) continue;
    
    // Ignora se descrição for muito curta (provavelmente ruído)
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
  
  // Padrão 4: Seções de cartões adicionais
  const regexCartao = /CART[ÃA]O\s+(?:ADICIONAL\s+)?(?:FINAL\s+)?(\d{4})/gi;
  let posicaoCartao = [];
  
  while ((match = regexCartao.exec(texto)) !== null) {
    posicaoCartao.push({ index: match.index, final: match[1] });
  }
  
  // Processa cada seção de cartão
  for (let i = 0; i < posicaoCartao.length; i++) {
    const inicio = posicaoCartao[i].index;
    const fim = posicaoCartao[i + 1]?.index || texto.length;
    const secao = texto.substring(inicio, fim);
    
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
  
  const valorTotal = transacoes.reduce((sum, t) => sum + t.valor, 0);
  
  return {
    transacoes,
    total_encontrado: transacoes.length,
    valor_total: valorTotal,
    banco_detectado: 'XP Investimentos'
  };
}
