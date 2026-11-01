import webpush from 'web-push'

const vapidKeys = webpush.generateVAPIDKeys()
console.log('Add these to your .env.local:')
console.log()
console.log('VITE_VAPID_PUBLIC_KEY=' + vapidKeys.publicKey)
console.log()
console.log('Add this to Supabase Edge Function secrets:')
console.log('VAPID_PRIVATE_KEY=' + vapidKeys.privateKey)
console.log('VAPID_PUBLIC_KEY=' + vapidKeys.publicKey)
console.log('VAPID_SUBJECT=mailto:ahwmb1965@gmail.com')
