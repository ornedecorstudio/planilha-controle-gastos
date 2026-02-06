/**
 * Parser de Fatura Mercado Pago
 * 
 * Características:
 * - Layout mobile/minimalista
 * - Data, descrição e valor podem estar em linhas separadas
 * - Parcelamentos: "Parcela X de Y"
 * - Pode ter múltiplos cartões (físico, virtual)
 * 
 * IMPORTANTE: O Mercado Pago às vezes lista o mesmo cartão
 * em seções diferentes (ex: PF e PJ separados)
 */

import { parseValorBR, parseDataBR, extrairParcela } from './index.js';

export function parseMercadoPago(texto) {
  const transacoes = [];
  const linhas = texto.split('\n').map(l => l.trim()).filter(l => l);
  
  // Detectar ano da fatura
  let anoReferencia = new Date().getFullYear();
  const matchAno = texto.match(/(?:FATURA|VENCIMENTO).*?(\d{4})/i);
  if (matchAno) {
    anoReferencia = parseInt(matchAno[1]);
  }
  
  // Padrão 1: Linhas com DATA | DESCRIÇÃO | VALOR
  const regexCompleto = /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+?)\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  let match;
  
  while ((match = regexCompleto.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valor = parseValorBR(match[3]);
    const parcela = extrairParcela(descricao);
    
    // Ignora se for pagamento ou taxa
    const descUpper = descricao.toUpperCase();
    if (descUpper.includes('PAGAMENTO') && 
        (descUpper.includes('FATURA') || descUpper.includes('RECEBIDO'))) {
      continue;
    }
    if (descUpper.includes('ANUIDADE') ||
        descUpper.includes('ENCARGO')) {
      continue;
    }
    
    if (data && descricao && valor > 0) {
      // Evita duplicatas
      const existe = transacoes.some(t =>
        t.data === data &&
        t.descricao === descricao &&
        Math.abs(t.valor - valor) < 0.01
      );
      
      if (!existe) {
        transacoes.push({ data, descricao, valor, parcela });
      }
    }
  }
  
  // Padrão 2: Formato separado por linhas (comum em mobile)
  // Linha 1: Data
  // Linha 2: Descrição
  // Linha 3: Valor
  for (let i = 0; i < linhas.length - 2; i++) {
    const linha1 = linhas[i];
    const linha2 = linhas[i + 1];
    const linha3 = linhas[i + 2];
    
    // Verifica se linha1 é uma data
    if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(linha1)) {
      // Verifica se linha3 é um valor
      if (/^R?\$?\s*\d{1,3}(?:\.\d{3})*,\d{2}$/.test(linha3)) {
        const data = parseDataBR(linha1, anoReferencia);
        const descricao = linha2;
        const valor = parseValorBR(linha3);
        const parcela = extrairParcela(descricao);
        
        // Ignora taxas
        const descUpper = descricao.toUpperCase();
        if (descUpper.includes('PAGAMENTO') ||
            descUpper.includes('ANUIDADE')) {
          continue;
        }
        
        if (data && descricao && valor > 0) {
          const existe = transacoes.some(t =>
            t.data === data &&
            t.descricao === descricao &&
            Math.abs(t.valor - valor) < 0.01
          );
          
          if (!existe) {
            transacoes.push({ data, descricao, valor, parcela });
            i += 2; // Pula as linhas já processadas
          }
        }
      }
    }
  }
  
  // Padrão 3: Busca por padrões específicos do Mercado Pago
  // Ex: "COMPRA NO DÉBITO" ou "COMPRA APROVADA"
  const regexMP = /(\d{1,2}\/\d{1,2})\s*[-–]\s*(.+?)\s*[-–]?\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  while ((match = regexMP.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valor = parseValorBR(match[3]);
    
    if (data && descricao && valor > 0) {
      const existe = transacoes.some(t =>
        t.data === data &&
        t.descricao === descricao &&
        Math.abs(t.valor - valor) < 0.01
      );
      
      if (!existe) {
        transacoes.push({ data, descricao, valor, parcela: null });
      }
    }
  }
  
  const valorTotal = transacoes.reduce((sum, t) => sum + t.valor, 0);
  
  return {
    transacoes,
    total_encontrado: transacoes.length,
    valor_total: valorTotal,
    banco_detectado: 'Mercado Pago'
  };
}
