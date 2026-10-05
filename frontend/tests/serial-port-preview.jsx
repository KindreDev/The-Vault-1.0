// Isolated visual/interaction fixture. It never opens a real port or Vault API.
import React from 'react'
import { createRoot } from 'react-dom/client'
import SerialPortPicker from '../src/components/SerialPortPicker'
import '../src/index.css'

const root = document.documentElement
root.style.setProperty('--c-surface', '#171824')
root.style.setProperty('--c-text', '#f0edf7')
root.style.setProperty('--c-border', '#3e354d')
root.style.setProperty('--c-accent', '#cb8cf1')

function Preview() {
  const [result, setResult] = React.useState('No port selected')
  const open = () => window.dispatchEvent(new CustomEvent('vault:choose-serial-port', { detail: {
    ports: [{ device: 'COM3', description: 'USB Serial Device' }, { device: 'COM7', description: 'T-Code Controller' }],
    resolve: port => setResult(`Selected ${port.device}`), reject: () => setResult('Cancelled'),
  } }))
  return <div style={{ padding: 40, background: '#0d0c13', minHeight: '100vh', color: '#f0edf7', fontSize: 16 }}>
    <button onClick={open} style={{ padding: 16, border: '1px solid #cb8cf1', borderRadius: 10 }}>Choose simulated port</button>
    <p>{result}</p><SerialPortPicker />
  </div>
}
createRoot(document.getElementById('root')).render(<Preview />)
