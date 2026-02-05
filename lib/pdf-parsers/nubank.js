/**
 * Parser de Fatura Nubank
 * 
 * Formato típico:
 * - Data: DD MMM (ex: "15 DEZ")
 * - Descrição em uma linha
 * - Valor: R$ X.XXX,XX ou apenas X.XXX,XX
 * - Parcelamentos: "PARCELA 2/10" ou similar
 */

import { parseValorBR, parseDataBR, extrairParcela } from './index.js';

export function parseNubank(texto) {
  const transacoes = [];
  const linhas = texto.split('\n').map(l => l.trim()).filter(l => l);
  
  // Detectar ano da fatura
  let anoReferencia = new Date().getFullYear();
  const matchAno = texto.match(/(?:FATURA|VENCIMENTO).*?(\d{4})/i);
  if (matchAno) {
    anoReferencia = parseInt(matchAno[1]);
  }
  
  // Padrão Nubank: linha com data seguida de descrição e valor
  // Formato: "15 DEZ" ou "15 dez"
  const mesesAbrev = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    
    // Procura padrão de data "DD MMM"
    const matchData = linha.toUpperCase().match(/^(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)/);
    
    if (matchData) {
      const dataStr = `${matchData[1]} ${matchData[2]}`;
      const data = parseDataBR(dataStr, anoReferencia);
      
      // O resto da linha após a data é a descrição
      let descricao = linha.substring(matchData[0].length).trim();
      let valor = 0;
      let parcela = null;
      
      // Procura valor na mesma linha ou próxima linha
      let valorMatch = descricao.match(/R?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*$/);
      if (valorMatch) {
        valor = parseValorBR(valorMatch[1]);
        descricao = descricao.replace(valorMatch[0], '').trim();
      } else if (i + 1 < linhas.length) {
        // Valor pode estar na próxima linha
        const proximaLinha = linhas[i + 1];
        valorMatch = proximaLinha.match(/^R?\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*$/);
        if (valorMatch) {
          valor = parseValorBR(valorMatch[1]);
          i++; // Pula a linha do valor
        }
      }
      
      // Extrai parcela da descrição
      parcela = extrairParcela(descricao);
      
      // Ignora taxas e pagamentos
      const descUpper = descricao.toUpperCase();
      if (descUpper.includes('PAGAMENTO RECEBIDO') ||
          descUpper.includes('PAGAMENTO FATURA') ||
          descUpper.includes('ANUIDADE') ||
          descUpper.includes('IOF') ||
          descUpper.includes('ENCARGO') ||
          descUpper.includes('MULTA') ||
          descUpper.includes('JUROS')) {
        continue;
      }
      
      if (data && descricao && valor > 0) {
        transacoes.push({
          data,
          descricao: descricao.trim(),
          valor,
          parcela
        });
      }
    }
  }
  
  // Também tenta outro padrão comum do Nubank (tabular)
  // DATA | DESCRIÇÃO | VALOR
  const regexTabular = /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+?)\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  let matchTab;
  while ((matchTab = regexTabular.exec(texto)) !== null) {
    const data = parseDataBR(matchTab[1], anoReferencia);
    const descricao = matchTab[2].trim();
    const valor = parseValorBR(matchTab[3]);
    const parcela = extrairParcela(descricao);
    
    // Verifica se já não foi adicionada
    const jaExiste = transacoes.some(t => 
      t.data === data && 
      t.descricao === descricao && 
      Math.abs(t.valor - valor) < 0.01
    );
    
    if (!jaExiste && data && descricao && valor > 0) {
      const descUpper = descricao.toUpperCase();
      if (!descUpper.includes('PAGAMENTO') && 
          !descUpper.includes('ANUIDADE') &&
          !descUpper.includes('IOF')) {
        transacoes.push({ data, descricao, valor, parcela });
      }
    }
  }
  
  const valorTotal = transacoes.reduce((sum, t) => sum + t.valor, 0);
  
  return {
    transacoes,
    total_encontrado: transacoes.length,
    valor_total: valorTotal,
    banco_detectado: 'Nubank'
  };
}
