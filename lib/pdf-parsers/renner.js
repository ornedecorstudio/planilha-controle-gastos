/**
 * Parser de Fatura Renner / Realize Crédito
 * 
 * Características:
 * - Cartão de loja (Meu Cartão / Visa)
 * - Formato simples com poucas transações
 * - Parcelamentos longos (até 12x)
 * - "Fatura Segura" deve ser IGNORADA
 * - Pode ter "AVAL EMERG. CREDITO" que deve ser ignorado
 */

import { parseValorBR, parseDataBR, extrairParcela } from './index.js';

export function parseRenner(texto) {
  const transacoes = [];
  const linhas = texto.split('\n').map(l => l.trim()).filter(l => l);
  
  // Detectar ano da fatura
  let anoReferencia = new Date().getFullYear();
  const matchAno = texto.match(/(?:FATURA|VENCIMENTO).*?(\d{4})/i);
  if (matchAno) {
    anoReferencia = parseInt(matchAno[1]);
  }
  
  // Lista de termos a ignorar (taxas e serviços da Renner)
  const ignorar = [
    'FATURA SEGURA',
    'SEGURO FATURA',
    'ANUIDADE',
    'AVAL EMERG',
    'AVALIACAO EMERG',
    'CREDITO EMERG',
    'ENCARGO',
    'JUROS',
    'MULTA',
    'IOF',
    'TARIFA',
    'PAGAMENTO FATURA',
    'PAGAMENTO RECEBIDO',
    'PAGAMENTO EFETUADO'
  ];
  
  // Padrão 1: Formato tabular DATA | DESCRIÇÃO | VALOR
  const regexTabular = /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+?)\s+R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  let match;
  
  while ((match = regexTabular.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valor = parseValorBR(match[3]);
    const parcela = extrairParcela(descricao);
    
    // Verifica se deve ignorar
    const descUpper = descricao.toUpperCase();
    const deveIgnorar = ignorar.some(termo => descUpper.includes(termo));
    
    if (deveIgnorar) continue;
    
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
  
  // Padrão 2: Formato específico Renner
  // "LOJA RENNER 1234 - PARCELA 2/10 - R$ 99,90"
  const regexRenner = /(\d{1,2}\/\d{1,2})\s*(LOJA\s+RENNER[^R]+)R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  
  while ((match = regexRenner.exec(texto)) !== null) {
    const data = parseDataBR(match[1], anoReferencia);
    const descricao = match[2].trim();
    const valor = parseValorBR(match[3]);
    const parcela = extrairParcela(descricao);
    
    if (data && descricao && valor > 0) {
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
  
  // Padrão 3: Linhas separadas
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    
    // Procura linha que começa com data
    const matchData = linha.match(/^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/);
    if (matchData) {
      const data = parseDataBR(matchData[1], anoReferencia);
      let descricao = linha.substring(matchData[0].length).trim();
      let valor = 0;
      
      // Procura valor no final da linha
      const matchValor = descricao.match(/R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/);
      if (matchValor) {
        valor = parseValorBR(matchValor[1]);
        descricao = descricao.replace(matchValor[0], '').trim();
      } else if (i + 1 < linhas.length) {
        // Valor pode estar na próxima linha
        const proximaLinha = linhas[i + 1];
        const matchProximo = proximaLinha.match(/^R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/);
        if (matchProximo) {
          valor = parseValorBR(matchProximo[1]);
          i++;
        }
      }
      
      // Verifica se deve ignorar
      const descUpper = descricao.toUpperCase();
      const deveIgnorar = ignorar.some(termo => descUpper.includes(termo));
      
      if (deveIgnorar) continue;
      
      if (data && descricao && valor > 0) {
        const existe = transacoes.some(t =>
          t.data === data &&
          t.descricao.toUpperCase() === descricao.toUpperCase() &&
          Math.abs(t.valor - valor) < 0.01
        );
        
        if (!existe) {
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
    banco_detectado: 'Renner/Realize'
  };
}
