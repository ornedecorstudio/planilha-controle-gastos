'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export default function FaturasPage() {
  const [faturas, setFaturas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const carregarFaturas = async () => {
      try {
        const response = await fetch('/api/faturas?limit=50')
        const result = await response.json()
        if (result.error) throw new Error(result.error)
        setFaturas(result.faturas || [])
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    carregarFaturas()
  }, [])

  const atualizarStatus = async (id, novoStatus) => {
    try {
      const response = await fetch('/api/faturas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: novoStatus })
      })
      const result = await response.json()
      if (result.error) throw new Error(result.error)

      setFaturas(prev => prev.map(f => f.id === id ? { ...f, status: novoStatus } : f))
    } catch (err) {
      alert('Erro ao atualizar: ' + err.message)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <h2 className="text-lg font-bold text-red-800">Erro ao carregar faturas</h2>
        <p className="text-red-600">{error}</p>
      </div>
    )
  }

  const totalPJ = faturas.reduce((a, f) => a + parseFloat(f.valor_pj || 0), 0)
  const totalPF = faturas.reduce((a, f) => a + parseFloat(f.valor_pf || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Faturas</h1>
          <p className="text-slate-500">{faturas.length} faturas cadastradas</p>
        </div>
        <Link href="/upload" className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-medium">
          + Nova Fatura
        </Link>
      </div>

      {/* Totais */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm text-slate-500">Total Geral</p>
          <p className="text-xl font-bold text-slate-800">
            R$ {(totalPJ + totalPF).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-200 p-4">
          <p className="text-sm text-green-600">Total PJ (Reembolsável)</p>
          <p className="text-xl font-bold text-green-700">
            R$ {totalPJ.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-200 p-4">
          <p className="text-sm text-red-600">Total PF (Pessoal)</p>
          <p className="text-xl font-bold text-red-700">
            R$ {totalPF.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* Tabela */}
      {faturas.length > 0 ? (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-3 text-left font-medium">Cartão</th>
                  <th className="p-3 text-left font-medium">Mês</th>
                  <th className="p-3 text-left font-medium">Vencimento</th>
                  <th className="p-3 text-right font-medium">Total</th>
                  <th className="p-3 text-right font-medium">PJ</th>
                  <th className="p-3 text-right font-medium">PF</th>
                  <th className="p-3 text-center font-medium">Status</th>
                  <th className="p-3 text-center font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {faturas.map(f => (
                  <tr key={f.id} className="border-t hover:bg-gray-50">
                    <td className="p-3 font-medium text-slate-700">
                      {f.cartoes?.nome || 'N/A'}
                      <span className="text-xs text-slate-400 ml-1">({f.cartoes?.tipo})</span>
                    </td>
                    <td className="p-3 text-slate-600">
                      {new Date(f.mes_referencia).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}
                    </td>
                    <td className="p-3 text-slate-600">
                      {f.data_vencimento ? new Date(f.data_vencimento).toLocaleDateString('pt-BR') : '-'}
                    </td>
                    <td className="p-3 text-right font-medium">
                      R$ {parseFloat(f.valor_total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3 text-right text-green-600 font-medium">
                      R$ {parseFloat(f.valor_pj || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3 text-right text-red-600">
                      R$ {parseFloat(f.valor_pf || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3 text-center">
                      <select
                        value={f.status}
                        onChange={(e) => atualizarStatus(f.id, e.target.value)}
                        className={`px-2 py-1 rounded text-xs font-medium cursor-pointer
                          ${f.status === 'pendente' ? 'bg-amber-100 text-amber-800' : ''}
                          ${f.status === 'pago' ? 'bg-blue-100 text-blue-800' : ''}
                          ${f.status === 'reembolsado' ? 'bg-green-100 text-green-800' : ''}
                        `}
                      >
                        <option value="pendente">Pendente</option>
                        <option value="pago">Pago</option>
                        <option value="reembolsado">Reembolsado</option>
                      </select>
                    </td>
                    <td className="p-3 text-center">
                      <Link href={`/faturas/${f.id}`} className="text-amber-600 hover:underline text-xs">
                        Ver detalhes
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border p-8 text-center">
          <div className="text-5xl mb-4">📄</div>
          <h3 className="text-lg font-semibold text-slate-700">Nenhuma fatura</h3>
          <p className="text-slate-500">Importe sua primeira fatura para começar</p>
          <Link href="/upload" className="inline-block mt-4 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600">
            + Importar Fatura
          </Link>
        </div>
      )}
    </div>
  )
}
