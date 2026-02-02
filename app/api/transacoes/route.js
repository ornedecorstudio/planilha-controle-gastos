import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

// GET - Lista transacoes de uma fatura
export async function GET(request) {
  try {
    const supabase = createServerClient()
    const { searchParams } = new URL(request.url)
    
    const fatura_id = searchParams.get('fatura_id')
    const tipo = searchParams.get('tipo') // 'PJ' ou 'PF'
    const categoria = searchParams.get('categoria')
    const limit = parseInt(searchParams.get('limit')) || 100
    
    if (!fatura_id) {
      return NextResponse.json({ error: 'fatura_id e obrigatorio' }, { status: 400 })
    }
    
    let query = supabase
      .from('transacoes')
      .select('*')
      .eq('fatura_id', fatura_id)
      .order('data', { ascending: true })
      .limit(limit)
    
    if (tipo) {
      query = query.eq('tipo', tipo)
    }
    
    if (categoria) {
      query = query.eq('categoria', categoria)
    }
    
    const { data, error } = await query
    
    if (error) {
      console.error('Erro ao buscar transacoes:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json({ transacoes: data })
    
  } catch (error) {
    console.error('Erro na API transacoes:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}

// POST - Insere transacoes em lote
export async function POST(request) {
  try {
    const supabase = createServerClient()
    const body = await request.json()
    
    const { fatura_id, transacoes } = body
    
    if (!fatura_id || !transacoes || !Array.isArray(transacoes)) {
      return NextResponse.json({ error: 'fatura_id e array de transacoes sao obrigatorios' }, { status: 400 })
    }
    
    // Prepara transacoes com fatura_id
    const transacoesParaInserir = transacoes.map(t => ({
      fatura_id,
      data: t.data,
      descricao: t.descricao,
      valor: parseFloat(t.valor) || 0,
      categoria: t.categoria || 'Outros',
      tipo: t.tipo || 'PJ',
      metodo: t.metodo || 'automatico'
    }))
    
    // Insere transacoes
    const { data, error } = await supabase
      .from('transacoes')
      .insert(transacoesParaInserir)
      .select()
    
    if (error) {
      console.error('Erro ao inserir transacoes:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    // Atualiza totais da fatura
    const totalPJ = transacoesParaInserir
      .filter(t => t.tipo === 'PJ')
      .reduce((acc, t) => acc + t.valor, 0)
    
    const totalPF = transacoesParaInserir
      .filter(t => t.tipo === 'PF')
      .reduce((acc, t) => acc + t.valor, 0)
    
    const valorTotal = totalPJ + totalPF
    
    await supabase
      .from('faturas')
      .update({
        valor_total: valorTotal,
        valor_pj: totalPJ,
        valor_pf: totalPF
      })
      .eq('id', fatura_id)
    
    return NextResponse.json({ 
      transacoes: data,
      quantidade: data.length,
      totais: { pj: totalPJ, pf: totalPF, total: valorTotal }
    }, { status: 201 })
    
  } catch (error) {
    console.error('Erro na API transacoes:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}

// PATCH - Atualiza uma transacao
export async function PATCH(request) {
  try {
    const supabase = createServerClient()
    const body = await request.json()
    
    const { id, categoria, tipo } = body
    
    if (!id) {
      return NextResponse.json({ error: 'ID da transacao e obrigatorio' }, { status: 400 })
    }
    
    const updateData = { metodo: 'manual' }
    if (categoria) updateData.categoria = categoria
    if (tipo) updateData.tipo = tipo
    
    const { data, error } = await supabase
      .from('transacoes')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()
    
    if (error) {
      console.error('Erro ao atualizar transacao:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    // Recalcula totais da fatura
    const { data: fatura } = await supabase
      .from('transacoes')
      .select('fatura_id')
      .eq('id', id)
      .single()
    
    if (fatura) {
      const { data: todasTransacoes } = await supabase
        .from('transacoes')
        .select('valor, tipo')
        .eq('fatura_id', fatura.fatura_id)
      
      if (todasTransacoes) {
        const totalPJ = todasTransacoes
          .filter(t => t.tipo === 'PJ')
          .reduce((acc, t) => acc + parseFloat(t.valor), 0)
        
        const totalPF = todasTransacoes
          .filter(t => t.tipo === 'PF')
          .reduce((acc, t) => acc + parseFloat(t.valor), 0)
        
        await supabase
          .from('faturas')
          .update({
            valor_total: totalPJ + totalPF,
            valor_pj: totalPJ,
            valor_pf: totalPF
          })
          .eq('id', fatura.fatura_id)
      }
    }
    
    return NextResponse.json({ transacao: data })
    
  } catch (error) {
    console.error('Erro na API transacoes:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
