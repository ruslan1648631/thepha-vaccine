name: Daily Web Push Notification Alert

on:
  schedule:
    # 00:30 UTC ทุกวัน = 07:30 น. เวลาประเทศไทย (UTC+7)
    - cron: '30 0 * * *'
  workflow_dispatch:
    inputs:
      alert_type:
        description: 'ประเภทการแจ้งเตือน (all, appt, dtp, missed)'
        required: true
        default: 'all'

jobs:
  send-web-push:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install web-push
        run: npm install --no-save web-push

      - name: Run Daily Web Push Notification
        env:
          SUPABASE_URL: "https://ioaclozxoinkbrnbtley.supabase.co"
          SUPABASE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvYWNsb3p4b2lua2JybmJ0bGV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NDk4NTUsImV4cCI6MjEwODEyNTg1NX0.xY3PVsmdqX2H3M2wvVsbAYgEoHVwuhFwy3Vagx76naM"
          VAPID_PUBLIC_KEY: "BC-6rlvIFHLo6N0HvaqM8rlna2U7Ok7qeHGzk27TWuLZa8GzYde2N2iFGXL1hRfThwSJw87BThTCi4sbzC3o1EM"
          VAPID_PRIVATE_KEY: ${{ secrets.VAPID_PRIVATE_KEY }}
          ALERT_TYPE: ${{ github.event.inputs.alert_type || 'all' }}
        run: node scripts/daily_web_push_alert.js
