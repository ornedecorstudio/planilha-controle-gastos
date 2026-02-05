/**
 * Sistema de Parsers de PDF por Banco
 * 
 * Detecta automaticamente o banco pelo conteúdo do PDF
 * e usa o parser específico para extrair transações.
 * 
 * Se nenhum parser conseguir processar, retorna null
 * para que o sistema use IA como fallback.
 */

import { parseNubank } from './nubank.js';
import { parseMercadoPago } from './mercadopago.js';
import { parsePicPay } from './picpay.js';
import { parseRenner } from './renner.js';
import { parseXP } from './xp.js';
import { parseC6Bank } from './c6bank.js';
import { parseItau } from './itau.js';
import { parseGeneric } from './generic.js';

/**
 * Detecta o banco pelo conteúdo do texto extraído do PDF
 */
export function detectarBanco(texto) {
  const textoUpper = texto.toUpperCase();
  
  // Nubank
  if (textoUpper.includes('NU PAGAMENTOS') || 
      textoUpper.includes('NUBANK') ||
      textoUpper.includes('NU INVEST') ||
      (textoUpper.includes('ROXINHO') && textoUpper.includes('FATURA'))) {
    return 'nubank';
  }
  
  // Mercado Pago
  if (textoUpper.includes('MERCADO PAGO') ||
      textoUpper.includes('MERCADOPAGO') ||
      textoUpper.includes('MERCADO CRÉDITO') ||
      (textoUpper.includes('VISA') && textoUpper.includes('MERCADO'))) {
    return 'mercadopago';
  }
  
  // PicPay
  if (textoUpper.includes('PICPAY') ||
      textoUpper.includes('PIC PAY') ||
      textoUpper.includes('PICPAY SERVICOS')) {
    return 'picpay';
  }
  
  // Renner / Realize
  if (textoUpper.includes('REALIZE') ||
      textoUpper.includes('LOJAS RENNER') ||
      textoUpper.includes('RENNER S.A') ||
      textoUpper.includes('MEU CARTÃO')) {
    return 'renner';
  }
  
  // XP Investimentos
  if (textoUpper.includes('XP INVESTIMENTOS') ||
      textoUpper.includes('XP INC') ||
      textoUpper.includes('CARTÃO XP') ||
      textoUpper.includes('XP VISA')) {
    return 'xp';
  }
  
  // C6 Bank
  if (textoUpper.includes('C6 BANK') ||
      textoUpper.includes('C6 CONSIG') ||
      textoUpper.includes('BANCO C6') ||
      textoUpper.includes('C6 S.A')) {
    return 'c6bank';
  }
  
  // Itaú
  if (textoUpper.includes('ITAÚ') ||
      textoUpper.includes('ITAU UNIBANCO') ||
      textoUpper.includes('ITAUCARD') ||
      textoUpper.includes('BANCO ITAÚ')) {
    return 'itau';
  }
  
  // Santander
  if (textoUpper.includes('SANTANDER') ||
      textoUpper.includes('BANCO SANTANDER')) {
    return 'santander';
  }
  
  // Bradesco
  if (textoUpper.includes('BRADESCO') ||
      textoUpper.includes('BANCO BRADESCO')) {
    return 'bradesco';
  }
  
  return 'desconhecido';
}

/**
 * Processa o PDF usando o parser específico do banco
 * 
 * @param {string} texto - Texto extraído do PDF
 * @param {string} bancoHint - Dica opcional do nome do cartão
 * @returns {object|null} - { transacoes, banco_detectado, metodo } ou null se falhar
 */
