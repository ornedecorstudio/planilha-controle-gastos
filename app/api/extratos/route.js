import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

// GET - Lista extratos com filtros opcionais
export async function GET(request) {
  try {
    const supabase = createServerClient()
    const { searchParams } = new URL(request.url)

    const banco = searchParams.get('banco')
    const ano = searchParams.get('ano')
    const limit = parseInt(searchParams.get('limit')) || 50

    let query = supabase
      .from('extratos')
      .select('*')
      .order('mes_referencia', { ascending: false })
      .limit(limit)

    if (banco) {
      query = query.eq('banco', banco)
    }

    if (ano) {
      query = query
        .gte('mes_referencia', `${ano}-01-01`)
        .lte('mes_referencia', `${ano}-12-31`)
    }

    const { data, error } = await query

    if (error) {
      console.error('Erro ao buscar extratos:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ extratos: data })

  } catch (error) {
    console.error('Erro na API extratos:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}

// POST - Cria novo extrato com movimentações
export async function POST(request) {
  try {
    const supabase = createServerClient()
    const body = await request.json()

    const { banco, mes_referencia, movimentacoes } = body

    if (!banco || !mes_referencia) {
      return NextResponse.json({ error: 'banco e mes_referencia são obrigatórios' }, { status: 400 })
    }

    if (!movimentacoes || !Array.isArray(movimentacoes) || movimentacoes.length === 0) {
      return NextResponse.json({ error: 'movimentacoes é obrigatório e deve ser um array' }, { status: 400 })
    }

    // Calcular totais
    const totalEntradas = movimentacoes
      .filter(m => m.tipo === 'entrada')
      .reduce((sum, m) => sum + (parseFloat(m.valor) || 0), 0)

    const totalSaidas = movimentacoes
      .filter(m => m.tipo === 'saida')
      .reduce((sum, m) => sum + (parseFloat(m.valor) || 0), 0)

    // Criar extrato
    const { data: extrato, error: extratoError } = await supabase
      .from('extratos')
      .insert([{
        banco,
        mes_referencia,
        total_entradas: totalEntradas,
        total_saidas: totalSaidas,
        saldo: totalEntradas - totalSaidas
      }])
      .select()
      .single()

    if (extratoError) {
      console.error('Erro ao criar extrato:', extratoError)
      return NextResponse.json({ error: extratoError.message }, { status: 500 })
    }

    // Inserir movimentações
    const movimentacoesParaInserir = movimentacoes.map(m => ({
      extrato_id: extrato.id,
      data: m.data,
      descricao: m.descricao,
      valor: parseFloat(m.valor) || 0,
      tipo: m.tipo || 'saida',
      categoria: m.categoria || 'Outros'
    }))

    const { data: movs, error: movsError } = await supabase
      .from('movimentacoes')
      .insert(movimentacoesParaInserir)
      .select()

    if (movsError) {
      console.error('Erro ao inserir movimentações:', movsError)
      // Deletar o extrato se as movimentações falharem
      await supabase.from('extratos').delete().eq('id', extrato.id)
      return NextResponse.json({ error: movsError.message }, { status: 500 })
    }

    return NextResponse.json({
      extrato,
      quantidade: movs.length,
      total_entradas: totalEntradas,
      total_saidas: totalSaidas
    }, { status: 201 })

  } catch (error) {
    console.error('Erro na API extratos:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}

// DELETE - Remove extrato e suas movimentações
export async function DELETE(request) {
  try {
    const supabase = createServerClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID do extrato é obrigatório' }, { status: 400 })
    }

    // Deletar movimentações primeiro
    await supabase.from('movimentacoes').delete().eq('extrato_id', id)

    // Deletar extrato
    const { error } = await supabase
      .from('extratos')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Erro ao deletar extrato:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Erro na API extratos:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
