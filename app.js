const $ = (s) => document.querySelector(s)

const pairBtn = $('#pairBtn')
const phone = $('#phone')
const codeBox = $('#codeBox')
const pairCode = $('#pairCode')
const message = $('#message')
const badge = $('#statusBadge')
const number = $('#number')
const activity = $('#activity')

function setMessage(text) {
  message.textContent = text || ''
}

function render(data) {
  const connected = data.connection === 'open'
  badge.textContent = connected ? 'CONNECTED' : String(data.connection || 'DISCONNECTED').toUpperCase()
  badge.classList.toggle('ok', connected)
  number.textContent = data.connectedNumber ? '+' + data.connectedNumber : '—'

  if (data.pairingCode) {
    codeBox.classList.remove('hidden')
    pairCode.textContent = data.pairingCode
  }

  activity.innerHTML = ''
  for (const item of (data.activity || [])) {
    const div = document.createElement('div')
    div.className = 'event'
    const time = new Date(item.time).toLocaleString()
    div.innerHTML = `<small>${time}</small><strong>${item.type}</strong><br>${item.detail}`
    activity.appendChild(div)
  }
}

async function refresh() {
  try {
    const res = await fetch('/api/status')
    const data = await res.json()
    render(data)
  } catch (e) {
    setMessage('Dashboard cannot reach the server.')
  }
}

pairBtn.addEventListener('click', async () => {
  setMessage('')
  codeBox.classList.add('hidden')
  pairBtn.disabled = true
  pairBtn.textContent = 'Starting pairing...'

  try {
    const res = await fetch('/api/pair', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ phone: phone.value })
    })
    const data = await res.json()
    if (!data.ok) throw new Error(data.error)
    setMessage('Waiting for WhatsApp to generate your pairing code...')
    const started = Date.now()

    const timer = setInterval(async () => {
      await refresh()
      const status = await fetch('/api/status').then(r => r.json())
      if (status.pairingCode || status.connection === 'open' || Date.now() - started > 60000) {
        clearInterval(timer)
        pairBtn.disabled = false
        pairBtn.textContent = 'Generate Pairing Code'
        if (status.pairingCode) setMessage('Enter the code in WhatsApp → Linked Devices → Link with phone number.')
        if (status.connection === 'open') setMessage('WhatsApp connected successfully.')
      }
    }, 1500)
  } catch (e) {
    setMessage(e.message || 'Pairing failed.')
    pairBtn.disabled = false
    pairBtn.textContent = 'Generate Pairing Code'
  }
})

refresh()
setInterval(refresh, 5000)
