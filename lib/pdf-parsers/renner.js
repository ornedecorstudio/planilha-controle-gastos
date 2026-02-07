/**
 * Parser de Fatura Renner / Realize Crédito — v2
 *
 * Características do PDF Renner:
 * - Página 1: Resumo (Pagamento Total, Mínimo, Parcelamento, boleto) — NÃO contém transações
 * - Página 2: "Lançamentos detalhados do período" — contém as transações reais
 * - Página 3: Termos, condições, taxas — IGNORAR
 *
 * Formato das transações (página 2):
 *   DD/MM/YYYY | Descrição | Estabelecimento (opcional) | Valor
 *   Ex: "03/01/2026 Compra a Vista sem Juros Visa FACEBK RCM5Z9RHW2 506,90"
 *   Ex: "10/01/2026 Fatura Segura 12,90"
 *   Ex: "30/12/2025 Pagamento Fatura Pix -4.988,91"
 *
 * Problemas do parser v1:
 * - Regex genéricos capturavam valores do resumo da página 1 (Mínimo, Parcelamento, Pagamento Total)
 * - Sem delimitação de seção — não distinguia resumo de transações
 * - Sem tipo_lancamento, resumo_fatura, confianca_texto
 * - Descrição "Compra a Vista sem Juros Visa" é genérica — nome real está na coluna Estabelecimento
 *
 * Estratégia v2:
 * 1. Extrair "Pagamento Total" da página 1 como total_fatura_pdf
 * 2. Localizar seção "Lançamentos detalhados" como delimitador
 * 3. Parsear APENAS transações dentro dessa seção
 * 4. Usar nome do estabelecimento como descrição quando disponível
 * 5. Classificar tipo_lancamento por transação
 * 6. Retornar resumo_fatura com reconciliação
 */

import { parseValorBR, parseDataBR, extrairParcela } from './index.js';

/**
 * Extrai o "Pagamento Total" do resumo da fatura (página 1).
 * Este é o total_fatura_pdf para reconciliação.
 *
 * CUIDADO: O texto extraído pelo pdf-parse para a página 1 contém:
 *   "Pagamento Total Limite Total ... 5.046,18"
 * Mas também contém valores de parcelamento como "7x de R$ 1.121,33"
 * que podem ser capturados incorretamente se o regex for muito amplo.
 */
function extrairTotalFaturaPDF(texto) {
  const regexes = [
    // Padrão 1: "Pagamento Total" seguido diretamente por valor (mesma linha ou próxima)
    // Sem [\s\S]*? que pula muitas linhas e captura valor errado
    /PAGAMENTO\s+TOTAL\s*[:\s]*R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i,

    // Padrão 2: "Total R$ VALOR" na seção de resumo da página 2
    /TOTAL\s+R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i,

    // Padrão 3: "Pagamento Total" seguido de valor em até 80 caracteres (sem newline cross)
    /PAGAMENTO\s+TOTAL.{0,80}?(\d{1,3}(?:\.\d{3})*,\d{2})/i,

    // Padrão 4: valor isolado numa linha próxima (máx 200 chars com newlines)
    /PAGAMENTO\s+TOTAL[\s\S]{0,200}?(\d{1,3}(?:\.\d{3})*,\d{2})/i,
  ];

  for (const regex of regexes) {
    const match = regex.exec(texto);
    if (match) {
      const valor = parseValorBR(match[1]);
      // Filtro: ignorar valores < 100 (podem ser percentuais como 17,40%)
      // e ignorar valores que parecem parcelas (< total esperado)
      if (valor >= 100) {
        console.log(`[Renner Parser] Total fatura extraído: ${valor} (regex: ${regex.source.substring(0, 40)}...)`);
        return valor;
      }
    }
  }

  console.log('[Renner Parser] Nenhum total da fatura encontrado');
  return null;
}

