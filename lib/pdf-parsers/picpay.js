/**
 * Parser de Fatura PicPay
 * 
 * Características:
 * - Pode ter até 5 cartões separados (diferentes finais)
 * - Cada cartão tem seção própria com transações
 * - Transações internacionais com conversão USD/BRL
 * - Mastercard BLACK
 * - Programa Smiles (ignorar informações de milhas)
 */

import { parseValorBR, parseDataBR, extrairParcela } from './index.js';

export function parsePicPay(texto) {
  const transacoes = [];
  const linhas = texto.split('\n').map(l => l.trim()).filter(l => l);
  
  // Detectar ano da fatura
  let anoReferencia = new Date().getFullYear();
  const matchAno = texto.match(/(?:FATURA|VENCIMENTO|FECHAMENTO).*?(\d{4})/i);
  if (matchAno) {
    anoReferencia = parseInt(matchAno[1]);
  }
  
  // Set para rastrear transações únicas (evitar duplicatas entre cartões)
  const transacoesUnicas = new Set();
  
  // Padrão 1: Formato tabular DATA | DESCRIÇÃO | VALOR
  const regexTabular = /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+?)\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  let match;
  
  while ((match = regexTabular.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    let descricao = match[2].trim();
    const valor = parseValorBR(match[3]);
    const parcela = extrairParcela(descricao);
    
    // Ignora se for pagamento, taxa ou milhas
    const descUpper = descricao.toUpperCase();
    if (descUpper.includes('PAGAMENTO') && descUpper.includes('FATURA')) continue;
    if (descUpper.includes('ANUIDADE')) continue;
    if (descUpper.includes('IOF') && !descUpper.includes('IOF COMPRA')) continue;
    if (descUpper.includes('ENCARGO')) continue;
    if (descUpper.includes('SMILES') && descUpper.includes('MILHA')) continue;
    if (descUpper.includes('BÔNUS') || descUpper.includes('BONUS')) continue;
    
    // Remove informações de milhas da descrição
    descricao = descricao.replace(/\s*-?\s*\d+\s*MILHAS?/gi, '').trim();
    
    if (data && descricao && valor > 0) {
      // Chave única para evitar duplicatas
      const chave = `${data}|${descricao}|${valor.toFixed(2)}`;
      
      if (!transacoesUnicas.has(chave)) {
        transacoesUnicas.add(chave);
        transacoes.push({ data, descricao, valor, parcela });
      }
    }
  }
  
  // Padrão 2: Transações internacionais (USD convertido para BRL)
  // Formato: "DATA DESCRIÇÃO USD XX.XX BRL YYY,YY"
  const regexInternacional = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+(?:USD|US\$)\s*[\d.,]+\s+(?:BRL|R\$)\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  
  while ((match = regexInternacional.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    let descricao = match[2].trim();
    const valorBRL = parseValorBR(match[3]); // Usar valor em BRL
    
    // Ignora IOF de compras internacionais (são linhas separadas)
    const descUpper = descricao.toUpperCase();
    if (descUpper === 'IOF' || descUpper.startsWith('IOF ')) continue;
    
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
  
  // Padrão 3: Seções de cartões diferentes
  // Procura por "Cartão final XXXX" e processa transações abaixo
  const regexCartao = /CART[ÃA]O\s+(?:FINAL\s+)?(\d{4})/gi;
  let posicaoCartao = [];
  
  while ((match = regexCartao.exec(texto)) !== null) {
    posicaoCartao.push(match.index);
  }
  
  // Para cada seção de cartão, extrai transações
  for (let i = 0; i < posicaoCartao.length; i++) {
    const inicio = posicaoCartao[i];
    const fim = posicaoCartao[i + 1] || texto.length;
    const secao = texto.substring(inicio, fim);
    
    // Processa transações desta seção
    const regexSecao = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g;
    
    while ((match = regexSecao.exec(secao)) !== null) {
      const data = parseDataBR(match[1], anoReferencia);
      let descricao = match[2].trim();
      const valor = parseValorBR(match[3]);
      
      const descUpper = descricao.toUpperCase();
      if (descUpper.includes('PAGAMENTO') || 
          descUpper.includes('ANUIDADE') ||
          descUpper === 'IOF') continue;
      
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
    banco_detectado: 'PicPay'
  };
}
