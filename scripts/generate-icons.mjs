import { createCanvas } from 'canvas'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const output = fileURLToPath(new URL('../public/icons/', import.meta.url))
fs.mkdirSync(output, { recursive: true })
for (const size of [72, 96, 128, 192, 512]) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  // Opaque background and safe central artwork support Android icon masking.
  ctx.fillStyle = '#073d25'
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = '#e4aa2a'
  ctx.lineWidth = size * 0.025
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size * 0.35, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#e4aa2a'
  ctx.font = `bold ${size * 0.16}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('AHWMB', size / 2, size / 2)
  fs.writeFileSync(path.join(output, `icon-${size}.png`), canvas.toBuffer('image/png'))
}