export async function processarPDFDeterministico(texto, bancoHint = '') {
  const banco = detectarBanco(texto + ' ' + bancoHint);
  
  console.log(`[PDF Parser] Banco detectado: ${banco}`);
  
  let resultado = null;
  
  try {
    switch (banco) {
      case 'nubank':
        resultado = parseNubank(texto);
        break;
      case 'mercadopago':
        resultado = parseMercadoPago(texto);
        break;
      case 'picpay':
        resultado = parsePicPay(texto);
        break;
      case 'renner':
        resultado = parseRenner(texto);
        break;
      case 'xp':
        resultado = parseXP(texto);
        break;
      case 'c6bank':
        resultado = parseC6Bank(texto);
        break;
      case 'itau':
        resultado = parseItau(texto);
        break;
      default:
        // Tenta parser genérico
        resultado = parseGeneric(texto);
        break;
    }
  } catch (error) {
    console.error(`[PDF Parser] Erro no parser ${banco}:`, error);
    resultado = null;
  }
  
  // Se o parser específico falhou ou retornou poucas transações, tenta genérico
  if (!resultado || !resultado.transacoes || resultado.transacoes.length < 2) {
    console.log('[PDF Parser] Parser específico falhou, tentando genérico...');
    try {
      resultado = parseGeneric(texto);
    } catch (error) {
      console.error('[PDF Parser] Parser genérico também falhou:', error);
      return null;
    }
  }
  
  if (resultado && resultado.transacoes && resultado.transacoes.length > 0) {
    return {
      ...resultado,
      banco_detectado: banco,
      metodo: 'PARSER_DETERMINISTICO'
    };
  }
  
  // Retorna null para indicar que deve usar IA
  return null;
}

/**
 * Utilitário: Converte valor brasileiro (1.234,56) para número
 */
export function parseValorBR(valorStr) {
  if (!valorStr) return 0;
  
  // Remove espaços e R$
  let limpo = valorStr.toString().trim()
    .replace(/R\$\s*/gi, '')
    .replace(/\s+/g, '');
  
  // Detecta formato brasileiro (1.234,56) vs americano (1,234.56)
  const temVirgula = limpo.includes(',');
  const temPonto = limpo.includes('.');
  
  if (temVirgula && temPonto) {
    // Formato brasileiro: 1.234,56
    limpo = limpo.replace(/\./g, '').replace(',', '.');
  } else if (temVirgula) {
    // Apenas vírgula: 1234,56
    limpo = limpo.replace(',', '.');
  }
  // Se só tem ponto, já está no formato certo
  
  const valor = parseFloat(limpo);
  return isNaN(valor) ? 0 : Math.abs(valor);
}

/**
 * Utilitário: Converte data DD/MM/YYYY ou DD/MM para YYYY-MM-DD
 */
export function parseDataBR(dataStr, anoReferencia = new Date().getFullYear()) {
  if (!dataStr) return null;
  
  const limpo = dataStr.trim();
  
  // Formato DD/MM/YYYY
  let match = limpo.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const [, dia, mes, ano] = match;
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }
  
  // Formato DD/MM/YY
  match = limpo.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})/);
  if (match) {
    const [, dia, mes, anoShort] = match;
    const ano = parseInt(anoShort) > 50 ? `19${anoShort}` : `20${anoShort}`;
    return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }
  
  // Formato DD/MM (sem ano)
  match = limpo.match(/(\d{1,2})\/(\d{1,2})/);
  if (match) {
    const [, dia, mes] = match;
    return `${anoReferencia}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
  }
  
  // Formato DD MMM (ex: 15 DEZ)
  const meses = {
    'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04',
    'MAI': '05', 'JUN': '06', 'JUL': '07', 'AGO': '08',
    'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12'
  };
  match = limpo.toUpperCase().match(/(\d{1,2})\s*(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)/);
  if (match) {
    const [, dia, mesNome] = match;
    const mes = meses[mesNome];
    return `${anoReferencia}-${mes}-${dia.padStart(2, '0')}`;
  }
  
  return null;
}

/**
 * Utilitário: Extrai parcela do texto (ex: "2/10", "PARCELA 2 DE 10")
 */
export function extrairParcela(texto) {
  if (!texto) return null;
  
  const textoUpper = texto.toUpperCase();
  
  // Formato X/Y
  let match = textoUpper.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (match) {
    return `${match[1]}/${match[2]}`;
  }
  
  // Formato PARCELA X DE Y
  match = textoUpper.match(/PARC(?:ELA)?\s*(\d{1,2})\s*(?:DE|\/)\s*(\d{1,2})/);
  if (match) {
    return `${match[1]}/${match[2]}`;
  }
  
  // Formato PARC XX/YY
  match = textoUpper.match(/PARC\s*(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (match) {
    return `${match[1]}/${match[2]}`;
  }
  
  return null;
}
