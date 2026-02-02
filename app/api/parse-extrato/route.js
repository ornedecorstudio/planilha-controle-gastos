import { NextResponse } from 'next/server';
import { parseOFX, isValidOFX, calcularTotais } from '@/lib/ofx-parser';
import { categorizeAll, identificarReembolsos, calcularResumoPorCategoria } from '@/lib/categorize-extrato';

// Modelo para fallback com PDF
const ANTHROPIC_MODEL = 'claude-opus-4-5-20251101';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('pdf') || formData.get('file');
    const banco = formData.get('banco') || '';

    if (!file) {
      return NextResponse.json(
        { error: 'Nenhum arquivo enviado' },
        { status: 400 }
      );
    }

    // Obter nome e extensão do arquivo
    const fileName = file.name || '';
    const fileExtension = fileName.split('.').pop()?.toLowerCase();

    // Ler conteúdo do arquivo
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // ===== PROCESSAMENTO OFX (PRIORITÁRIO) =====
    if (fileExtension === 'ofx' || fileExtension === 'qfx') {
      const content = buffer.toString('utf-8');

      // Validar se é OFX válido
      if (!isValidOFX(content)) {
        return NextResponse.json(
          { error: 'Arquivo OFX inválido ou corrompido' },
          { status: 400 }
        );
      }

      // Parse determinístico do OFX
      const resultado = parseOFX(content);

      if (!resultado.success || resultado.movimentacoes.length === 0) {
        return NextResponse.json(
          { error: 'Nenhuma movimentação encontrada no arquivo OFX' },
          { status: 400 }
        );
      }

      // Categorizar movimentações
      const movimentacoesCat = categorizeAll(resultado.movimentacoes);

      // Calcular totais
      const totais = calcularTotais(movimentacoesCat);

      // Identificar reembolsos
      const reembolsos = identificarReembolsos(movimentacoesCat);

      // Calcular resumo por categoria
      const resumoPorCategoria = calcularResumoPorCategoria(movimentacoesCat);

      return NextResponse.json({
        success: true,
        metodo: 'OFX_PARSER',
        banco: resultado.banco || banco,
        banco_codigo: resultado.banco_codigo,
        conta: resultado.conta,
        periodo_inicio: resultado.periodo_inicio,
        periodo_fim: resultado.periodo_fim,
        saldo_final: resultado.saldo_final,
        movimentacoes: movimentacoesCat,
        total_movimentacoes: movimentacoesCat.length,
        total_entradas: totais.total_entradas,
        total_saidas: totais.total_saidas,
        saldo_periodo: totais.saldo_periodo,
        quantidade_entradas: totais.quantidade_entradas,
        quantidade_saidas: totais.quantidade_saidas,
        reembolsos_identificados: reembolsos,
        total_reembolsos: reembolsos.reduce((sum, r) => sum + r.valor, 0),
        resumo_categorias: resumoPorCategoria
      });
    }

    // ===== PROCESSAMENTO PDF (FALLBACK COM IA) =====
    if (fileExtension === 'pdf') {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return NextResponse.json(
          { error: 'ANTHROPIC_API_KEY não configurada. Use arquivo OFX para processamento sem IA.' },
          { status: 500 }
        );
      }

      const base64 = buffer.toString('base64');

      const prompt = `Você é um especialista em extrair movimentações de extratos bancários brasileiros.
Analise este PDF de extrato do banco "${banco}" e extraia TODAS as movimentações.

FORMATOS COMUNS DE EXTRATOS BANCÁRIOS:

1. ITAÚ:
   - Formato tabular: DATA | LANÇAMENTOS | RAZÃO SOCIAL | CNPJ/CPF | VALOR | SALDO
   - Créditos (entradas) e débitos (saídas) bem identificados
   - Valores negativos indicam saídas

2. NUBANK, SANTANDER, BRADESCO, INTER:
   - Formatos similares com data, descrição e valor

Para cada movimentação, extraia:
1. data: Data da movimentação (SEMPRE no formato DD/MM/YYYY)
2. descricao: Descrição completa incluindo razão social e CNPJ/CPF se disponível
3. valor: Valor absoluto em reais (número positivo, use ponto como decimal)
4. tipo: "entrada" para créditos/depósitos, "saida" para débitos/pagamentos

REGRAS:
- EXTRAIA todas as movimentações de entrada e saída
- IGNORE linhas de saldo (saldo anterior, saldo disponível)
- IGNORE cabeçalhos e rodapés
- Para valores negativos ou débitos, marque tipo como "saida"
- Para valores positivos ou créditos, marque tipo como "entrada"

Retorne APENAS um JSON válido:
{
  "movimentacoes": [
    {
      "data": "DD/MM/YYYY",
      "descricao": "descrição completa",
      "valor": 123.45,
      "tipo": "entrada" ou "saida"
    }
  ],
  "banco_detectado": "nome do banco"
}`;

      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 8192,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: 'application/pdf',
                    data: base64,
                  },
                },
                {
                  type: 'text',
                  text: prompt,
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Erro da API Anthropic:', response.status, errorData);
        return NextResponse.json(
          {
            error: `API Anthropic retornou ${response.status}. Considere usar arquivo OFX.`,
            details: errorData
          },
          { status: 500 }
        );
      }

      const data = await response.json();
      const responseText = data.content?.[0]?.text || '';

      let result;
      try {
        const cleanJson = responseText
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();
        result = JSON.parse(cleanJson);
      } catch (parseError) {
        console.error('Erro ao fazer parse do JSON:', parseError);
        return NextResponse.json(
          {
            error: 'Erro ao processar resposta da IA. Considere usar arquivo OFX.',
            raw_response: responseText.substring(0, 500)
          },
          { status: 500 }
        );
      }

      if (!result.movimentacoes || !Array.isArray(result.movimentacoes)) {
        return NextResponse.json(
          { error: 'Estrutura de resposta inválida' },
          { status: 500 }
        );
      }

      // Formatar movimentações do PDF
      const movimentacoesFormatadas = result.movimentacoes.map((m, index) => ({
        id: `pdf_${Date.now()}_${index}`,
        data: formatarDataPDF(m.data),
        descricao: m.descricao,
        valor: Math.abs(parseFloat(m.valor) || 0),
        tipo: m.tipo || 'saida',
        documento: null
      })).filter(m => m.valor > 0);

      // Categorizar
      const movimentacoesCat = categorizeAll(movimentacoesFormatadas);
      const totais = calcularTotais(movimentacoesCat);
      const reembolsos = identificarReembolsos(movimentacoesCat);
      const resumoPorCategoria = calcularResumoPorCategoria(movimentacoesCat);

      return NextResponse.json({
        success: true,
        metodo: 'PDF_IA',
        modelo_usado: ANTHROPIC_MODEL,
        banco: result.banco_detectado || banco,
        movimentacoes: movimentacoesCat,
        total_movimentacoes: movimentacoesCat.length,
        total_entradas: totais.total_entradas,
        total_saidas: totais.total_saidas,
        saldo_periodo: totais.saldo_periodo,
        quantidade_entradas: totais.quantidade_entradas,
        quantidade_saidas: totais.quantidade_saidas,
        reembolsos_identificados: reembolsos,
        total_reembolsos: reembolsos.reduce((sum, r) => sum + r.valor, 0),
        resumo_categorias: resumoPorCategoria,
        aviso: 'Processado via IA. Para maior precisão, use arquivo OFX.'
      });
    }

    // Extensão não suportada
    return NextResponse.json(
      {
        error: `Formato de arquivo não suportado: .${fileExtension}`,
        formatos_aceitos: ['ofx', 'qfx', 'pdf'],
        recomendacao: 'Prefira usar arquivo OFX para maior precisão'
      },
      { status: 400 }
    );

  } catch (error) {
    console.error('Erro no parse-extrato:', error);
    return NextResponse.json(
      {
        error: 'Erro ao processar arquivo',
        details: error.message
      },
      { status: 500 }
    );
  }
}

/**
 * Formatar data do PDF para ISO
 */
function formatarDataPDF(dataStr) {
  if (!dataStr) return null;

  // Já está no formato ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(dataStr)) {
    return dataStr;
  }

  // Formato DD/MM/YYYY
  const match = dataStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) {
    const [, dia, mes, ano] = match;
    return `${ano}-${mes}-${dia}`;
  }

  // Formato DD/MM/YY
  const matchShort = dataStr.match(/(\d{2})\/(\d{2})\/(\d{2})/);
  if (matchShort) {
    const [, dia, mes, ano] = matchShort;
    const anoFull = parseInt(ano) > 50 ? `19${ano}` : `20${ano}`;
    return `${anoFull}-${mes}-${dia}`;
  }

  return null;
}
