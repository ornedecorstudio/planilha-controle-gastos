'use client'

import { useState, useEffect, useRef } from 'react'

export default function UploadButton({ onClick, loading = false, disabled = false, success = false, label = 'Upload' }) {
  const [state, setState] = useState('idle') // idle, loading, success
  const [svgContent, setSvgContent] = useState('arrow')
  const buttonRef = useRef(null)

  useEffect(() => {
    if (loading && state === 'idle') {
      setState('loading')
      // After animation, switch to checkmark
      const timer = setTimeout(() => {
        setSvgContent('check')
      }, 1500)
      return () => clearTimeout(timer)
    }
    if (success && state === 'loading') {
      setState('success')
      const timer = setTimeout(() => {
        setState('idle')
        setSvgContent('arrow')
      }, 2000)
      return () => clearTimeout(timer)
    }
    if (!loading && !success && state !== 'idle') {
      setState('idle')
      setSvgContent('arrow')
    }
  }, [loading, success, state])

  const handleClick = (e) => {
    e.preventDefault()
    if (disabled || state === 'loading') return
    onClick?.()
  }

  return (
    <>
      <style jsx>{`
        .upload-btn {
          --duration: 3000;
          --bg: #1e2132;
          --rect: #12141f;
          --text-color: #f8f9fc;
          --arrow-color: #f8f9fc;
          --success-bg: #2d3148;
          --check-color: #f8f9fc;
          display: inline-flex;
          overflow: hidden;
          text-decoration: none;
          -webkit-mask-image: -webkit-radial-gradient(white, black);
          background: var(--bg);
          border-radius: 30px;
          box-shadow: 0 2px 8px -1px rgba(10, 22, 50, 0.24);
          transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
          cursor: pointer;
          user-select: none;
        }
        .upload-btn:active:not(.disabled) {
          transform: scale(0.96);
          box-shadow: 0 1px 4px -1px rgba(10, 22, 50, 0.24);
        }
        .upload-btn.disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .upload-btn .text-list {
          margin: 0;
          padding: 14px 28px 14px 36px;
          list-style: none;
          text-align: center;
          position: relative;
          backface-visibility: hidden;
          font-size: 15px;
          font-weight: 500;
          line-height: 24px;
          color: var(--text-color);
          overflow: hidden;
          height: 52px;
        }
        .upload-btn .text-list li {
          transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .upload-btn .text-list li:not(:first-child) {
          position: absolute;
          top: 14px;
          left: 0;
          right: 0;
        }
        .upload-btn .text-list li:nth-child(2) {
          transform: translateY(60px);
        }
        .upload-btn .text-list li:nth-child(3) {
          transform: translateY(120px);
        }

        .upload-btn.loading .text-list li:nth-child(1) {
          transform: translateY(-60px);
        }
        .upload-btn.loading .text-list li:nth-child(2) {
          transform: translateY(0);
        }
        .upload-btn.loading .text-list li:nth-child(3) {
          transform: translateY(60px);
        }

        .upload-btn.success .text-list li:nth-child(1) {
          transform: translateY(-120px);
        }
        .upload-btn.success .text-list li:nth-child(2) {
          transform: translateY(-60px);
        }
        .upload-btn.success .text-list li:nth-child(3) {
          transform: translateY(0);
        }

        .upload-btn .icon-circle {
          overflow: hidden;
          -webkit-mask-image: -webkit-radial-gradient(white, black);
          position: relative;
          width: 52px;
          height: 52px;
          border-radius: 26px;
          background: var(--rect);
          flex-shrink: 0;
        }

        .upload-btn .icon-circle::before {
          content: '';
          display: block;
          position: absolute;
          border-radius: 1px;
          width: 2px;
          top: 50%;
          left: 50%;
          height: 16px;
          margin: -7px 0 0 -1px;
          background: var(--arrow-color);
          transition: transform 0.3s ease;
        }
        .upload-btn.loading .icon-circle::before {
          animation: upload-line 2s linear forwards;
        }

        .upload-btn .icon-circle::after {
          content: '';
          display: block;
          position: absolute;
          width: 52px;
          height: 52px;
          transform-origin: 50% 100%;
          border-radius: 80% 80% 0 0;
          background: var(--success-bg);
          top: 0;
          left: 0;
          transform: scaleY(0);
        }
        .upload-btn.loading .icon-circle::after {
          animation: upload-bg 2s linear forwards;
        }

        .upload-btn .icon-circle svg {
          display: block;
          position: absolute;
          width: 18px;
          height: 18px;
          left: 50%;
          top: 50%;
          margin: -11px 0 0 -9px;
          fill: none;
          z-index: 1;
          stroke-width: 2px;
          stroke: var(--arrow-color);
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .upload-btn.loading .icon-circle svg {
          animation: upload-svg 2s linear forwards;
        }

        @keyframes upload-line {
          5%, 10% { transform: translateY(26px); }
          40% { transform: translateY(18px); }
          65% { transform: translateY(0); }
          75%, 100% { transform: translateY(-26px); }
        }

        @keyframes upload-svg {
          0%, 20% {
            stroke-dasharray: 0;
            stroke-dashoffset: 0;
            margin: -11px 0 0 -9px;
          }
          21%, 89% {
            stroke-dasharray: 26px;
            stroke-dashoffset: 26px;
            stroke-width: 3px;
            margin: -9px 0 0 -9px;
            stroke: var(--check-color);
          }
          100% {
            stroke-dasharray: 26px;
            stroke-dashoffset: 0;
            margin: -9px 0 0 -9px;
            stroke: var(--check-color);
          }
          12% { opacity: 1; }
          20%, 89% { opacity: 0; }
          90%, 100% { opacity: 1; }
        }

        @keyframes upload-bg {
          10% { transform: scaleY(0); }
          40% { transform: scaleY(0.15); }
          65% { transform: scaleY(0.5); border-radius: 50% 50% 0 0; }
          75% { border-radius: 50% 50% 0 0; }
          90%, 100% { border-radius: 0; }
          75%, 100% { transform: scaleY(1); }
        }
      `}</style>

      <button
        ref={buttonRef}
        onClick={handleClick}
        className={`upload-btn ${state} ${disabled ? 'disabled' : ''}`}
        disabled={disabled}
        type="button"
      >
        <ul className="text-list">
          <li>{label}</li>
          <li>Enviando...</li>
          <li>Processando</li>
        </ul>
        <div className="icon-circle">
          <svg viewBox="0 0 24 24">
            {svgContent === 'arrow' ? (
              <path d="M5 12 L12 5 L19 12" />
            ) : (
              <path d="M3 14 L8 19 L21 6" />
            )}
          </svg>
        </div>
      </button>
    </>
  )
}
