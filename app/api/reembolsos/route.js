import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

/**
 * API de Reembolsos - Gerencia a vinculação entre faturas PF e pagamentos PJ
 *
 * Contexto do Negócio:
 * - PF (Erick) paga faturas dos cartões pessoais (contém gastos PJ)
 * - PJ (ORNE) reembolsa a PF via PIX os gastos empresariais
 * - Esta API gerencia a reconciliação entre faturas e reembolsos
 */

// GET - Lista faturas pendentes de reembolso e reembolsos identificados
export async function GET(request) {
  try {
    const supabase = createServerClient()
    const { searchParams } = new URL(request.url)

    const tipo = searchParams.get('tipo') // 'pendentes', 'reembolsados', 'todos'
    const mes = searchParams.get('mes') // formato: YYYY-MM

    // Buscar faturas com status de reembolso
    let faturaQuery = supabase
      .from('faturas')
      .select(`
        *,
        cartoes (
          id,
          nome,
          banco,
          tipo
        )
      `)
      .order('mes_referencia', { ascending: false })

    // Filtrar por status
    if (tipo === 'pendentes') {
      faturaQuery = faturaQuery.in('status', ['pendente', 'pago'])
    } else if (tipo === 'reembolsados') {
      faturaQuery = faturaQuery.eq('status', 'reembolsado')
    }

    // Filtrar por mês
    if (mes) {
      faturaQuery = faturaQuery
        .gte('mes_referencia', `${mes}-01`)
        .lte('mes_referencia', `${mes}-31`)
    }

    const { data: faturas, error: faturaError } = await faturaQuery

    if (faturaError) {
      console.error('Erro ao buscar faturas:', faturaError)
      return NextResponse.json({ error: faturaError.message }, { status: 500 })
    }

    // Buscar movimentações de reembolso (PIX para Erick)
    const { data: movimentacoes, error: movError } = await supabase
      .from('movimentacoes')
      .select(`
        *,
        extratos (
          id,
          banco,
          mes_referencia
        )
      `)
      .eq('categoria', 'Reembolso Sócio')
      .order('data', { ascending: false })

    if (movError) {
      console.error('Erro ao buscar movimentações:', movError)
    }

    // Calcular totais
    const totalPendente = faturas
      .filter(f => f.status !== 'reembolsado')
      .reduce((sum, f) => sum + parseFloat(f.valor_pj || 0), 0)

    const totalReembolsado = faturas
      .filter(f => f.status === 'reembolsado')
      .reduce((sum, f) => sum + parseFloat(f.valor_pj || 0), 0)

    const totalMovimentacoes = (movimentacoes || [])
      .reduce((sum, m) => sum + parseFloat(m.valor || 0), 0)

    return NextResponse.json({
      faturas,
      movimentacoes_reembolso: movimentacoes || [],
      resumo: {
        total_pendente: totalPendente,
        total_reembolsado: totalReembolsado,
        total_movimentacoes: totalMovimentacoes,
        faturas_pendentes: faturas.filter(f => f.status !== 'reembolsado').length,
        faturas_reembolsadas: faturas.filter(f => f.status === 'reembolsado').length
      }
    })

  } catch (error) {
    console.error('Erro na API reembolsos:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}

// POST - Vincular fatura com movimentação de reembolso
export async function POST(request) {
  try {
    const supabase = createServerClient()
    const body = await request.json()

    const { fatura_id, movimentacao_id, valor_pago, data_pagamento } = body

    if (!fatura_id) {
      return NextResponse.json({ error: 'fatura_id é obrigatório' }, { status: 400 })
    }

    // Atualizar status da fatura para reembolsado
    const { data: fatura, error: faturaError } = await supabase
      .from('faturas')
      .update({
        status: 'reembolsado',
        data_pagamento: data_pagamento || new Date().toISOString().split('T')[0]
      })
      .eq('id', fatura_id)
      .select()
      .single()

    if (faturaError) {
      console.error('Erro ao atualizar fatura:', faturaError)
      return NextResponse.json({ error: faturaError.message }, { status: 500 })
    }

    // Se tiver movimentação_id, vincular
    if (movimentacao_id) {
      const { error: movError } = await supabase
        .from('movimentacoes')
        .update({ fatura_vinculada_id: fatura_id })
        .eq('id', movimentacao_id)

      if (movError) {
        console.error('Erro ao vincular movimentação:', movError)
      }
    }

    return NextResponse.json({
      success: true,
      fatura,
      message: 'Fatura marcada como reembolsada'
    })

  } catch (error) {
    console.error('Erro na API reembolsos:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}

// PATCH - Sugerir vinculações automáticas
export async function PATCH(request) {
  try {
    const supabase = createServerClient()
    const body = await request.json()

    const { acao } = body // 'sugerir' ou 'vincular_auto'

    if (acao === 'sugerir') {
      // Buscar faturas pendentes
      const { data: faturasPendentes } = await supabase
        .from('faturas')
        .select('*, cartoes(*)')
        .in('status', ['pendente', 'pago'])
        .gt('valor_pj', 0)

      // Buscar movimentações de reembolso não vinculadas
      const { data: movimentacoes } = await supabase
        .from('movimentacoes')
        .select('*, extratos(*)')
        .eq('categoria', 'Reembolso Sócio')
        .is('fatura_vinculada_id', null)

      // Algoritmo de sugestão: match por valor aproximado
      const sugestoes = []

      for (const fatura of faturasPendentes || []) {
        const valorPJ = parseFloat(fatura.valor_pj)
        const tolerancia = 0.50 // R$ 0,50 de tolerância

        const matchesExatos = (movimentacoes || []).filter(m => {
          const valorMov = parseFloat(m.valor)
          return Math.abs(valorMov - valorPJ) <= tolerancia
        })

        if (matchesExatos.length === 1) {
          sugestoes.push({
            fatura,
            movimentacao: matchesExatos[0],
            confianca: 'alta',
            motivo: 'Valor exato encontrado'
          })
        } else if (matchesExatos.length > 1) {
          sugestoes.push({
            fatura,
            movimentacoes_possiveis: matchesExatos,
            confianca: 'media',
            motivo: 'Múltiplos valores compatíveis'
          })
        }
      }

      return NextResponse.json({
        sugestoes,
        total_faturas_pendentes: faturasPendentes?.length || 0,
        total_movimentacoes_disponiveis: movimentacoes?.length || 0
      })
    }

    return NextResponse.json({ error: 'Ação não reconhecida' }, { status: 400 })

  } catch (error) {
    console.error('Erro na API reembolsos:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
