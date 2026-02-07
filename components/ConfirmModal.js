'use client'

import { X } from 'lucide-react'

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirmar ação',
  message = 'Tem certeza que deseja continuar?',
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  variant = 'danger',
  loading = false
}) {
  if (!isOpen) return null

  const variantStyles = {
    danger: {
      button: 'bg-red-600 hover:bg-red-700 text-white',
      icon: 'text-red-600'
    },
    warning: {
      button: 'bg-amber-600 hover:bg-amber-700 text-white',
      icon: 'text-amber-600'
    }
  }

  const styles = variantStyles[variant] || variantStyles.danger

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl md:rounded-lg shadow-xl max-w-md w-full mx-0 md:mx-4 p-5 md:p-6" style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}>
        <button onClick={onClose} className="absolute top-3 right-3 md:top-4 md:right-4 p-1.5 text-neutral-400 hover:text-neutral-600">
          <X size={20} />
        </button>
        <div className="text-center">
          <h3 className="text-lg font-semibold text-neutral-800 mb-2">{title}</h3>
          <p className="text-[14px] md:text-base text-neutral-600 mb-5 md:mb-6">{message}</p>
          <div className="flex flex-col-reverse md:flex-row gap-2 md:gap-3 md:justify-center">
            <button
              onClick={onClose}
              disabled={loading}
              className="w-full md:w-auto px-4 py-3 md:py-2 text-neutral-600 bg-neutral-100 rounded-lg hover:bg-neutral-200 font-medium disabled:opacity-50"
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              disabled={loading}
              className={`w-full md:w-auto px-4 py-3 md:py-2 rounded-lg font-medium disabled:opacity-50 ${styles.button}`}
            >
              {loading ? 'Aguarde...' : confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
