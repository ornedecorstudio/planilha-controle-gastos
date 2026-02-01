'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function Dashboard() {
  const [dados, setDados] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  useEffect(() => {
    const carregarDados = async () => {
      try {
        const response = await fetch('/api/dashboard')
        const result = await response.json()
        
        if (result.error) {
          throw new Error(result.error)
        }
        
        setDados(result)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    
    carregarDados()
  }, [])
  
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500 mx-auto"></div>
          <p className="mt-4 text-slate-600">Carregando dados...</p>
        </div>
      </div>
    )
  }
  
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <h2 className="text-lg font-bold text-red-800">Erro ao carregar dados</h2>
        <p className="text-red-600 mt-1">{error}</p>
        <button 
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
        >
          Tentar novamente
        </button>
      </div>
    )
  }
  
  const totais = dados?.totais || {
    valor_total: 0,
    valor_pj: 0,
    valor_pf: 0,
    quantidade_faturas: 0,
    faturas_pendentes: 0,
    faturas_pagas: 0,
    faturas_reembolsadas: 0
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
          <p className="text-slate-500">Resumo do ano {dados?.ano || new Date().getFullYear()}</p>
        </div>
        
        <Link
          href="/upload"
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors font-medium"
        >
          + Nova Fatura
        </Link>
      </div>
      
      {/* Cards de resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm text-slate-500">Total Geral</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">
            R$ {totais.valor_total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-slate-400 mt-1">{totais.quantidade_faturas} faturas</p>
        </div>
        
        <div className="bg-green-50 rounded-xl border border-green-200 p-4">
          <p className="text-sm text-green-600">Gastos PJ (Reembolsavel)</p>
          <p className="text-2xl font-bold text-green-700 mt-1">
            R$ {totais.valor_pj.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-green-500 mt-1">Despesas empresariais</p>
        </div>
        
        <div className="bg-red-50 rounded-xl border border-red-200 p-4">
          <p className="text-sm text-red-600">Gastos PF (Pessoal)</p>
          <p className="text-2xl font-bold text-red-700 mt-1">
            R$ {totais.valor_pf.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-red-500 mt-1">Nao reembolsavel</p>
        </div>
        
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
          <p className="text-sm text-amber-600">Faturas Pendentes</p>
          <p className="text-2xl font-bold text-amber-700 mt-1">{totais.faturas_pendentes}</p>
          <p className="text-xs text-amber-500 mt-1">Aguardando pagamento</p>
        </div>
      </div>
      
      {/* Status das faturas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-3 h-3 bg-amber-500 rounded-full"></div>
            <h3 className="font-semibold text-slate-800">Pendentes</h3>
          </div>
          <p className="text-3xl font-bold text-amber-600">{totais.faturas_pendentes}</p>
          <p className="text-sm text-slate-500 mt-1">Aguardando pagamento</p>
        </div>
        
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
            <h3 className="font-semibold text-slate-800">Pagas</h3>
          </div>
          <p className="text-3xl font-bold text-blue-600">{totais.faturas_pagas}</p>
          <p className="text-sm text-slate-500 mt-1">Aguardando reembolso</p>
        </div>
        
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
            <h3 className="font-semibold text-slate-800">Reembolsadas</h3>
          </div>
          <p className="text-3xl font-bold text-green-600">{totais.faturas_reembolsadas}</p>
          <p className="text-sm text-slate-500 mt-1">Processo concluido</p>
        </div>
      </div>
      
      {/* Categorias PJ */}
      {dados?.categorias_pj && dados.categorias_pj.length > 0 && (
        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-semibold text-slate-800 mb-4">Gastos PJ por Categoria</h3>
          <div className="space-y-3">
            {dados.categorias_pj.slice(0, 5).map((cat, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-8 bg-green-500 rounded-full"></div>
                  <div>
                    <p className="font-medium text-slate-700">{cat.nome}</p>
                    <p className="text-xs text-slate-500">{cat.quantidade} transacoes</p>
                  </div>
                </div>
                <p className="font-bold text-green-600">
                  R$ {cat.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Faturas recentes */}
      {dados?.faturas_recentes && dados.faturas_recentes.length > 0 && (
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800">Faturas Recentes</h3>
            <Link href="/faturas" className="text-amber-600 hover:underline text-sm">
              Ver todas
            </Link>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b">
                  <th className="pb-2 font-medium">Cartao</th>
                  <th className="pb-2 font-medium">Mes</th>
                  <th className="pb-2 font-medium text-right">PJ</th>
                  <th className="pb-2 font-medium text-right">PF</th>
                  <th className="pb-2 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {dados.faturas_recentes.map((f, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-3 font-medium text-slate-700">
                      {f.cartoes?.nome || 'N/A'}
                    </td>
                    <td className="py-3 text-slate-600">
                      {new Date(f.mes_referencia).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}
                    </td>
                    <td className="py-3 text-right text-green-600 font-medium">
                      R$ {parseFloat(f.valor_pj || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 text-right text-red-600">
                      R$ {parseFloat(f.valor_pf || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 text-center">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium
                        ${f.status === 'pendente' ? 'bg-amber-100 text-amber-800' : ''}
                        ${f.status === 'pago' ? 'bg-blue-100 text-blue-800' : ''}
                        ${f.status === 'reembolsado' ? 'bg-green-100 text-green-800' : ''}
                      `}>
                        {f.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {/* Mensagem se nao houver dados */}
      {(!dados?.faturas_recentes || dados.faturas_recentes.length === 0) && (
        <div className="bg-white rounded-xl border p-8 text-center">
          <div className="text-5xl mb-4">📄</div>
          <h3 className="text-lg font-semibold text-slate-700">Nenhuma fatura cadastrada</h3>
          <p className="text-slate-500 mt-1">Comece importando sua primeira fatura</p>
          <Link
            href="/upload"
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600"
          >
            + Importar Fatura
          </Link>
        </div>
      )}
    </div>
  )
}