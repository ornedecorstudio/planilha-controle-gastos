/**
 * Parser de Fatura Santander — v1 (Metadados + IA Visual)
 *
 * Problema central: faturas Santander usam layout columnar no PDF.
 * Quando pdf-parse extrai o texto, datas/descrições ficam em um bloco
 * e valores em outro bloco separado, gerando corrupção nos valores.
 *
 * Exemplo real do texto extraído:
 *   "16/12 SEG CONTA CART - DEZ/25 17/12 SEG CONTA CART - DEZ/25 VALOR TOTAL"
 *   "Parcela"
 *   "R$    US$"
 *   "10,69"
 *   "25,39"
 *
 * Múltiplas transações concatenadas + valores separados = regex impossível.
 *
 * Estratégia v1 (metadata-only + IA visual):
 *   1. Extrai metadados confiáveis do texto (total da fatura, cartões, resumo)
 *   2. NÃO tenta capturar transações (impossível com texto columnar)
 *   3. SEMPRE retorna confianca_texto: 'baixa' para forçar IA visual
 *   4. IA visual recebe metadados para verificação cruzada
 *   5. IA visual lê o PDF renderizado e extrai transações corretamente
 *
 * Características Santander:
 * - Layout columnar (datas+descrições separados dos valores)
 * - Múltiplos cartões (titular + adicionais), cada um com seções próprias
 * - Página 1: Resumo (Total a Pagar, Pagamento Mínimo, limite, anuidade)
 * - Páginas 2-3: "Detalhamento da Fatura" com transações por cartão
 * - Seções por cartão: "Despesas", "Parcelamentos", "Pagamento e Demais Créditos"
 * - "Seu Limite é:" NÃO é transação (é o limite do cartão)
 * - "PAGAMENTO DE FATURA-INTERNET" NÃO é transação (é pagamento anterior)
 * - "Resumo da Fatura" no final com totais de verificação
 * - Programa Smiles (milhas) — ignorar
 */

import { parseValorBR } from './index.js';

/**
 * Extrai o "Total a Pagar" do resumo da fatura (página 1).
 *
 * Santander tem vários valores na página 1:
 *   - "Total a Pagar R$ 10.211,65" (este é o correto)
 *   - "1 Pagamento Total R$10.211,65" (mesmo valor, formato diferente)
 *   - "2 Pagamento Mínimo R$1.021,16" (NÃO é o total)
 *   - "Seu Limite é: R$10.570,00" (NÃO é o total, é o limite do cartão)
 *
 * Ordem de prioridade:
 *   1. "Total a Pagar" — mais confiável
 *   2. "Pagamento Total" — fora de contexto de limite/mínimo
 *   3. "Saldo Desta Fatura" — no resumo da página 2/3
 */
