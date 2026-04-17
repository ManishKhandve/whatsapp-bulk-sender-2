# Cleanly Message - WhatsApp Bulk Sender 🚀

Cleanly Message is a comprehensive, web-based WhatsApp marketing automation tool. It allows you to upload Excel sheets of contacts and seamlessly broadcast personalized messages (and images) securely, incorporating variable anti-ban algorithms to keep your account safe.

## ✨ Features
- **Anti-Ban Smart Batching:** Sends messages in defined batches with random intervals (e.g., send 3 texts, wait 30-90 seconds randomly).
- **Media Support:** Effortlessly send images (`.jpg`, `.png`, `.webp`) accompanied by customized captions.
- **Dynamic Variables:** Personalize messages with dynamic tags: `{{name}}`, `{{phone}}`, and `{{company}}`.
- **Excel Uploads:** Instantly parse contacts by dropping any `.xlsx` or `.csv` file directly into the dashboard.
- **Robust Parsing:** Guaranteed contact extraction from the first column, gracefully ignoring empty rows and textual headers.
- **Dark Mode UI:** Premium, glassmorphism interface with beautiful micro-animations and live real-time terminal logs.
- **No Session Clutter:** Refreshes cleanly on boot to force a fresh secure QR connection every time.

## 🛠 Prerequisites
Ensure you have the following installed on your machine:
- [Node.js](https://nodejs.org/) (v16.0.0 or higher recommended)

## 🚀 Getting Started

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ManishKhandve/whatsapp-bulk-sender-2.git
   cd whatsapp-bulk-sender-2
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the application:**
   ```bash
   npm start
   ```

4. **Access Dashboard:**  
   Open your browser and navigate to: `http://localhost:3000`

## 📖 How to Use
1. Scan the QR code displayed on the screen using your WhatsApp mobile app (**Settings > Linked Devices**).
2. Upload your Excel contact sheet. Ensure your phone numbers exist in **Column A** (the very first column).
3. Optionally add a `Name` in Column B and a `Company` in Column C to use dynamic variables.
4. Craft your message template and optionally attach an image.
5. Setup your delays and batch settings.
6. Hit **Start** and watch the magic happen in the live log.

## ⚠️ Important Note
This application utilizes the unofficial [whatsapp-web.js](https://wwebjs.dev/) library. Be conscious of your messaging volume! Overtly spamming recipients limits your session's health and could result in WhatsApp temporarily suspending your phone number. **Use responsibly.**