/**
 * Classifica o tipo de lançamento de uma transação Renner.
 *
 * IMPORTANTE: A ordem das verificações importa!
 * "Compra a Vista sem Juros Visa" contém "JUROS", então compras
 * devem ser detectadas ANTES da regra de juros/encargos.
 */
function classificarTipoRenner(descricaoCompleta) {
  const desc = descricaoCompleta.toUpperCase();

  // 1. Pagamentos do cliente (IGNORAR — não incluir no resultado)
  if (desc.includes('PAGAMENTO FATURA') ||
      desc.includes('PAGAMENTO RECEBIDO') ||
      desc.includes('PAGAMENTO EFETUADO') ||
      desc.includes('PAGAMENTO PIX')) {
    return 'pagamento_fatura';
  }

  // 2. Compras — detectar ANTES de juros/tarifas para evitar false positive
  //    "Compra a Vista sem JUROS Visa" contém "JUROS" mas é compra!
  if (desc.includes('COMPRA A VISTA') ||
      desc.includes('COMPRA PARCELADA') ||
      desc.includes('COMPRA VISA') ||
      desc.includes('COMPRA MEU CART') ||
      desc.includes('SAQUE VISA') ||
      desc.includes('SAQUE MEU CART')) {
    return 'compra';
  }

  // 3. Tarifas do cartão (termos específicos)
  if (desc.includes('FATURA SEGURA') ||
      desc.includes('SEGURO FATURA') ||
      desc.includes('ANUIDADE') ||
      desc.includes('AVAL EMERG') ||
      desc.includes('AVALIACAO EMERG') ||
      desc.includes('CREDITO EMERG')) {
    return 'tarifa_cartao';
  }

  // 4. Estornos/devoluções
  if (desc.includes('ESTORNO') ||
      desc.includes('DEVOLUC') ||
      desc.includes('REEMBOLSO') ||
      desc.includes('CASHBACK')) {
    return 'estorno';
  }

  // 5. IOF
  if (desc.includes('IOF')) {
    return 'iof';
  }

  // 6. Juros/encargos/multa — SÓ chega aqui se NÃO for compra (item 2 já filtrou)
  if (desc.includes('JUROS') ||
      desc.includes('MULTA') ||
      desc.includes('ENCARGO') ||
      desc.includes('TARIFA')) {
    return 'tarifa_cartao';
  }

  // Default: compra
  return 'compra';
}

/**
 * Extrai o nome do estabelecimento da descrição.
 *
 * No PDF Renner, transações de compra têm formato:
 *   "Compra a Vista sem Juros Visa FACEBK RCM5Z9RHW2"
 *   "Compra a Vista sem Juros Meu Cartão LOJA XYZ"
 *
 * A parte genérica ("Compra a Vista sem Juros Visa") deve ser removida
 * e o estabelecimento ("FACEBK RCM5Z9RHW2") usado como descrição.
 */
function extrairEstabelecimento(descricao) {
  // Remove prefixos genéricos de tipo de compra
  const prefixos = [
    /^Compra\s+a\s+Vista\s+sem\s+Juros\s+(?:Visa|Meu\s+Cart[aã]o)\s*/i,
    /^Compra\s+a\s+Vista\s+(?:Visa|Meu\s+Cart[aã]o)\s*/i,
    /^Compra\s+Parcelada\s+(?:Visa|Meu\s+Cart[aã]o)\s*/i,
    /^Compra\s+(?:Visa|Meu\s+Cart[aã]o)\s*/i,
    /^Saque\s+(?:Visa|Meu\s+Cart[aã]o)\s*/i,
  ];

  for (const prefixo of prefixos) {
    const match = descricao.match(prefixo);
    if (match) {
      const estabelecimento = descricao.substring(match[0].length).trim();
      if (estabelecimento.length > 0) {
        return estabelecimento;
      }
    }
  }

  // Se não match nenhum prefixo, retorna a descrição original
  return descricao;
}

