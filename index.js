const express = require('express');
const { Client, RemoteAuth, MessageMedia } = require('whatsapp-web.js');
const admin = require('firebase-admin');
const { FirestoreStore } = require('wwebjs-firebase-store');
const axios = require('axios');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// 1. Firebase සම්බන්ධ කිරීම (Render Environment Variable එකෙන්)
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
const store = new FirestoreStore({ db: db });

// 2. WhatsApp Client එක සාදා ගැනීම
const client = new Client({
    authStrategy: new RemoteAuth({
        clientId: 'esena-news-session', 
        store: store,
        backupSyncIntervalMs: 300000 
    }),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] 
    }
});

// Render Dashboard Logs වල QR එක පෙන්වීම
client.on('qr', (qr) => {
    console.log('\n---👇 කරුණාකර මේ QR එක ස්කෑන් කරන්න 👇---\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ WhatsApp Bot එක සාර්ථකව සක්‍රිය විය!');
    setInterval(checkLatestNews, 300000); // විනාඩි 5න් 5ට අලුත් නිව්ස් චෙක් කරයි
});

client.on('auth_failure', (msg) => {
    console.error('ලොග් වීමේ දෝෂයක්:', msg);
});

// 3. වෙබ් සයිට් එකෙන් එන අයව Firebase එකට දාන API එක
app.post('/api/register', async (req, res) => {
    const { name, number } = req.body;
    if (!name || !number) {
        return res.status(400).json({ success: false, message: 'නම සහ අංකය ඇතුලත් කරන්න.' });
    }

    let formattedNumber = number.replace(/[^\d]/g, '');
    if (formattedNumber.startsWith('0')) {
        formattedNumber = '94' + formattedNumber.substring(1);
    }
    const whatsappId = `${formattedNumber}@c.us`;

    try {
        await db.collection('subscribers').doc(whatsappId).set({
            name: name,
            number: formattedNumber,
            registeredAt: admin.firestore.FieldValue.serverTimestamp()
        });
        res.status(200).json({ success: true, message: 'ලියාපදිංචිය සාර්ථකයි!' });

        // සාදරයෙන් පිළිගැනීමේ පණිවිඩය
        setTimeout(async () => {
            try {
                await client.sendMessage(whatsappId, `ආයුබෝවන් *${name}*! 👋\n\nඔබ අපගේ ප්‍රවෘත්ති සේවාව සමඟ සාර්ථකව සම්බන්ධ විය. අලුත්ම පුවත් ඉක්මනින්ම ඔබ වෙත එවනු ලැබේ. \n\n_Esena News Bot_`);
            } catch (err) { 
                console.log('Welcome message error:', err.message); 
            }
        }, 2000);
    } catch (e) { 
        res.status(500).json({ success: false, message: 'Server Error' }); 
    }
});

// Server එක Live තියාගන්න Health Check එක
app.get('/health', (req, res) => res.send('BOT IS ALIVE'));

// 4. නිව්ස් API එකෙන් පුවත් ගෙන හැමෝටම බ්‍රෝඩ්කාස්ට් කරන කොටස
async function checkLatestNews() {
    try {
        const response = await axios.get('https://esena-news-api-v3.vercel.app/news/latest');
        const latestNews = response.data.news_data.data[0]; 

        const configRef = db.collection('config').doc('news_status');
        const configDoc = await configRef.get();
        let lastSentId = null;
        if (configDoc.exists) lastSentId = configDoc.data().lastId;

        // අලුත් නිව්ස් එකක් නම් විතරක් යවන්න
        if (latestNews.id !== lastSentId) {
            console.log('🚀 නව පුවතක් හමු විය! යැවීම ආරම්භ කරනවා...');
            
            const usersSnapshot = await db.collection('subscribers').get();
            const messageText = `📰 *${latestNews.titleSi}*\n\n${latestNews.contentSi[0].data}\n\n🔗 වැඩිදුර කියවන්න: ${latestNews.share_url}`;
            const media = await MessageMedia.fromUrl(latestNews.cover);

            for (const doc of usersSnapshot.docs) {
                try {
                    await client.sendMessage(doc.id, media, { caption: messageText });
                    await new Promise(r => setTimeout(r, 4000)); // Numbers බ්ලොක් නොවෙන්න තත්පර 4ක පරතරයක්
                } catch (err) { 
                    console.log(`Error sending to ${doc.id}:`, err.message); 
                }
            }
            await configRef.set({ lastId: latestNews.id });
            console.log('✅ සියලු දෙනාටම පුවත් යවා අවසන්!');
        }
    } catch (e) { 
        console.log('News Check Error:', e.message); 
    }
}

// සර්වර් එක ස්ටාර්ට් කිරීම
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    client.initialize();
});
