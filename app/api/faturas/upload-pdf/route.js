import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

// POST - Faz upload do PDF para o Supabase Storage
export async function POST(request) {
  try {
    const supabase = createServerClient()
    const formData = await request.formData()

    const fatura_id = formData.get('fatura_id')
    const pdf = formData.get('pdf')

    if (!fatura_id) {
      return NextResponse.json({ error: 'fatura_id e obrigatorio' }, { status: 400 })
    }

    if (!pdf) {
      return NextResponse.json({ error: 'Arquivo PDF e obrigatorio' }, { status: 400 })
    }

    // Converte o arquivo para buffer
    const bytes = await pdf.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Nome do arquivo: fatura_id + timestamp para evitar cache
    const fileName = `faturas/${fatura_id}.pdf`

    // Upload para o bucket 'faturas'
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('faturas')
      .upload(fileName, buffer, {
        contentType: 'application/pdf',
        upsert: true // Substitui se ja existir
      })

    if (uploadError) {
      console.error('Erro no upload:', uploadError)
      // Se o bucket nao existe, tenta criar
      if (uploadError.message?.includes('Bucket not found')) {
        return NextResponse.json({
          error: 'Bucket de storage nao configurado. Configure o bucket "faturas" no Supabase.',
          details: uploadError.message
        }, { status: 500 })
      }
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }

    // Gera URL publica do arquivo
    const { data: urlData } = supabase.storage
      .from('faturas')
      .getPublicUrl(fileName)

    const pdf_url = urlData?.publicUrl

    // Atualiza a fatura com a URL do PDF
    const { error: updateError } = await supabase
      .from('faturas')
      .update({ pdf_url })
      .eq('id', fatura_id)

    if (updateError) {
      console.error('Erro ao atualizar fatura:', updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      pdf_url,
      message: 'PDF salvo com sucesso'
    })

  } catch (error) {
    console.error('Erro no upload do PDF:', error)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