/**
 * Localiza a seção de transações no texto extraído.
 * Retorna o texto APENAS da seção de transações.
 *
 * Delimitadores:
 *   Início: "Lançamentos detalhados do período" ou "Crédito/Débito" (cabeçalho tabela)
 *   Fim: "Compras parceladas" ou "Próximas Faturas" ou "Confira as informações"
 */
function extrairSecaoTransacoes(texto) {
  // Início da seção de transações
  const marcadoresInicio = [
    /LAN[CÇ]AMENTOS\s+DETALHADOS\s+DO\s+PER[IÍ]ODO\s*:?/i,
    /CR[EÉ]DITO\s*\/?\s*D[EÉ]BITO/i,
    /TRANSA[CÇ][OÕ]ES\s+REALIZADAS\s+PELO/i,
  ];

  let inicioPos = -1;
  for (const regex of marcadoresInicio) {
    const match = texto.search(regex);
    if (match !== -1) {
      inicioPos = match;
      break;
    }
  }

  if (inicioPos === -1) {
    console.log('[Renner Parser] Seção de transações não encontrada');
    return null;
  }

  // Fim da seção de transações
  const marcadoresFim = [
    /COMPRAS\s+PARCELADAS/i,
    /PR[OÓ]XIMAS?\s+FATURAS?/i,
    /CONFIRA\s+AS\s+INFORMA[CÇ][OÕ]ES/i,
    /ATEN[CÇ][AÃ]O\s*:\s*OS\s+LAN[CÇ]AMENTOS/i,
    /LIMITES?\s+EM\s+R\$/i,
  ];

  let fimPos = texto.length;
  const textoAposInicio = texto.substring(inicioPos);

  for (const regex of marcadoresFim) {
    const match = textoAposInicio.search(regex);
    if (match !== -1 && match > 50) { // > 50 para não pegar o header
      const posFim = inicioPos + match;
      if (posFim < fimPos) {
        fimPos = posFim;
      }
    }
  }

  const secao = texto.substring(inicioPos, fimPos);
  console.log(`[Renner Parser] Seção de transações: pos ${inicioPos}-${fimPos} (${secao.length} chars)`);
  return secao;
}

/**
 * Parser principal Renner v2.
 */
