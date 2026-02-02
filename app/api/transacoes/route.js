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

// Funcao auxiliar para recalcular totais da fatura
async function recalcularTotaisFatura(supabase, fatura_id) {
  const { data: todasTransacoes } = await supabase
    .from('transacoes')
    .select('valor, tipo')
    .eq('fatura_id', fatura_id)

  const totalPJ = (todasTransacoes || [])
    .filter(t => t.tipo === 'PJ')
    .reduce((acc, t) => acc + parseFloat(t.valor), 0)

  const totalPF = (todasTransacoes || [])
    .filter(t => t.tipo === 'PF')
    .reduce((acc, t) => acc + parseFloat(t.valor), 0)

  await supabase
    .from('faturas')
    .update({
      valor_total: totalPJ + totalPF,
      valor_pj: totalPJ,
      valor_pf: totalPF
    })
    .eq('id', fatura_id)

  return { totalPJ, totalPF, total: totalPJ + totalPF }
}

// DELETE - Remove transacoes (individual ou duplicadas em lote)
export async function DELETE(request) {
  try {
    const supabase = createServerClient()
    const { searchParams } = new URL(request.url)

    const id = searchParams.get('id')
    const fatura_id = searchParams.get('fatura_id')
    const duplicates = searchParams.get('duplicates') === 'true'
    const confirm = searchParams.get('confirm') === 'true'
    const ids = searchParams.get('ids')

    // Delecao individual
    if (id) {
      const { data: transacao } = await supabase
        .from('transacoes')
        .select('fatura_id')
        .eq('id', id)
        .single()

      if (!transacao) {
        return NextResponse.json({ error: 'Transacao nao encontrada' }, { status: 404 })
      }

      const { error } = await supabase
        .from('transacoes')
        .delete()
        .eq('id', id)

      if (error) {
        console.error('Erro ao deletar transacao:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const totais = await recalcularTotaisFatura(supabase, transacao.fatura_id)

      return NextResponse.json({
        success: true,
        message: 'Transacao removida',
        totais
      })
    }

    // Delecao em lote por IDs
    if (ids) {
      const idList = ids.split(',').filter(Boolean)

      if (idList.length === 0) {
        return NextResponse.json({ error: 'Nenhum ID fornecido' }, { status: 400 })
      }

      const { data: primeiraTransacao } = await supabase
        .from('transacoes')
        .select('fatura_id')
        .eq('id', idList[0])
        .single()

      if (!primeiraTransacao) {
        return NextResponse.json({ error: 'Transacoes nao encontradas' }, { status: 404 })
      }

      const { error } = await supabase
        .from('transacoes')
        .delete()
        .in('id', idList)

      if (error) {
        console.error('Erro ao deletar transacoes:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const totais = await recalcularTotaisFatura(supabase, primeiraTransacao.fatura_id)

      return NextResponse.json({
        success: true,
        message: `${idList.length} transacoes removidas`,
        quantidade: idList.length,
        totais
      })
    }

    // Deteccao/delecao de duplicadas
    if (fatura_id && duplicates) {
      const { data: transacoes, error: fetchError } = await supabase
        .from('transacoes')
        .select('*')
        .eq('fatura_id', fatura_id)
        .order('data', { ascending: true })

      if (fetchError) {
        console.error('Erro ao buscar transacoes:', fetchError)
        return NextResponse.json({ error: fetchError.message }, { status: 500 })
      }

      // Agrupa transacoes por chave EXATA: data + descricao COMPLETA + valor EXATO
      // Uma transacao so e duplicada se TODOS os campos forem identicos
      const grupos = {}
      transacoes.forEach(t => {
        // Normaliza: data exata, descricao completa em maiusculo sem espacos extras, valor com 2 decimais
        const dataExata = t.data || ''
        const descricaoNorm = (t.descricao || '').toUpperCase().replace(/\s+/g, ' ').trim()
        const valorExato = parseFloat(t.valor || 0).toFixed(2)
        const chave = `${dataExata}|${descricaoNorm}|${valorExato}`
        if (!grupos[chave]) {
          grupos[chave] = []
        }
        grupos[chave].push(t)
      })

      const duplicadas = []
      const idsParaRemover = []

      Object.entries(grupos).forEach(([chave, grupo]) => {
        if (grupo.length > 1) {
          // Ordena por ID para manter sempre o mesmo "original"
          const ordenados = grupo.sort((a, b) => a.id.localeCompare(b.id))
          const original = ordenados[0]
          // Marca todas exceto a primeira como duplicadas
          ordenados.slice(1).forEach(t => {
            duplicadas.push({
              ...t,
              original_id: original.id,
              original_descricao: original.descricao,
              motivo: `Duplicada de: ${original.descricao} (${original.data})`
            })
            idsParaRemover.push(t.id)
          })
        }
      })

      // Log para debug
      console.log(`Encontradas ${duplicadas.length} duplicatas em ${transacoes.length} transacoes`)

      if (!confirm) {
        return NextResponse.json({
          duplicadas,
          quantidade: duplicadas.length,
          idsParaRemover,
          total_transacoes: transacoes.length,
          grupos_com_duplicatas: Object.values(grupos).filter(g => g.length > 1).length,
          preview: true
        })
      }

      if (idsParaRemover.length === 0) {
        return NextResponse.json({
          success: true,
          message: 'Nenhuma duplicata encontrada',
          quantidade: 0
        })
      }

      const { error: deleteError } = await supabase
        .from('transacoes')
        .delete()
        .in('id', idsParaRemover)

      if (deleteError) {
        console.error('Erro ao deletar duplicadas:', deleteError)
        return NextResponse.json({ error: deleteError.message }, { status: 500 })
      }

      const totais = await recalcularTotaisFatura(supabase, fatura_id)

      return NextResponse.json({
        success: true,
        message: `${idsParaRemover.length} transacoes duplicadas removidas`,
        quantidade: idsParaRemover.length,
        totais
      })
    }

    return NextResponse.json({ error: 'Parametros invalidos' }, { status: 400 })

  } catch (error) {
    console.error('Erro na API transacoes DELETE:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