function extrairTotalFaturaPDF(texto) {
  // Padrão 1: "Total a Pagar R$ 10.211,65"
  const regexTotalPagar = /TOTAL\s+A\s+PAGAR\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  let match = regexTotalPagar.exec(texto);
  if (match) {
    const valor = parseValorBR(match[1]);
    if (valor >= 100) {
      console.log(`[Santander Parser] Total extraído via "Total a Pagar": ${valor}`);
      return valor;
    }
  }

  // Padrão 2: "Pagamento Total R$10.211,65" (sem espaço após R$)
  const regexPagTotal = /PAGAMENTO\s+TOTAL\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  match = regexPagTotal.exec(texto);
  if (match) {
    const valor = parseValorBR(match[1]);
    if (valor >= 100) {
      console.log(`[Santander Parser] Total extraído via "Pagamento Total": ${valor}`);
      return valor;
    }
  }

  // Padrão 3: "Saldo Desta Fatura" no resumo (página 2/3)
  const regexSaldo = /SALDO\s+DESTA\s+FATURA[\s\S]{0,100}?(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  match = regexSaldo.exec(texto);
  if (match) {
    const valor = parseValorBR(match[1]);
    if (valor >= 100) {
      console.log(`[Santander Parser] Total extraído via "Saldo Desta Fatura": ${valor}`);
      return valor;
    }
  }

  console.log('[Santander Parser] Nenhum total da fatura encontrado');
  return null;
}

/**
 * Extrai números de cartão (últimos 4 dígitos) mencionados no PDF.
 * Padrão Santander: "4258 XXXX XXXX 8172"
 */
function extrairCartoes(texto) {
  const cartoes = new Set();

  // Padrão "NNNN XXXX XXXX NNNN"
  const regexCartao = /\d{4}\s+XXXX\s+XXXX\s+(\d{4})/gi;
  let match;
  while ((match = regexCartao.exec(texto)) !== null) {
    cartoes.add(match[1]);
  }

  // Fallback: "final NNNN"
  const regexFinal = /FINAL\s+(\d{4})/gi;
  while ((match = regexFinal.exec(texto)) !== null) {
    cartoes.add(match[1]);
  }

  return [...cartoes];
}

/**
 * Extrai valores do "Resumo da Fatura" (página 2/3).
 *
 * Santander tem:
 *   Saldo Anterior (+) ... R$ 6.530,92
 *   Total Despesas/Débitos no Brasil (+) ... R$ 10.211,65
 *   Total Despesas/Débitos no Exterior (+) ... R$ 0,00
 *   Total de pagamentos (-) ... R$ 6.530,92
 *   Total de créditos (-) ... R$ 0,00
 *   Saldo Desta Fatura ... R$ 10.211,65
 *
 * NOTA: No texto extraído pelo pdf-parse, os valores ficam separados
 * das descrições (layout columnar). Tentamos extrair o que for possível.
 */
function extrairResumoFatura(texto) {
  const resumo = {};

  // Buscar "Total Despesas/Débitos no Brasil"
  const regexDespBR = /TOTAL\s+DESPESAS.*?BRASIL[\s\S]{0,200}?(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  let match = regexDespBR.exec(texto);
  if (match) {
    resumo.total_despesas_brasil = parseValorBR(match[1]);
  }

  // Buscar "Total de pagamentos"
  const regexPag = /TOTAL\s+DE\s+PAGAMENTOS[\s\S]{0,200}?(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  match = regexPag.exec(texto);
  if (match) {
    resumo.total_pagamentos = parseValorBR(match[1]);
  }

  // Buscar "Total de créditos"
  const regexCred = /TOTAL\s+DE\s+CR[EÉ]DITOS[\s\S]{0,200}?(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  match = regexCred.exec(texto);
  if (match) {
    resumo.total_creditos = parseValorBR(match[1]);
  }

  // Buscar "Saldo Anterior"
  const regexSaldoAnt = /SALDO\s+ANTERIOR[\s\S]{0,200}?(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  match = regexSaldoAnt.exec(texto);
  if (match) {
    resumo.saldo_anterior = parseValorBR(match[1]);
  }

  return Object.keys(resumo).length > 0 ? resumo : null;
}

/**
 * Extrai o valor total de anuidade da página 1.
 * Santander mostra: "ANUIDADE Entenda como é calculada ... TOTAL R$113,33"
 */
function extrairAnuidade(texto) {
  // Buscar "ANUIDADE" seguido de "TOTAL R$XXX,XX" em até 500 chars
  const regexAnuidade = /ANUIDADE[\s\S]{0,500}?TOTAL\s*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  const match = regexAnuidade.exec(texto);
  if (match) {
    const valor = parseValorBR(match[1]);
    if (valor > 0) {
      console.log(`[Santander Parser] Anuidade total extraída: ${valor}`);
      return valor;
    }
  }
  return null;
}

/**
 * Detecta se o texto Santander tem layout columnar.
 *
 * Heurística: conta linhas com múltiplas datas DD/MM concatenadas
 * (ex: "16/12 SEG CONTA CART - DEZ/25 17/12 SEG CONTA CART - DEZ/25").
 * Também verifica linhas que são apenas valores sem descrição.
 */
function detectarLayoutColumnar(texto) {
  const linhas = texto.split('\n');
  let linhasComDuasDatas = 0;
  let linhasComUmaData = 0;
  let linhasSoValor = 0;

  for (const linha of linhas) {
    const trimmed = linha.trim();

    // Contar linhas com múltiplas datas
    const datas = trimmed.match(/\d{1,2}\/\d{1,2}/g);
    if (datas && datas.length >= 2) {
      linhasComDuasDatas++;
    } else if (datas && datas.length === 1) {
      linhasComUmaData++;
    }

    // Contar linhas que são APENAS um valor (sem descrição)
    if (/^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(trimmed)) {
      linhasSoValor++;
    }
  }

  const totalLinhasComData = linhasComDuasDatas + linhasComUmaData;

  return {
    columnar: linhasComDuasDatas >= 2 || linhasSoValor >= 5,
    linhasComDuasDatas,
    linhasComUmaData,
    linhasSoValor,
    percentualDuasDatas: totalLinhasComData > 0
      ? Math.round((linhasComDuasDatas / totalLinhasComData) * 100)
      : 0
  };
}

/**
 * Parser principal Santander — extrai apenas metadados e força IA visual.
 *
 * Santander tem layout columnar onde pdf-parse separa datas/descrições
 * dos valores, tornando regex determinístico impossível para transações.
 * Retorna ZERO transações + confianca_texto='baixa' para forçar IA visual,
 * junto com metadados ricos para o prompt da IA.
 */
export function parseSantander(texto) {
  // Detectar layout columnar — para logging e metadados
  const deteccaoColumnar = detectarLayoutColumnar(texto);
  console.log(`[Santander Parser] Detecção layout columnar: ${JSON.stringify(deteccaoColumnar)}`);

  // Extrair metadados confiáveis
  const totalFaturaPDF = extrairTotalFaturaPDF(texto);
  const cartoesDetectados = extrairCartoes(texto);
  const resumoFatura = extrairResumoFatura(texto);
  const anuidadeTotal = extrairAnuidade(texto);

  console.log(`[Santander Parser] Total fatura PDF: ${totalFaturaPDF}`);
  console.log(`[Santander Parser] Cartões: ${JSON.stringify(cartoesDetectados)}`);
  console.log(`[Santander Parser] Resumo fatura: ${JSON.stringify(resumoFatura)}`);
  console.log(`[Santander Parser] Anuidade total: ${anuidadeTotal}`);

  // Santander SEMPRE tem layout columnar — forçar IA visual
  console.log('[Santander Parser] Confiança SEMPRE BAIXA: Santander usa layout columnar — forçando IA visual');

  return {
    transacoes: [],
    total_encontrado: 0,
    valor_total: 0,
    banco_detectado: 'Santander',
    confianca_texto: 'baixa',
    cartoes_detectados: cartoesDetectados,
    resumo_fatura: {
      total_compras: 0,
      iof: 0,
      estornos: 0,
      pagamento_antecipado: 0,
      tarifa_cartao: 0,
      total_fatura_pdf: totalFaturaPDF,
      total_fatura_calculado: 0,
      reconciliado: false,
      diferenca_centavos: null,
      equacao: 'Parser Santander v1: metadados-only, transações via IA visual',
      subtotais_pdf: []
    },
    metadados_verificacao: {
      total_fatura_pdf: totalFaturaPDF,
      resumo_fatura_pdf: resumoFatura,
      anuidade_pdf: anuidadeTotal,
      cartoes: cartoesDetectados,
      layout_columnar: deteccaoColumnar
    }
  };
}