export function parseRenner(texto) {
  const transacoes = [];

  // 1. Detectar ano de referência via vencimento
  let anoReferencia = new Date().getFullYear();
  const matchVenc = texto.match(/VENCIMENTO\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (matchVenc) {
    const ano = parseInt(matchVenc[1].split('/')[2]);
    if (ano > 2000) anoReferencia = ano;
  } else {
    const matchAno = texto.match(/(\d{2}\/\d{2}\/\d{4})/);
    if (matchAno) {
      const ano = parseInt(matchAno[1].split('/')[2]);
      if (ano > 2000) anoReferencia = ano;
    }
  }
  console.log(`[Renner Parser] Ano referência: ${anoReferencia}`);

  // 2. Extrair total da fatura (página 1)
  const totalFaturaPDF = extrairTotalFaturaPDF(texto);

  // 3. Localizar seção de transações
  const secaoTransacoes = extrairSecaoTransacoes(texto);

  if (!secaoTransacoes) {
    console.log('[Renner Parser] Seção de transações não encontrada — confiança baixa');
    return {
      transacoes: [],
      total_encontrado: 0,
      valor_total: 0,
      banco_detectado: 'Renner/Realize',
      confianca_texto: 'baixa',
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
        equacao: 'Seção de transações não encontrada'
      },
      metadados_verificacao: {
        total_fatura_pdf: totalFaturaPDF
      }
    };
  }

  // 4. Parsear transações dentro da seção
  // Formato pdf-parse para Renner:
  //   "30/12/2025 Pagamento Fatura Pix -4.988,91"
  //   "03/01/2026 Compra a Vista sem Juros Visa FACEBK RCM5Z9RHW2 506,90"
  //   "10/01/2026 Fatura Segura 12,90"
  //   "27/01/2026 ANUIDADE Int - Parc.1/12 23,90"

  // Pattern principal: data DD/MM/YYYY + descrição + valor (possivelmente negativo)
  const regexTransacao = /(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/gm;
  let match;

  while ((match = regexTransacao.exec(secaoTransacoes)) !== null) {
    const dataStr = match[1];
    const descricaoRaw = match[2].trim();
    const valorStr = match[3];

    // Parse data (formato DD/MM/YYYY completo)
    const data = parseDataBR(dataStr, anoReferencia);
    if (!data) continue;

    // Parse valor — manter sinal para detectar pagamentos
    const valorAbsoluto = parseValorBR(valorStr);
    const ehNegativo = valorStr.startsWith('-');

    // Extrair estabelecimento da descrição
    const descricaoFinal = extrairEstabelecimento(descricaoRaw);

    // Classificar tipo
    const tipoLancamento = classificarTipoRenner(descricaoRaw);

    // Filtrar pagamentos do cliente
    if (tipoLancamento === 'pagamento_fatura') {
      console.log(`[Renner Parser] Ignorando pagamento: ${descricaoRaw} ${valorStr}`);
      continue;
    }

    // Valores negativos que não são estorno = pagamentos (ignorar)
    if (ehNegativo && tipoLancamento !== 'estorno') {
      console.log(`[Renner Parser] Ignorando valor negativo: ${descricaoRaw} ${valorStr}`);
      continue;
    }

    if (valorAbsoluto <= 0) continue;
    if (!descricaoFinal) continue;

    // Extrair parcela se houver
    const parcela = extrairParcela(descricaoRaw);

    // Evitar duplicatas
    const existe = transacoes.some(t =>
      t.data === data &&
      t.descricao === descricaoFinal &&
      Math.abs(t.valor - valorAbsoluto) < 0.01
    );

    if (!existe) {
      transacoes.push({
        data,
        descricao: descricaoFinal,
        valor: valorAbsoluto,
        parcela,
        tipo_lancamento: tipoLancamento
      });
    }
  }

  // 5. Fallback: tentar pattern com data DD/MM (sem ano) se poucos resultados
  if (transacoes.length < 3) {
    console.log(`[Renner Parser] Poucos resultados (${transacoes.length}), tentando pattern DD/MM...`);
    const regexDDMM = /(\d{1,2}\/\d{1,2})\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/gm;

    while ((match = regexDDMM.exec(secaoTransacoes)) !== null) {
      const dataStr = match[1];
      const descricaoRaw = match[2].trim();
      const valorStr = match[3];

      const data = parseDataBR(dataStr, anoReferencia);
      if (!data) continue;

      const valorAbsoluto = parseValorBR(valorStr);
      const ehNegativo = valorStr.startsWith('-');
      const descricaoFinal = extrairEstabelecimento(descricaoRaw);
      const tipoLancamento = classificarTipoRenner(descricaoRaw);

      if (tipoLancamento === 'pagamento_fatura') continue;
      if (ehNegativo && tipoLancamento !== 'estorno') continue;
      if (valorAbsoluto <= 0) continue;
      if (!descricaoFinal) continue;

      const parcela = extrairParcela(descricaoRaw);
      const existe = transacoes.some(t =>
        t.data === data &&
        t.descricao === descricaoFinal &&
        Math.abs(t.valor - valorAbsoluto) < 0.01
      );

      if (!existe) {
        transacoes.push({
          data,
          descricao: descricaoFinal,
          valor: valorAbsoluto,
          parcela,
          tipo_lancamento: tipoLancamento
        });
      }
    }
  }

  console.log(`[Renner Parser] ${transacoes.length} transações extraídas`);

  // 5.5. Verificar se as descrições são genéricas (sem estabelecimento)
  // Se a maioria das compras tem descrição "Compra a Vista sem Juros Visa",
  // o pdf-parse não extraiu os nomes dos estabelecimentos → forçar IA visual
  const compras = transacoes.filter(t => t.tipo_lancamento === 'compra');
  const comprasGenericas = compras.filter(t =>
    /^Compra\s+a\s+Vista\s+sem\s+Juros/i.test(t.descricao) ||
    /^Compra\s+a\s+Vista\s+(?:Visa|Meu)/i.test(t.descricao)
  );
  const descricaoGenericaDetectada = compras.length > 3 && comprasGenericas.length > compras.length * 0.5;
  if (descricaoGenericaDetectada) {
    console.log(`[Renner Parser] ${comprasGenericas.length}/${compras.length} compras com descrição genérica — forçando IA visual`);
  }

  // 6. Calcular totais por tipo
  const totalCompras = transacoes
    .filter(t => t.tipo_lancamento === 'compra')
    .reduce((sum, t) => sum + t.valor, 0);

  const iof = transacoes
    .filter(t => t.tipo_lancamento === 'iof')
    .reduce((sum, t) => sum + t.valor, 0);

  const estornos = transacoes
    .filter(t => t.tipo_lancamento === 'estorno')
    .reduce((sum, t) => sum + t.valor, 0);

  const tarifaCartao = transacoes
    .filter(t => t.tipo_lancamento === 'tarifa_cartao')
    .reduce((sum, t) => sum + t.valor, 0);

  const totalFaturaCalculado = parseFloat(
    (totalCompras + iof + tarifaCartao - estornos).toFixed(2)
  );

  // Reconciliação
  let reconciliado = null;
  let diferencaCentavos = null;

  if (totalFaturaPDF !== null) {
    diferencaCentavos = Math.round((totalFaturaPDF - totalFaturaCalculado) * 100);
    reconciliado = Math.abs(diferencaCentavos) <= 100; // tolerância de R$ 1,00
  }

  // Se descrições genéricas foram detectadas, forçar IA visual para obter estabelecimentos
  const confianca = (transacoes.length >= 3 && !descricaoGenericaDetectada) ? 'alta' : 'baixa';

  console.log(`[Renner Parser] Confiança: ${confianca}`);
  console.log(`[Renner Parser] Total compras: ${totalCompras.toFixed(2)}`);
  console.log(`[Renner Parser] IOF: ${iof.toFixed(2)}`);
  console.log(`[Renner Parser] Estornos: ${estornos.toFixed(2)}`);
  console.log(`[Renner Parser] Tarifas: ${tarifaCartao.toFixed(2)}`);
  console.log(`[Renner Parser] Total calculado: ${totalFaturaCalculado}`);
  console.log(`[Renner Parser] Total PDF: ${totalFaturaPDF}`);
  if (diferencaCentavos !== null) {
    console.log(`[Renner Parser] Reconciliado: ${reconciliado} (diferença: ${diferencaCentavos} centavos)`);
  }

  const valorTotal = transacoes.reduce((sum, t) => sum + t.valor, 0);

  return {
    transacoes,
    total_encontrado: transacoes.length,
    valor_total: parseFloat(valorTotal.toFixed(2)),
    banco_detectado: 'Renner/Realize',
    confianca_texto: confianca,
    resumo_fatura: {
      total_compras: parseFloat(totalCompras.toFixed(2)),
      iof: parseFloat(iof.toFixed(2)),
      estornos: parseFloat(estornos.toFixed(2)),
      pagamento_antecipado: 0,
      tarifa_cartao: parseFloat(tarifaCartao.toFixed(2)),
      total_fatura_pdf: totalFaturaPDF,
      total_fatura_calculado: totalFaturaCalculado,
      reconciliado,
      diferenca_centavos: diferencaCentavos,
      equacao: `${totalCompras.toFixed(2)} + ${iof.toFixed(2)} + ${tarifaCartao.toFixed(2)} - ${estornos.toFixed(2)} = ${totalFaturaCalculado.toFixed(2)}`
    },
    metadados_verificacao: {
      total_fatura_pdf: totalFaturaPDF
    }
  };
}
