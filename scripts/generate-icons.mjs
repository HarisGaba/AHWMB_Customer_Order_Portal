import { createCanvas, loadImage } from 'canvas'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Builds every app icon from the real logo (public/logo.png):
// Android/PWA icons, the iPhone home-screen icon, and the browser-tab favicons.
const publicDir = fileURLToPath(new URL('../public/', import.meta.url))
const output = path.join(publicDir, 'icons')
fs.mkdirSync(output, { recursive: true })
const logo = await loadImage(path.join(publicDir, 'logo.png'))

function render(size, logoScale) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  // Opaque brand background: Android masks it into a circle/squircle, iOS rounds the corners.
  ctx.fillStyle = '#073d25'
  ctx.fillRect(0, 0, size, size)
  const d = size * logoScale
  ctx.save()
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, d / 2, 0, Math.PI * 2)
  ctx.clip()
  ctx.drawImage(logo, (size - d) / 2, (size - d) / 2, d, d)
  ctx.restore()
  return canvas.toBuffer('image/png')
}

// Maskable icons must keep the artwork inside the central 80% safe zone.
for (const size of [72, 96, 128, 192, 512]) fs.writeFileSync(path.join(output, `icon-${size}.png`), render(size, 0.76))
// iPhone/iPad home screen (iOS does not mask, so the logo can be larger).
fs.writeFileSync(path.join(output, 'apple-touch-icon.png'), render(180, 0.86))
// Browser tab.
for (const size of [32, 48]) fs.writeFileSync(path.join(output, `favicon-${size}.png`), render(size, 0.94))
console.log('Icons written to', output)
